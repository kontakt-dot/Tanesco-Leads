import { and, eq, isNotNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Express, Request, Response } from "express";
import { memberships, userAvatars, users } from "../drizzle/schema";
import { avatarUrlOf, parseAvatarDataUrl } from "../shared/avatar";
import { getDb } from "./db";
import type { Db } from "./lead-pipeline";

/**
 * Profilbilder.
 *
 * Das Bild liegt klein gerechnet in der Datenbank (Tabelle userAvatars) – nicht auf der Festplatte des Servers, die bei jedem
 * neuen Stand der Software geleert wird. Am Benutzer steht nur ein zufälliger Schlüssel (users.avatarKey); über ihn wird das Bild
 * unter /api/avatar/<Schlüssel> abgerufen. Bei jedem neuen Bild gibt es einen neuen Schlüssel – der Browser darf das Bild deshalb
 * dauerhaft zwischenspeichern, und ein altes Bild wird nie weiter angezeigt.
 */
export async function setAvatar(db: Db, userId: number, dataUrl: string): Promise<{ avatarUrl: string; avatarKey: string }> {
  const image = parseAvatarDataUrl(dataUrl); // prüft Art (am Dateianfang) und Größe – wirft eine verständliche Meldung
  const user = (await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1))[0];
  if (!user) throw new Error("Benutzer wurde nicht gefunden.");
  const existing = (await db.select({ userId: userAvatars.userId }).from(userAvatars).where(eq(userAvatars.userId, userId)).limit(1))[0];
  if (existing) await db.update(userAvatars).set({ mime: image.mime, data: image.base64 }).where(eq(userAvatars.userId, userId));
  else await db.insert(userAvatars).values({ userId, mime: image.mime, data: image.base64 });
  const avatarKey = nanoid(28);
  await db.update(users).set({ avatarKey }).where(eq(users.id, userId));
  return { avatarUrl: avatarUrlOf(avatarKey)!, avatarKey };
}
export async function removeAvatar(db: Db, userId: number): Promise<{ avatarUrl: null }> {
  await db.delete(userAvatars).where(eq(userAvatars.userId, userId));
  await db.update(users).set({ avatarKey: null }).where(eq(users.id, userId));
  return { avatarUrl: null };
}
/** Wer im Mandanten hat ein Profilbild? (Benutzer → Adresse) – damit Kürzel-Kreise überall das Bild zeigen können. */
export async function avatarDirectory(db: Db, tenantId: number): Promise<Array<{ userId: number; avatarUrl: string }>> {
  const rows = await db.select({ userId: users.id, avatarKey: users.avatarKey }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(and(eq(memberships.tenantId, tenantId), isNotNull(users.avatarKey)));
  const seen = new Set<number>(); const out: Array<{ userId: number; avatarUrl: string }> = [];
  for (const row of rows) { if (seen.has(row.userId) || !row.avatarKey) continue; seen.add(row.userId); out.push({ userId: row.userId, avatarUrl: avatarUrlOf(row.avatarKey)! }); }
  return out;
}
/** Bild zu einem Schlüssel laden (für den Abruf). */
export async function loadAvatar(db: Db, key: string): Promise<{ mime: string; data: Buffer } | null> {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(key)) return null;
  const user = (await db.select({ id: users.id }).from(users).where(eq(users.avatarKey, key)).limit(1))[0]; if (!user) return null;
  const row = (await db.select({ mime: userAvatars.mime, data: userAvatars.data }).from(userAvatars).where(eq(userAvatars.userId, user.id)).limit(1))[0]; if (!row) return null;
  return { mime: row.mime, data: Buffer.from(row.data, "base64") };
}
/** Abruf: /api/avatar/<Schlüssel>. Der Schlüssel ist zufällig und lang – wer ihn nicht kennt, kommt nicht an das Bild. */
export function registerAvatarRoutes(app: Express) {
  app.get("/api/avatar/:key", async (req: Request, res: Response) => {
    try {
      const db = await getDb(); const image = db ? await loadAvatar(db, String(req.params.key ?? "")) : null;
      if (!image) return res.status(404).type("text/plain").send("Nicht gefunden");
      res.setHeader("Content-Type", image.mime); res.setHeader("Cache-Control", "private, max-age=31536000, immutable"); res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("Content-Disposition", "inline");
      return res.status(200).send(image.data);
    } catch (error) { console.error("[Profilbild] Abruf:", error instanceof Error ? error.message : error); return res.status(500).type("text/plain").send("Fehler"); }
  });
}
