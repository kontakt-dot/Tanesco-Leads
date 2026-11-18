/**
 * Profilbilder: Regeln, die im Browser und auf dem Server gleich gelten.
 *
 * Das Bild wird im Browser quadratisch zugeschnitten und klein gerechnet (siehe client/src/lib/avatar-image.ts) und kommt als
 * „data:image/…;base64,…“ an. Der Server prüft noch einmal: nur JPEG, PNG oder WebP (am Dateianfang erkannt, nicht am Namen), höchstens 400 KB.
 */
export const AVATAR_SIZE = 320; // Kantenlänge in Pixeln – scharf auch auf hochauflösenden Bildschirmen (Anzeige höchstens ~120 px)
export const AVATAR_MAX_BYTES = 400_000;
export type AvatarMime = "image/jpeg" | "image/png" | "image/webp";
export type AvatarImage = { mime: AvatarMime; base64: string; bytes: number };

const decodeHead = (base64: string): number[] => {
  const head = base64.slice(0, 24); // 18 Bytes reichen für alle drei Kennungen
  try { const text = atob(head); return Array.from(text, (char) => char.charCodeAt(0)); } catch { return []; }
};
/** Bildart am Dateianfang erkennen – der behaupteten Art im „data:“-Kopf wird nicht vertraut. */
export function sniffImage(base64: string): AvatarMime | null {
  const b = decodeHead(base64);
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}
/** „data:image/…;base64,…“ prüfen und zerlegen. Wirft eine verständliche Meldung, wenn das Bild nicht passt. */
export function parseAvatarDataUrl(dataUrl: unknown): AvatarImage {
  const text = typeof dataUrl === "string" ? dataUrl.trim() : "";
  const match = /^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/]+={0,2})$/.exec(text);
  if (!match) throw new Error("Das ist kein Bild. Bitte ein Foto als JPG oder PNG wählen.");
  const base64 = match[1]; const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0; const bytes = Math.floor(base64.length * 3 / 4) - padding;
  if (bytes < 100) throw new Error("Das Bild ist leer. Bitte ein anderes Foto wählen.");
  if (bytes > AVATAR_MAX_BYTES) throw new Error(`Das Bild ist zu groß (höchstens ${Math.round(AVATAR_MAX_BYTES / 1000)} KB). Bitte ein kleineres Foto wählen.`);
  const mime = sniffImage(base64);
  if (!mime) throw new Error("Dieses Bildformat geht nicht. Bitte ein Foto als JPG oder PNG wählen.");
  return { mime, base64, bytes };
}
/** Adresse eines Profilbilds (der Schlüssel ändert sich bei jedem neuen Bild – so wird nie ein altes angezeigt). */
export const avatarUrlOf = (key: string | null | undefined): string | null => (key ? `/api/avatar/${key}` : null);
/** Initialen als Ersatz, wenn kein Bild da ist: „Tanesco Admin“ → „TA“. */
export function initialsOf(name: string | null | undefined, fallback = "?"): string {
  const text = String(name ?? "").trim(); const base = text.includes("@") ? text.split("@")[0] : text; // bei einer E-Mail-Adresse zählt der Teil vor dem @
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : (parts[0] ?? "").slice(0, 2);
  return letters.toUpperCase() || fallback;
}
