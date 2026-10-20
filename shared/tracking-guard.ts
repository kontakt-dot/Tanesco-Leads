/**
 * Maschinen-Aufrufe aus dem Tracking heraushalten.
 * Virenscanner und Link-Vorschauen (z. B. in Firmen-Postfächern) rufen Zählpixel und Links automatisch auf,
 * ohne dass ein Mensch die Mail liest. Solche Aufrufe werden nicht als „geöffnet“ oder „geklickt“ gezählt:
 *  - bekannte Scanner/Bots am Browser-Kennzeichen (User-Agent) oder ganz ohne Kennzeichen,
 *  - HEAD-Anfragen (prüfen nur, ob der Link existiert),
 *  - Aufrufe in den ersten Sekunden nach dem Versand – so schnell öffnet kein Mensch.
 * Googles Bild-Proxy (Gmail) zählt dagegen: Gmail lädt das Bild erst, wenn die Mail geöffnet wird.
 */
const BOT_PATTERN = /bot\b|bot\/|crawler|spider|scanner|python|curl|wget|go-http|java\/|okhttp|axios|node-fetch|headless|phantom|barracuda|mimecast|proofpoint|symantec|messagelabs|trendmicro|forcepoint|fortiguard|sophos|ironport|zscaler|bingpreview|slackbot|facebookexternalhit|linkedinbot|whatsapp|telegram|skypeuripreview|discordbot|preview|validator|monitor|uptime/i;
export const MACHINE_WINDOW_MS = 5_000;

export function isMachineRequest(meta: { userAgent?: string | null; method?: string | null } | null | undefined): boolean {
  if (!meta) return false;
  if ((meta.method ?? "GET").toUpperCase() === "HEAD") return true;
  const ua = (meta.userAgent ?? "").trim();
  if (!ua) return true;
  if (/googleimageproxy/i.test(ua)) return false;
  return BOT_PATTERN.test(ua);
}

export function isTooSoonAfterSend(lastSentAt: Date | string | null | undefined, now: Date = new Date()): boolean {
  if (!lastSentAt) return false;
  const diff = now.getTime() - new Date(lastSentAt).getTime();
  return diff > -2_000 && diff < MACHINE_WINDOW_MS; // MySQL rundet Sekunden auf – der gespeicherte Versandzeitpunkt kann knapp in der Zukunft liegen
}
