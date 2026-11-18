/**
 * Verlauf eines Vertrags beim Kunden – die Bausteine dafür in Übersicht und Detail:
 * die kleine Spur in der Liste, der Stand aller Verträge, die fünf Schritte eines Vertrags und der Verlauf als Zeitleiste.
 * Gezählt wird in shared/contract-tracking.ts (dieselbe Rechnung für Server und Vorschau).
 */
import { useState, type CSSProperties } from "react";
import { Ban, Bell, BookOpen, Check, Download, Eye, FilePlus2, Mail, MailOpen, PenLine, Pencil, Phone, Send, X } from "lucide-react";
import { CONTRACT_EVENT_LABEL, type ContractEventKind, type ContractEventView, type ContractStatus } from "../../../shared/contracts";
import { contractFunnel, deviceLabel, EMPTY_TRACKING, hottestOpen, READ_END_DEPTH, SOURCE_NOTE, trackingHint, trackingSteps, whenText, type ContractTracking, type TrackingStepKey, type TrackSource } from "../../../shared/contract-tracking";
import { talkTimeText } from "../../../shared/call-overview";

type Result = { signedAt?: Date | string | null; signerName?: string | null; declinedAt?: Date | string | null; declineReason?: string | null };
const STEP_ICON: Record<TrackingStepKey, typeof Send> = { gesendet: Send, mail: Mail, geoeffnet: Eye, gelesen: BookOpen, ergebnis: PenLine };
const STATE_WORD = { done: "erledigt", todo: "offen", warn: "nicht zustande gekommen" } as const;

/** Fünf Punkte für die Liste: gesendet → E-Mail geöffnet → Vertrag geöffnet → gelesen → unterschrieben. */
export function MiniTrack({ tracking, status, result }: { tracking: ContractTracking | null | undefined; status: ContractStatus; result?: Result }) {
  const steps = trackingSteps(tracking ?? EMPTY_TRACKING, status, result);
  const label = steps.map((step) => `${step.label}: ${STATE_WORD[step.state]}`).join(", ");
  return <span className="vt-track" role="img" aria-label={label} title={steps.map((step) => `${step.state === "done" ? "✓" : step.state === "warn" ? "✕" : "○"} ${step.label}${step.detail && step.detail !== "–" ? ` – ${step.detail}` : ""}`).join("\n")}>
    {steps.map((step) => <i key={step.key} className={`is-${step.state} is-${step.key}`} />)}
  </span>;
}

type StandRow = { id: number; status: ContractStatus; tracking?: ContractTracking | null; title: string; customer: string };
/**
 * Stand aller Verträge: wie viele warten, bei wem sich Nachfassen lohnt – und wie weit die gesendeten Verträge gekommen sind
 * (jede Station zählt alle, die mindestens so weit sind).
 */
export function ContractStand({ rows, onOpen }: { rows: StandRow[]; onOpen: (id: number) => void }) {
  const funnel = contractFunnel(rows); const waiting = rows.filter((row) => row.status === "gesendet" || row.status === "angesehen");
  const hot = hottestOpen(rows); const hint = hot ? trackingHint(hot.tracking ?? EMPTY_TRACKING, hot.status) : null;
  const headline = waiting.length === 0 ? (funnel.sent ? "Kein Vertrag wartet gerade auf Unterschrift" : "Noch kein Vertrag verschickt") : waiting.length === 1 ? "1 Vertrag wartet auf Unterschrift" : `${waiting.length} Verträge warten auf Unterschrift`;
  return <section className="surface-panel vt-stand" aria-label="Stand der Verträge">
    <div className="vt-stand-head">
      <div><h2>{headline}</h2><p>{hot && hint ? <><b>{hot.customer || hot.title}:</b> {hint}</> : funnel.sent ? "Hier siehst du, wie weit deine gesendeten Verträge gekommen sind." : "Sobald du einen Vertrag sendest, siehst du hier, ob er geöffnet, gelesen und unterschrieben wurde."}</p></div>
      {hot && hint && <button type="button" className="vt-stand-open" onClick={() => onOpen(hot.id)}><Phone aria-hidden="true" /> Vertrag ansehen</button>}
    </div>
    <ol className="vt-stations">{funnel.stations.map((station, index) => <li key={station.key} className={`vt-station is-${station.key} ${station.count ? "" : "is-empty"}`} style={{ ["--share" as string]: `${station.share ?? 0}%` } as CSSProperties}>
      <span>{station.label}</span>
      <p><strong>{station.count}</strong>{index > 0 && station.share !== null && <small>{station.share} %</small>}</p>
      <i aria-hidden="true"><b /></i>
    </li>)}</ol>
  </section>;
}

/** Die fünf Schritte eines Vertrags – groß im Detail, mit einem Satz je Schritt und einem Tipp fürs Nachfassen. */
export function TrackerSteps({ tracking, status, result }: { tracking: ContractTracking | null | undefined; status: ContractStatus; result?: Result }) {
  const data = tracking ?? EMPTY_TRACKING; const steps = trackingSteps(data, status, result); const hint = trackingHint(data, status);
  const sent = data.sent.count > 0;
  return <section className="surface-panel vt-tracker" aria-label="Was mit dem Vertrag passiert ist">
    <ol className="vt-steps">{steps.map((step) => { const Icon = step.state === "done" ? Check : step.state === "warn" ? X : STEP_ICON[step.key]; return <li key={step.key} className={`vt-step is-${step.state} is-${step.key}`}>
      <span className="vt-step-mark" aria-hidden="true"><Icon /></span>
      <div><strong>{step.label}</strong><small>{step.detail}</small></div>
    </li>; })}</ol>
    {hint && <p className="vt-hint"><Phone aria-hidden="true" /><span>{hint}</span></p>}
    {sent && <p className="vt-tracker-note">{data.downloads.count > 0 && <span>PDF {data.downloads.count === 1 ? "einmal" : `${data.downloads.count}×`} heruntergeladen, zuletzt {whenText(data.downloads.lastAt)}. </span>}„E-Mail geöffnet“ ist ein Näherungswert – manche Postfächer laden Bilder gar nicht oder von selbst. „Vertrag geöffnet“ ist verlässlich: Dafür wurde der Link angeklickt.</p>}
  </section>;
}

const EVENT_ICON: Record<ContractEventKind, typeof Send> = { erstellt: FilePlus2, geaendert: Pencil, gesendet: Send, erinnert: Bell, angesehen: Eye, unterschrieben: PenLine, abgelehnt: X, storniert: Ban, mail_geoeffnet: MailOpen, pdf_geladen: Download };
const BY_CUSTOMER: ContractEventKind[] = ["angesehen", "mail_geoeffnet", "pdf_geladen", "unterschrieben", "abgelehnt"];
const SHOWN_FIRST = 12;
/** Verlauf als Zeitleiste – neueste zuerst; beim Kunden mit Gerät, Weg (E-Mail oder Link) und Lesezeit. */
export function ContractTimeline({ events }: { events: Array<ContractEventView & { id: number }> }) {
  const [all, setAll] = useState(false); const sorted = [...events].reverse(); const shown = all ? sorted : sorted.slice(0, SHOWN_FIRST);
  return <ol className="vt-timeline">{shown.map((event) => {
    const Icon = EVENT_ICON[event.kind] ?? Eye; const customer = BY_CUSTOMER.includes(event.kind); const device = customer ? deviceLabel(event.userAgent) : null;
    const how = event.kind === "angesehen" && event.source ? SOURCE_NOTE[event.source as TrackSource] ?? null : null;
    const seconds = Number(event.seconds) || 0; const depth = Number(event.depth) || 0;
    const read = event.kind === "angesehen" && seconds > 0 ? `${talkTimeText(seconds)} gelesen${depth >= READ_END_DEPTH ? ", bis zum Ende" : depth > 0 ? `, bis etwa ${depth} %` : ""}` : null;
    const lines = Array.from(new Set([how, read, event.note].filter((value): value is string => Boolean(value))));
    return <li key={event.id} className={`is-${event.kind} ${customer ? "is-customer" : ""}`}>
      <span className="vt-tl-dot" aria-hidden="true"><Icon /></span>
      <div><p><strong>{CONTRACT_EVENT_LABEL[event.kind]}</strong><time>{whenText(event.createdAt)}</time></p>{lines.length > 0 && <small>{lines.join(" – ")}</small>}{(device || (customer && event.ip)) && <small className="vt-tl-meta">{[device, customer ? event.ip : null].filter(Boolean).join(" – ")}</small>}</div>
    </li>; })}
    {sorted.length > shown.length && <li className="vt-tl-more"><button type="button" onClick={() => setAll(true)}>Alle {sorted.length} Einträge zeigen</button></li>}
  </ol>;
}
