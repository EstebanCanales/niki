import { decodeDeviceSecretEncryptionKey } from "./app-config.service";

describe("decodeDeviceSecretEncryptionKey", () => {
  it("requires a canonical base64-encoded 32-byte key", () => {
    expect(() => decodeDeviceSecretEncryptionKey(undefined)).toThrow(
      "DEVICE_SECRET_ENCRYPTION_KEY is required",
    );
    expect(() => decodeDeviceSecretEncryptionKey(Buffer.alloc(31).toString("base64"))).toThrow(
      "DEVICE_SECRET_ENCRYPTION_KEY must be a base64-encoded 32-byte key",
    );
    expect(decodeDeviceSecretEncryptionKey(Buffer.alloc(32, 9).toString("base64"))).toEqual(
      Buffer.alloc(32, 9),
    );
  });
});
