/**
 * Wann ein Lead ankam – für die Leads-Tabelle (seit Version 366). Im Lead-Geschäft zählt, wie frisch ein Lead ist:
 * Frische Leads zählen in Minuten, der Rest nach Tag und Uhrzeit.
 *   unter 1 Min. „gerade eben“ · unter 60 Min. „vor 12 Min.“ · heute „Heute 17:28“ · gestern „Gestern 16:58“
 *   dieses Jahr „23.11. 14:26“ · älter „23.11.25“
 * `fresh`: „live“ unter 15 Minuten (der Punkt pulsiert), „neu“ unter einer Stunde, sonst null.
 */
export type ArrivalLabel = { text: string; full: string; fresh: "live" | "neu" | null };

const two = (value: number) => String(value).padStart(2, "0");

export function arrivalLabel(at: Date | string | number | null | undefined, now: Date = new Date()): ArrivalLabel {
  if (at === null || at === undefined || at === "") return { text: "—", full: "", fresh: null };
  const date = new Date(at); if (Number.isNaN(date.getTime())) return { text: "—", full: "", fresh: null };
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  const time = `${two(date.getHours())}:${two(date.getMinutes())}`;
  const full = `${["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"][date.getDay()]}, ${two(date.getDate())}.${two(date.getMonth() + 1)}.${date.getFullYear()} um ${time} Uhr`;
  const fresh: ArrivalLabel["fresh"] = minutes >= 0 && minutes < 15 ? "live" : minutes >= 0 && minutes < 60 ? "neu" : null;
  if (minutes >= 0 && minutes < 1) return { text: "gerade eben", full, fresh };
  if (minutes >= 1 && minutes < 60) return { text: `vor ${minutes} Min.`, full, fresh };
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === now.toDateString()) return { text: `Heute ${time}`, full, fresh };
  if (date.toDateString() === yesterday.toDateString()) return { text: `Gestern ${time}`, full, fresh };
  const day = `${two(date.getDate())}.${two(date.getMonth() + 1)}.`;
  return date.getFullYear() === now.getFullYear() ? { text: `${day} ${time}`, full, fresh } : { text: `${day}${String(date.getFullYear()).slice(-2)}`, full, fresh };
}

/** Kürzel für den Kreis vor dem Namen: „Emma Schulz“ → „ES“, „Herr Bade“ → „B“, ohne Namen „?“ */
export function nameInitials(name: string | null | undefined): string {
  const words = String(name ?? "").replace(/^(herr|frau|dr\.?|prof\.?)\s+/i, "").split(/[\s-]+/).map((word) => word.replace(/[^A-Za-z0-9\u00C0-\u024F]/g, "")).filter(Boolean);
  if (!words.length || /^name unbekannt$/i.test(String(name ?? "").trim())) return "?";
  return (words.length === 1 ? words[0].slice(0, 1) : `${words[0].slice(0, 1)}${words[words.length - 1].slice(0, 1)}`).toUpperCase();
}
