import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { DELIVERY_LABEL, isBadDelivery } from "../../../shared/sent-tracking";
import { trpc } from "@/lib/trpc";
import { confirmAction } from "@/lib/confirm";
import { AlertTriangle, Ban, CalendarClock, CheckCheck, Clock3, ExternalLink, Eye, Flag, GitBranch, Mail, MailX, MousePointerClick, Reply, Send, ShieldAlert, X } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { SentMailPreview } from "@/components/InboxPanel";

/**
 * Kontakt in einer E-Mail-Kampagne – Seitenleiste rechts statt großem Fenster.
 * Oben: wer, Stand und die fünf Meilensteine (gesendet → zugestellt → geöffnet → geklickt → geantwortet).
 * Dann „Als Nächstes“ (was wann passiert) und darunter EIN Verlauf mit allem, was passiert ist – neueste zuerst.
 * Unten die Aktionen (geantwortet, unzustellbar, Beschwerde, entfernen, Karte öffnen).
 */
const when = (value: string | Date | null | undefined) => value ? new Date(value).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : null;
const day = (value: string | Date | null | undefined) => value ? new Date(value).toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "long" }) : "";
const STATUS: Record<string, { label: string; tone: string }> = {
  wartet: { label: "Wartet auf den nächsten Schritt", tone: "is-wait" }, laeuft: { label: "Läuft", tone: "is-run" }, fertig: { label: "Fertig", tone: "is-done" },
  fehler: { label: "Fehler", tone: "is-bad" }, abgemeldet: { label: "Abgemeldet", tone: "is-bad" }, bounce: { label: "Unzustellbar", tone: "is-bad" }, beschwerde: { label: "Beschwerde", tone: "is-bad" },
};
type Kind = "gesendet" | "geoeffnet" | "geklickt" | "antwort" | "gewartet" | "verzweigt" | "beendet" | "fehler" | "abgemeldet" | "bounce" | "beschwerde";
const KIND: Record<Kind, { icon: typeof Mail; label: string; tone: string }> = {
  gesendet: { icon: Send, label: "E-Mail gesendet", tone: "is-send" },
  geoeffnet: { icon: Eye, label: "Geöffnet", tone: "is-open" },
  geklickt: { icon: MousePointerClick, label: "Link geklickt", tone: "is-click" },
  antwort: { icon: Reply, label: "Hat geantwortet", tone: "is-reply" },
  gewartet: { icon: Clock3, label: "Wartezeit", tone: "is-quiet" },
  verzweigt: { icon: GitBranch, label: "Abfrage", tone: "is-quiet" },
  beendet: { icon: Flag, label: "Ablauf beendet", tone: "is-quiet" },
  fehler: { icon: AlertTriangle, label: "Fehler beim Versand", tone: "is-bad" },
  abgemeldet: { icon: Ban, label: "Abgemeldet", tone: "is-bad" },
  bounce: { icon: Ban, label: "Unzustellbar", tone: "is-bad" },
  beschwerde: { icon: ShieldAlert, label: "Beschwerde", tone: "is-bad" },
};
const kindOf = (event: { kind: string; note?: string | null }): Kind => event.kind === "geoeffnet" && /^antwort/i.test(event.note ?? "") ? "antwort" : (event.kind in KIND ? event.kind as Kind : "fehler");
/** Kurzer Text unter dem Ereignis – ohne Wiederholung von Titel/Betreff. */
function detailOf(kind: Kind, event: { note?: string | null; subject?: string | null }) {
  const note = (event.note ?? "").trim();
  if (kind === "gesendet") return /Variante [AB]/.test(note) ? note.match(/Variante [AB]/)![0] : null;
  if (kind === "geoeffnet") return /Klick/.test(note) ? "erkannt über den Link-Klick" : null;
  if (kind === "geklickt") return note.replace(/^Link geklickt:\s*/i, "") || null;
  if (kind === "antwort") return note.replace(/^Antwort( im Postfach erkannt)?:?\s*/i, "") || null;
  if (kind === "gewartet") return note.replace(/^Wartet /, "") || null;
  if (kind === "verzweigt") return note.replace(/→ Dann-Zweig/, "→ weiter mit „Dann“").replace(/→ Sonst-Zweig/, "→ weiter mit „Sonst“");
  return note || null;
}

export default function CampaignContactDrawer({ recipientId, onClose, onChanged, onOpenLead, onPrev, onNext }: { recipientId: number | null; onClose: () => void; onChanged?: () => void; onOpenLead?: (publicId: string) => void; onPrev?: () => void; onNext?: () => void }) {
  const log = trpc.leadops.emailRecipientLog.useQuery({ recipientId: recipientId ?? 0 }, { enabled: recipientId !== null, retry: 2, retryDelay: 800, refetchInterval: 30_000, refetchOnWindowFocus: false });
  const utils = trpc.useUtils();
  const done = () => { void utils.leadops.emailRecipientLog.invalidate(); onChanged?.(); };
  const replied = trpc.leadops.markEmailReplied.useMutation({ onSuccess: (result) => { toast.success(result.stopped ? "Als geantwortet markiert – es geht keine weitere E-Mail an diesen Kontakt." : "Als geantwortet markiert."); done(); }, onError: (error) => toast.error(error.message) });
  const bounce = trpc.leadops.markEmailBounced.useMutation({ onSuccess: (result, variables) => { toast.success(`${result.email} gesperrt (${variables.kind === "bounce" ? "unzustellbar" : "Beschwerde"}).`); done(); }, onError: (error) => toast.error(error.message) });
  const remove = trpc.leadops.removeEmailRecipients.useMutation({ onSuccess: () => { toast.success("Aus der Kampagne entfernt – es geht keine weitere E-Mail an diesen Kontakt."); onChanged?.(); onClose(); }, onError: (error) => toast.error(error.message) });
  const data = log.data;
  const [mailOpen, setMailOpen] = useState<number | null>(null); // gesendete E-Mail im Verlauf aufgeklappt
  const r = data?.recipient;
  const status = r ? (r.status === "fertig" && r.repliedAt ? { label: "Gestoppt – hat geantwortet", tone: "is-done" } : STATUS[r.status] ?? { label: r.status, tone: "is-wait" }) : null;
  const name = r ? r.name || data?.lead?.name || r.email : "";
  const initials = name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
  // Zustellung laut Versanddienst (wie in der Kampagnen-Liste): „nicht angekommen“ gewinnt, sonst der Stand der letzten gesendeten E-Mail
  let delivery: { status: string; at: string | Date | null; note: string | null } | null = null;
  for (const event of data?.events ?? []) { if (event.kind !== "gesendet") continue; if (delivery && isBadDelivery(delivery.status)) continue; const item = event as { delivery?: string | null; deliveryNote?: string | null; deliveryAt?: string | Date | null }; delivery = item.delivery ? { status: item.delivery, at: item.deliveryAt ?? null, note: item.deliveryNote ?? null } : null; }
  const deliveryBad = Boolean(delivery && isBadDelivery(delivery.status));
  const milestones: Array<{ key: string; icon: typeof Mail; label: string; at: string | Date | null | undefined; on: boolean; extra: string | null; tone?: string; empty?: string; title?: string }> = r ? [
    { key: "send", icon: Send, label: "Gesendet", at: r.lastSentAt, on: r.sentCount > 0, extra: r.sentCount > 1 ? `${r.sentCount} E-Mails` : null },
    { key: "delivery", icon: deliveryBad ? MailX : CheckCheck, label: deliveryBad ? "Nicht angekommen" : delivery?.status === "verzoegert" ? "Verzögert" : "Zugestellt", at: delivery?.at ?? null, on: delivery?.status === "zugestellt", extra: deliveryBad && delivery ? DELIVERY_LABEL[delivery.status] ?? null : null, tone: deliveryBad ? "is-bad" : delivery?.status === "verzoegert" ? "is-wait" : "", empty: r.sentCount > 0 ? "keine Meldung" : "noch nicht", title: delivery?.note ?? undefined },
    { key: "open", icon: Eye, label: "Geöffnet", at: r.openedAt ?? r.clickedAt ?? r.repliedAt, on: Boolean(r.openedAt || r.clickedAt || r.repliedAt), extra: null },
    { key: "click", icon: MousePointerClick, label: "Geklickt", at: r.clickedAt, on: Boolean(r.clickedAt), extra: null },
    { key: "reply", icon: Reply, label: "Geantwortet", at: r.repliedAt, on: Boolean(r.repliedAt), extra: null },
  ] : [];
  const upcoming = data ? data.steps.filter((step) => step.state === "aktuell" || step.state === "offen") : [];
  const timeline = data ? [...data.events].reverse() : [];
  const groups: Array<{ day: string; items: typeof timeline }> = [];
  for (const event of timeline) { const label = day(event.createdAt); const last = groups[groups.length - 1]; if (last && last.day === label) last.items.push(event); else groups.push({ day: label, items: [event] }); }
  const closed = r ? ["bounce", "beschwerde", "abgemeldet"].includes(r.status) : true;
  return <Sheet open={recipientId !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
    <SheetContent side="right" className="cj-sheet">
      {!data || !r ? <div className="cj-loading"><SheetTitle>Kontakt</SheetTitle><SheetDescription>{log.error ? `Konnte nicht geladen werden: ${log.error.message}` : "Wird geladen …"}</SheetDescription>{log.error && <button type="button" className="cj-ghost" onClick={() => void log.refetch()}>Nochmal versuchen</button>}</div> : <>
        <header className="cj-head">
          <span className="cj-avatar" aria-hidden="true">{initials}</span>
          <div className="cj-who">
            <SheetTitle className="cj-name">{name}</SheetTitle>
            <SheetDescription className="cj-mail">{r.email}{r.company ? ` · ${r.company}` : ""}</SheetDescription>
            <div className="cj-tags">
              {status && <span className={`cj-status ${status.tone}`}>{status.label}</span>}
              {data.lead?.stage && <button type="button" className="cj-stage" title="Karte in der Vertriebspipeline öffnen" onClick={() => data.lead && onOpenLead?.(data.lead.publicId)}>{data.lead.stage.label}{data.lead.owner ? ` · ${data.lead.owner}` : ""}<ExternalLink className="h-3 w-3" aria-hidden="true" /></button>}
              {r.variant && <span className="cj-tag">Variante {r.variant}</span>}
            </div>
          </div>
          {(onPrev || onNext) && <div className="cj-nav"><button type="button" className="cj-ghost" disabled={!onPrev} onClick={onPrev} aria-label="Vorheriger Kontakt">‹</button><button type="button" className="cj-ghost" disabled={!onNext} onClick={onNext} aria-label="Nächster Kontakt">›</button></div>}
        </header>

        <div className="cj-body">
          <ol className="cj-milestones" aria-label="Fortschritt">{milestones.map((item) => { const Icon = item.icon; const shown = item.on || Boolean(item.tone); return <li key={item.key} className={`ms-${item.key}${item.on ? " is-on" : ""}${item.tone ? ` ${item.tone}` : ""}`} title={item.title}><span className="cj-ms-dot"><Icon className="h-4 w-4" aria-hidden="true" /></span><strong>{item.label}</strong><small>{shown ? when(item.at) ?? "ja" : item.empty ?? "noch nicht"}{item.extra ? ` · ${item.extra}` : ""}</small></li>; })}</ol>

          {data.errors.length > 0 && <section className="cj-alert"><AlertTriangle className="h-4 w-4" aria-hidden="true" /><div><strong>{data.errors.length === 1 ? "Versand hat nicht geklappt" : `${data.errors.length} Fehler beim Versand`}</strong>{data.errors.slice(0, 3).map((error, index) => <small key={index}>{when(error.at)} · {error.note}</small>)}</div></section>}

          <section className="cj-next">
            <span className="cj-section-title"><CalendarClock className="h-4 w-4" aria-hidden="true" /> Als Nächstes</span>
            {upcoming.length ? <ol>{upcoming.map((step, index) => <li key={step.id} className={step.state === "aktuell" ? "is-now" : ""}><strong>{step.title}</strong>{index === 0 && data.waiting ? <small>{data.waiting}</small> : step.detail ? <small>{step.detail}</small> : null}</li>)}</ol> : <p>{r.status === "fertig" ? (r.repliedAt ? "Nichts mehr – der Kontakt hat geantwortet, die Serie ist gestoppt." : "Nichts mehr – der Ablauf ist durch.") : closed ? "Nichts mehr – diese Adresse wird nicht mehr angeschrieben." : r.status === "fehler" ? "Angehalten wegen eines Fehlers." : "Keine weiteren Schritte."}</p>}
          </section>

          <section className="cj-timeline">
            <span className="cj-section-title"><Clock3 className="h-4 w-4" aria-hidden="true" /> Verlauf</span>
            {!groups.length ? <p className="cj-empty">Noch nichts passiert – aufgenommen am {when(r.createdAt)}.</p> : groups.map((group) => <div key={group.day} className="cj-day"><span className="cj-day-label">{group.day}</span><ol>{group.items.map((event) => { const kind = kindOf(event); const meta = KIND[kind]; const Icon = meta.icon; const detail = detailOf(kind, event); return <li key={event.id} className={meta.tone}><span className="cj-dot"><Icon className="h-3.5 w-3.5" aria-hidden="true" /></span><div className="cj-event"><div className="cj-event-top"><strong>{meta.label}</strong><time>{new Date(event.createdAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}</time></div>{kind === "gesendet" && event.subject && <span className="cj-subject">„{event.subject}“</span>}{kind === "gesendet" && (() => { const delivery = event as { delivery?: string | null; deliveryNote?: string | null; deliveryAt?: Date | string | null }; if (!delivery.delivery) return null; const bad = delivery.delivery !== "zugestellt" && delivery.delivery !== "verzoegert"; return <span className={`cj-delivery ${delivery.delivery === "zugestellt" ? "is-ok" : bad ? "is-bad" : "is-wait"}`} title={delivery.deliveryNote ?? undefined}>{delivery.delivery === "zugestellt" ? "Zugestellt" : delivery.delivery === "verzoegert" ? "Zustellung verzögert" : `Nicht angekommen: ${DELIVERY_LABEL[delivery.delivery] ?? delivery.delivery}`}{delivery.deliveryAt ? ` · ${new Date(delivery.deliveryAt).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : ""}{bad && delivery.deliveryNote ? ` – ${delivery.deliveryNote}` : ""}</span>; })()}{detail && <small>{detail}</small>}{kind === "gesendet" && <button type="button" className="cj-mail-toggle" aria-expanded={mailOpen === event.id} onClick={() => setMailOpen(mailOpen === event.id ? null : event.id)}><Eye className="h-3.5 w-3.5" aria-hidden="true" /> {mailOpen === event.id ? "E-Mail ausblenden" : "E-Mail ansehen – so ging sie raus"}</button>}{kind === "gesendet" && mailOpen === event.id && <div className="cj-mail"><SentMailPreview id={`k${event.id}`} onClose={() => setMailOpen(null)} /></div>}</div></li>; })}</ol></div>)}
            <p className="cj-start">Aufgenommen am {when(r.createdAt)}</p>
          </section>

          {data.runs.length > 1 && <section className="cj-runs"><span className="cj-section-title"><Mail className="h-4 w-4" aria-hidden="true" /> In anderen Kampagnen</span><ul>{data.runs.filter((run) => run.id !== r.id).map((run) => <li key={run.id}><strong>{run.campaignName}</strong><small>{STATUS[run.status]?.label ?? run.status} · {run.sentCount} gesendet</small></li>)}</ul></section>}
        </div>

        <footer className="cj-actions">
          {!r.repliedAt && !closed && <button type="button" className="cj-btn" disabled={replied.isPending} onClick={() => replied.mutate({ recipientId: r.id })}><Reply className="h-4 w-4" /> Hat geantwortet</button>}
          {!closed && <button type="button" className="cj-btn" disabled={bounce.isPending} onClick={async () => { if (await confirmAction(`${r.email} als unzustellbar sperren? Die Adresse wird nie wieder angeschrieben.`)) bounce.mutate({ recipientId: r.id, kind: "bounce" }); }}><Ban className="h-4 w-4" /> Unzustellbar</button>}
          {!closed && <button type="button" className="cj-btn" disabled={bounce.isPending} onClick={async () => { if (await confirmAction(`${r.email} wegen Beschwerde sperren?`)) bounce.mutate({ recipientId: r.id, kind: "beschwerde" }); }}><ShieldAlert className="h-4 w-4" /> Beschwerde</button>}
          <button type="button" className="cj-btn is-danger" disabled={remove.isPending} onClick={async () => { if (await confirmAction(`${name} aus der Kampagne entfernen? Es geht keine weitere E-Mail an diesen Kontakt, sein Verlauf in dieser Kampagne wird gelöscht.`, { danger: true })) remove.mutate({ campaignId: data.campaign.id, recipientIds: [r.id] }); }}><X className="h-4 w-4" /> Entfernen</button>
        </footer>
      </>}
    </SheetContent>
  </Sheet>;
}
