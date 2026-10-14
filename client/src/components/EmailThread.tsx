import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import { ArrowDownLeft, ArrowUpRight, Mail, Send } from "lucide-react";
import { useState } from "react";
import type { AppRouter } from "../../../server/routers";
import { REPLY_KIND_LABEL, type ReplyKind } from "../../../shared/reply-ai";

/**
 * E-Mail-Verlauf eines Leads: alles, was mit dieser Adresse per Mail hin- und herging – eingegangene Mails (links),
 * unsere Antworten, Einzel-E-Mails und Serien-Versand (rechts) – in Zeitreihenfolge wie ein Chat. Eine Marke zeigt,
 * ab wann der Kontakt als Lead in der Pipeline steht; alles darüber wurde schon vorher besprochen.
 * Kompakt (Karte): nur die letzten Einträge, Texte gekürzt; voll (Lead-Seite): ganzer Verlauf, Texte aufklappbar.
 */
export type EmailThreadData = inferRouterOutputs<AppRouter>["leadops"]["leadEmailThread"];
type Item = EmailThreadData["items"][number];

const KIND_LABEL: Record<Item["kind"], string> = { eingang: "Eingegangen", antwort: "Unsere Antwort", einzel: "E-Mail aus der Karte", serie: "E-Mail-Serie" };
const STATUS_LABEL: Record<string, string> = { gesendet: "gesendet", simuliert: "simuliert", fehlgeschlagen: "nicht zugestellt", link: "vorbereitet", gelesen: "gelesen", ungelesen: "ungelesen" };
const dayOf = (value: Date | string) => new Date(value).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
const timeOf = (value: Date | string) => new Date(value).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
const stampOf = (value: Date | string) => new Date(value).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
/** Zeilen ohne Zitat/Signatur-Ballast fürs Kürzen. */
const shorten = (text: string, max: number) => { const clean = text.replace(/\s+/g, " ").trim(); return clean.length > max ? `${clean.slice(0, max).trimEnd()} …` : clean; };

export function useEmailThread(publicId: string, enabled = true) {
  return trpc.leadops.leadEmailThread.useQuery({ publicId }, { retry: false, enabled });
}

export default function EmailThread({ publicId, thread, compact = false, limit = 3, onOpenAll }: { publicId: string; thread?: EmailThreadData; compact?: boolean; limit?: number; onOpenAll?: () => void }) {
  const query = useEmailThread(publicId, !thread);
  const data = thread ?? query.data;
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (!data) return <p className="mail-thread-empty">{query.isLoading ? "E-Mails werden geladen …" : query.error?.message ?? "Kein Verlauf."}</p>;
  if (!data.items.length) return <p className="mail-thread-empty">Noch kein E-Mail-Verkehr{data.email ? <> mit <b>{data.email}</b></> : null}. Antworten aus dem Posteingang, Einzel-E-Mails und Serien erscheinen hier automatisch.</p>;
  const hidden = compact && !showAll ? Math.max(0, data.items.length - limit) : 0;
  const items = hidden ? data.items.slice(hidden) : data.items;
  const createdAt = data.leadCreatedAt ? new Date(data.leadCreatedAt).getTime() : null;
  const rows: Array<{ type: "day"; key: string; label: string } | { type: "mark"; key: string } | { type: "item"; key: string; item: Item }> = [];
  let lastDay = ""; let marked = createdAt === null || data.before === 0 || hidden >= data.before;
  for (const item of items) {
    const at = new Date(item.at).getTime();
    if (!marked && createdAt !== null && at >= createdAt) { rows.push({ type: "mark", key: "mark" }); marked = true; }
    const day = dayOf(item.at);
    if (day !== lastDay && !compact) { rows.push({ type: "day", key: `day-${day}-${item.key}`, label: day }); lastDay = day; }
    rows.push({ type: "item", key: item.key, item });
  }
  if (!marked && createdAt !== null) rows.push({ type: "mark", key: "mark" });
  return <div className={`mail-thread ${compact ? "is-compact" : ""}`} aria-label="E-Mail-Verlauf">
    {hidden > 0 && <button type="button" className="mail-thread-older" onClick={() => setShowAll(true)}>{hidden} ältere E-Mail{hidden === 1 ? "" : "s"} anzeigen</button>}
    {!compact && data.before > 0 && <p className="mail-thread-hint"><Mail className="h-3.5 w-3.5" /> {data.before === 1 ? "Eine E-Mail wurde" : `${data.before} E-Mails wurden`} schon vor dem Anlegen des Leads ausgetauscht – hier der ganze Verlauf.</p>}
    <ol className="mail-thread-list">
      {rows.map((row) => {
        if (row.type === "day") return <li key={row.key} className="mail-thread-day"><span>{row.label}</span></li>;
        if (row.type === "mark") return <li key={row.key} className="mail-thread-mark"><span>Als Lead angelegt{createdAt !== null ? ` · ${stampOf(new Date(createdAt))}` : ""}</span></li>;
        const { item } = row; const isOpen = open[item.key] ?? false; const text = (item.text ?? "").trim();
        const long = compact ? text.length > 140 : text.split("\n").length > 6 || text.length > 420;
        const shown = isOpen ? text : compact ? shorten(text, 140) : long ? `${text.slice(0, 420).trimEnd()} …` : text;
        const ai = item.kind === "eingang" && item.aiKind && item.aiKind in REPLY_KIND_LABEL ? REPLY_KIND_LABEL[item.aiKind as ReplyKind] : null;
        return <li key={row.key} className={`mail-thread-item is-${item.direction} kind-${item.kind}${item.blocked ? " is-blocked" : ""}`}>
          <div className="mail-thread-meta">
            <span className="mail-thread-kind">{item.direction === "ein" ? <ArrowDownLeft className="h-3 w-3" /> : item.kind === "serie" ? <Send className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />} {KIND_LABEL[item.kind]}</span>
            <strong>{item.who ?? item.address ?? "–"}</strong>
            <time dateTime={new Date(item.at).toISOString()} title={stampOf(item.at)}>{compact ? stampOf(item.at) : timeOf(item.at)}</time>
          </div>
          <div className="mail-thread-bubble">
            <div className="mail-thread-subject">{item.subject || "(kein Betreff)"}</div>
            {shown ? <pre className="mail-thread-text">{shown}</pre> : null}
            {long && <button type="button" className="mail-thread-more" onClick={() => setOpen((value) => ({ ...value, [item.key]: !isOpen }))}>{isOpen ? "Weniger" : "Ganze E-Mail"}</button>}
          </div>
          {(ai || item.blocked || (item.direction === "aus" && item.status)) && <div className="mail-thread-tags">
            {ai && <span className={`mail-thread-tag ai-${item.aiKind}`}>KI: {ai}</span>}
            {item.blocked && <span className="mail-thread-tag is-blocked">Absender gesperrt</span>}
            {item.direction === "aus" && item.status && <span className="mail-thread-tag">{STATUS_LABEL[item.status] ?? item.status}</span>}
          </div>}
        </li>;
      })}
    </ol>
    {compact && onOpenAll && <button type="button" className="mail-thread-all" onClick={onOpenAll}>Ganzen Verlauf auf der Lead-Seite öffnen</button>}
  </div>;
}
