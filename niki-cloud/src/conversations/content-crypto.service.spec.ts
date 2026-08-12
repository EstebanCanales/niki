import { ContentCryptoService } from "./content-crypto.service";

describe("ContentCryptoService", () => {
  const key = Buffer.alloc(32, 7);

  it("encrypts content with separate fields and decrypts it with the same identities", () => {
    const service = new ContentCryptoService(key);
    const encrypted = service.encrypt("contenido privado", {
      userId: "user-1",
      conversationId: "conversation-1",
      messageId: "message-1",
    });

    expect(encrypted.contentCiphertext).not.toContain("contenido privado");
    expect(encrypted.contentNonce).not.toBe(encrypted.contentCiphertext);
    expect(encrypted.contentAuthTag).not.toBe(encrypted.contentCiphertext);
    expect(service.decrypt(encrypted, {
      userId: "user-1",
      conversationId: "conversation-1",
      messageId: "message-1",
    })).toBe("contenido privado");
  });

  it.each([
    [{ userId: "other-user", conversationId: "conversation-1", messageId: "message-1" }],
    [{ userId: "user-1", conversationId: "other-conversation", messageId: "message-1" }],
    [{ userId: "user-1", conversationId: "conversation-1", messageId: "other-message" }],
  ])("rejects decryption when an AAD identity changes", (identity) => {
    const service = new ContentCryptoService(key);
    const encrypted = service.encrypt("contenido privado", {
      userId: "user-1",
      conversationId: "conversation-1",
      messageId: "message-1",
    });

    expect(() => service.decrypt(encrypted, identity)).toThrow();
  });
});
