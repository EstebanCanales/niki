import { Injectable, UnauthorizedException } from "@nestjs/common";
import { Device } from "@prisma/client";
import { isUUID } from "class-validator";
import { createHmac, timingSafeEqual } from "node:crypto";

import { PrismaService } from "../database/prisma.service";
import { DeviceSecretEncryptionService } from "../devices/device-secret-encryption.service";

const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000;
const LOWERCASE_SHA256_HEX = /^[0-9a-f]{64}$/;
const UNIX_MILLISECONDS = /^\d+$/;

export interface DeviceSignatureHeaders {
  deviceId: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
}

@Injectable()
export class DeviceSignatureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: DeviceSecretEncryptionService,
  ) {}

  async verify(
    headers: DeviceSignatureHeaders,
    rawBody: Buffer,
    now = Date.now(),
  ): Promise<Device> {
    if (
      !headers.deviceId ||
      !isUUID(headers.deviceId) ||
      !headers.timestamp ||
      !headers.signature ||
      !UNIX_MILLISECONDS.test(headers.timestamp) ||
      !LOWERCASE_SHA256_HEX.test(headers.signature)
    ) {
      throw new UnauthorizedException("Invalid device signature");
    }

    const timestamp = Number(headers.timestamp);
    if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > MAX_TIMESTAMP_SKEW_MS) {
      throw new UnauthorizedException("Invalid device signature timestamp");
    }

    const device = await this.prisma.device.findUnique({ where: { id: headers.deviceId } });
    if (!device || device.revokedAt) {
      throw new UnauthorizedException("Invalid device signature");
    }

    let secret: string;
    try {
      secret = this.secrets.decrypt(device, device.id);
    } catch {
      throw new UnauthorizedException("Invalid device signature");
    }

    const expectedSignature = createHmac("sha256", secret)
      .update(`${headers.timestamp}.`)
      .update(rawBody)
      .digest();
    const suppliedSignature = Buffer.from(headers.signature, "hex");

    if (!timingSafeEqual(suppliedSignature, expectedSignature)) {
      throw new UnauthorizedException("Invalid device signature");
    }

    return device;
  }
}
