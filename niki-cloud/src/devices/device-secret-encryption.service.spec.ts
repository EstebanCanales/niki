import { DeviceSecretEncryptionService } from "./device-secret-encryption.service";

describe("DeviceSecretEncryptionService", () => {
  const key = Buffer.alloc(32, 7);
  const service = new DeviceSecretEncryptionService(key);

  it("round-trips a secret with AES-256-GCM without storing plaintext", () => {
    const encrypted = service.encrypt("plain-device-secret", "device-id");

    expect(encrypted.secretCiphertext).not.toContain("plain-device-secret");
    expect(encrypted.secretNonce).not.toBe("");
    expect(encrypted.secretAuthTag).not.toBe("");
    expect(service.decrypt(encrypted, "device-id")).toBe("plain-device-secret");
  });

  it("uses a fresh nonce for every encryption", () => {
    const first = service.encrypt("same-secret", "device-id");
    const second = service.encrypt("same-secret", "device-id");

    expect(first.secretNonce).not.toBe(second.secretNonce);
    expect(first.secretCiphertext).not.toBe(second.secretCiphertext);
  });

  it("rejects tampered ciphertext", () => {
    const encrypted = service.encrypt("plain-device-secret", "device-id");

    expect(() =>
      service.decrypt({ ...encrypted, secretCiphertext: `${encrypted.secretCiphertext}A` }, "device-id"),
    ).toThrow();
  });
});
