import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

export interface EncryptedDeviceSecret {
  secretCiphertext: string;
  secretNonce: string;
  secretAuthTag: string;
}

const DEVICE_SECRET_AAD_PREFIX = "niki-device-secret-v1:";

export class DeviceSecretEncryptionService {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) {
      throw new Error("DEVICE_SECRET_ENCRYPTION_KEY must decode to exactly 32 bytes");
    }
  }

  encrypt(secret: string, deviceId: string): EncryptedDeviceSecret {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    cipher.setAAD(Buffer.from(`${DEVICE_SECRET_AAD_PREFIX}${deviceId}`));
    const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);

    return {
      secretCiphertext: ciphertext.toString("base64"),
      secretNonce: nonce.toString("base64"),
      secretAuthTag: cipher.getAuthTag().toString("base64"),
    };
  }

  decrypt(encrypted: EncryptedDeviceSecret, deviceId: string): string {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      this.decodeBase64(encrypted.secretNonce),
    );
    decipher.setAAD(Buffer.from(`${DEVICE_SECRET_AAD_PREFIX}${deviceId}`));
    decipher.setAuthTag(this.decodeBase64(encrypted.secretAuthTag));

    return Buffer.concat([
      decipher.update(this.decodeBase64(encrypted.secretCiphertext)),
      decipher.final(),
    ]).toString("utf8");
  }

  hashLinkCode(code: string): string {
    return this.domainHash("device-link-code-v1", code);
  }

  hashLinkOrigin(origin: string): string {
    return this.domainHash("device-link-origin-v1", origin);
  }

  private domainHash(domain: string, value: string): string {
    return createHmac("sha256", this.key).update(domain).update("\0").update(value).digest("hex");
  }

  private decodeBase64(value: string): Buffer {
    const decoded = Buffer.from(value, "base64");
    if (decoded.toString("base64") !== value) {
      throw new Error("Invalid encrypted device secret encoding");
    }
    return decoded;
  }
}
