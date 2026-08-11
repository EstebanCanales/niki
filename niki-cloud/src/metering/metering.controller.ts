import { Body, Controller, Post, Req, UnauthorizedException } from "@nestjs/common";

import { DeviceSignatureService } from "./device-signature.service";
import { MeteringIngestResult, MeteringService } from "./metering.service";
import { DeviceUsageBatchDto } from "./metering.types";

interface RawDeviceRequest {
  headers: Record<string, string | string[] | undefined>;
  rawBody?: Buffer;
}

const singleHeader = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? undefined : value;

@Controller("v1/device-events")
export class MeteringController {
  constructor(
    private readonly signatures: DeviceSignatureService,
    private readonly metering: MeteringService,
  ) {}

  @Post("batch")
  async ingest(
    @Req() request: RawDeviceRequest,
    @Body() body: DeviceUsageBatchDto,
  ): Promise<MeteringIngestResult> {
    if (!request.rawBody) {
      throw new UnauthorizedException("Raw request body is required for device signatures");
    }

    const device = await this.signatures.verify(
      {
        deviceId: singleHeader(request.headers["x-niki-device-id"]),
        timestamp: singleHeader(request.headers["x-niki-timestamp"]),
        signature: singleHeader(request.headers["x-niki-signature"]),
      },
      request.rawBody,
    );

    return this.metering.ingest(device, body);
  }
}
