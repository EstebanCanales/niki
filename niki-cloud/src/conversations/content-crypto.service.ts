import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface ContentIdentity {
  userId: string;
  conversationId: string;
  messageId: string;
}

export interface EncryptedMessageContent {
  contentCiphertext: string;
  contentNonce: string;
  contentAuthTag: string;
}

export class ContentCryptoService {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) {
      throw new Error("CONVERSATION_ENCRYPTION_KEY must decode to exactly 32 bytes");
    }
  }

  encrypt(content: string, identity: ContentIdentity): EncryptedMessageContent {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    cipher.setAAD(this.additionalData(identity));
    const ciphertext = Buffer.concat([cipher.update(content, "utf8"), cipher.final()]);

    return {
      contentCiphertext: ciphertext.toString("base64"),
      contentNonce: nonce.toString("base64"),
      contentAuthTag: cipher.getAuthTag().toString("base64"),
    };
  }

  decrypt(encrypted: EncryptedMessageContent, identity: ContentIdentity): string {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      this.decodeCanonicalBase64(encrypted.contentNonce),
    );
    decipher.setAAD(this.additionalData(identity));
    decipher.setAuthTag(this.decodeCanonicalBase64(encrypted.contentAuthTag));

    return Buffer.concat([
      decipher.update(this.decodeCanonicalBase64(encrypted.contentCiphertext)),
      decipher.final(),
    ]).toString("utf8");
  }

  private additionalData(identity: ContentIdentity): Buffer {
    return Buffer.from(
      JSON.stringify([
        "niki-conversation-content-v1",
        identity.userId,
        identity.conversationId,
        identity.messageId,
      ]),
    );
  }

  private decodeCanonicalBase64(value: string): Buffer {
    const decoded = Buffer.from(value, "base64");
    if (decoded.toString("base64") !== value) {
      throw new Error("Invalid encrypted message content encoding");
    }
    return decoded;
  }
}
