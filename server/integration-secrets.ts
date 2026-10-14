import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function integrationSecretKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("Der sichere Schlüssel für Integrationszugänge ist nicht verfügbar.");
  return createHash("sha256").update(secret).digest();
}

export function encryptIntegrationSecret(secret: string) {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", integrationSecretKey(), iv); const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]); const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptIntegrationSecret(value: string) {
  const [version, iv, tag, encrypted] = value.split(":");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("Der gespeicherte Integrationszugang ist ungültig.");
  const decipher = createDecipheriv("aes-256-gcm", integrationSecretKey(), Buffer.from(iv, "base64")); decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64")), decipher.final()]).toString("utf8");
}
