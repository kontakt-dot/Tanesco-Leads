/**
 * Datei-Ablage auf der lokalen Festplatte (UPLOAD_DIR, Standard ./uploads) – ersetzt den Manus-Speicherproxy.
 * Abruf über signierte, zeitlich begrenzte Adressen: /api/files/<schlüssel>?exp=…&sig=…
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Express } from "express";

const uploadDir = () => path.resolve(process.env.UPLOAD_DIR ?? "uploads");
const secret = () => process.env.JWT_SECRET ?? "";

function normalizeKey(relKey: string) {
  const key = relKey.replace(/^\/+/, "").replace(/\\/g, "/").split("/").filter((segment) => segment && segment !== "." && segment !== "..").join("/");
  if (!key) throw new Error("Ungültiger Speicherschlüssel.");
  return key;
}

function sign(key: string, expires: number) { return createHmac("sha256", secret()).update(`${key}:${expires}`).digest("hex"); }

export async function storagePut(relKey: string, data: Buffer | Uint8Array | string, _contentType = "application/octet-stream"): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  const target = path.join(uploadDir(), key);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data));
  return { key, url: await storageGetSignedUrl(key) };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: await storageGetSignedUrl(key) };
}

export async function storageRead(relKey: string): Promise<Buffer> { return readFile(path.join(uploadDir(), normalizeKey(relKey))); }

export async function storageGetSignedUrl(relKey: string, expiresInMs = 60 * 60 * 1000): Promise<string> {
  const key = normalizeKey(relKey);
  const expires = Date.now() + expiresInMs;
  const base = (process.env.APP_URL ?? "").replace(/\/+$/, "");
  return `${base}/api/files/${key.split("/").map(encodeURIComponent).join("/")}?exp=${expires}&sig=${sign(key, expires)}`;
}

/** Express-Route für signierte Datei-Abrufe. */
export function registerFileRoutes(app: Express) {
  app.get("/api/files/*", async (req, res) => {
    try {
      const key = normalizeKey(decodeURIComponent(req.path.replace(/^\/api\/files\//, "")));
      const expires = Number(req.query.exp); const signature = String(req.query.sig ?? "");
      if (!Number.isFinite(expires) || expires < Date.now()) return res.status(403).json({ error: "Der Link ist abgelaufen." });
      const expected = sign(key, expires);
      if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return res.status(403).json({ error: "Ungültige Signatur." });
      const file = await readFile(path.join(uploadDir(), key));
      res.setHeader("content-type", key.endsWith(".pdf") ? "application/pdf" : "application/octet-stream");
      res.setHeader("cache-control", "private, max-age=300");
      return res.send(file);
    } catch { return res.status(404).json({ error: "Datei nicht gefunden." }); }
  });
}
