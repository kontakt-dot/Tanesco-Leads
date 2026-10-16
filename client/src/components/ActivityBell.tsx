import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Activity, ArrowDownToLine, Bell, ClipboardCheck, Flame, HandCoins, Headphones, PhoneCall, Play, Reply, Route, Send, ShieldAlert, ShoppingBag, Undo2, UserPlus, X } from "lucide-react";
import type { ActivityDay, ActivityEntry, ActivityKind } from "../../../shared/activity";

/**
 * Glocke oben rechts: Was ist auf der Plattform passiert?
 * Kein Strom einzelner Meldungen, sondern ein Tagesverlauf: je Tag eine Zeile mit der Zusammenfassung
 * („120 neue Kontakte · 14 Anrufe · 2 Leads verkauft“), aufklappbar bis zum einzelnen Eintrag.
 * Der Punkt an der Glocke zählt, was seit dem letzten Öffnen dazugekommen ist (gemerkt im Browser).
 */
const ICON: Record<ActivityKind, typeof Bell> = {
  kontakt_neu: UserPlus, lead_neu: Flame, upload_rueckgaengig: Undo2, anruf: PhoneCall, gespraech_abgehoert: Headphones, gespraech_bewertet: ClipboardCheck,
  lead_verkauft: HandCoins, bestellung: ShoppingBag, reklamation: ShieldAlert, pipeline_stufe: Route, pipeline_uebernommen: ArrowDownToLine,
  email_gesendet: Send, email_antwort: Reply, email_fehler: ShieldAlert, kampagne: Play, sonstiges: Activity,
};
const SEEN_KEY = "tanesco-activity-seen";
const readSeen = () => { try { return localStorage.getItem(SEEN_KEY); } catch { return null; } };
const writeSeen = (value: string) => { try { localStorage.setItem(SEEN_KEY, value); } catch { /* privater Modus o. ä. – dann zählt der Punkt eben alles */ } };
const clock = (value: Date | string) => new Date(value).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

export default function ActivityBell({ onOpenLead }: { onOpenLead?: (publicId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [since, setSince] = useState<string | null>(() => readSeen());
  const [expandedDays, setExpandedDays] = useState<Record<string, boolean>>({});
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [fullGroups, setFullGroups] = useState<Record<string, boolean>>({});
  const box = useRef<HTMLDivElement | null>(null);
  const feed = trpc.leadops.activityFeed.useQuery({ days: 14, since: since ? new Date(since) : null }, { retry: false, refetchInterval: 60_000, refetchOnWindowFocus: true });
  const newCount = feed.data?.newCount ?? 0;
  const days = feed.data?.days ?? [];

  // Öffnen: als gesehen markieren (Punkt verschwindet), schließen bei Klick außerhalb oder Escape
  const toggle = () => { setOpen((value) => { const next = !value; if (next) { const now = new Date().toISOString(); writeSeen(now); setTimeout(() => setSince(now), 400); } return next; }); };
  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => { if (box.current && !box.current.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onClick); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const isDayOpen = (day: ActivityDay, index: number) => expandedDays[day.day] ?? index === 0;
  const groupKey = (day: ActivityDay, kind: ActivityKind) => `${day.day}:${kind}`;
  const openLead = (publicId: string) => { setOpen(false); if (onOpenLead) onOpenLead(publicId); else window.location.assign(`/?page=Vertriebspipeline&lead=${publicId}`); };

  return <div className="activity-bell" ref={box}>
    <button type="button" aria-label={newCount ? `Benachrichtigungen: ${newCount} neue Einträge` : "Benachrichtigungen"} aria-expanded={open} className={`notification ${newCount ? "has-new" : ""}`} onClick={toggle}><Bell />{newCount > 0 && <i aria-hidden="true">{newCount > 99 ? "99+" : newCount}</i>}</button>
    {open && <div className="activity-panel" role="dialog" aria-label="Verlauf der Plattform">
      <div className="activity-head"><div><strong>Was ist passiert?</strong><small>Verlauf der letzten 14 Tage – je Tag zusammengefasst, zum Aufklappen.</small></div><button type="button" aria-label="Schließen" onClick={() => setOpen(false)}><X /></button></div>
      {feed.isLoading ? <p className="activity-empty">Wird geladen …</p>
        : feed.error ? <p className="activity-empty">{feed.error.message}</p>
        : !days.length ? <p className="activity-empty">Noch nichts passiert. Sobald Kontakte hochgeladen, Anrufe geführt, Leads verkauft oder E-Mails gesendet werden, steht es hier – nach Tagen sortiert.</p>
        : <ol className="activity-days">{days.map((day, index) => <li key={day.day} className={`activity-day ${isDayOpen(day, index) ? "is-open" : ""}`}>
          <button type="button" className="activity-day-head" aria-expanded={isDayOpen(day, index)} onClick={() => setExpandedDays((value) => ({ ...value, [day.day]: !isDayOpen(day, index) }))}>
            <span className="activity-day-label">{day.label}</span>
            <span className="activity-day-total">{day.total} {day.total === 1 ? "Vorgang" : "Vorgänge"}</span>
            <span className="activity-day-summary">{day.summary}</span>
          </button>
          {isDayOpen(day, index) && <ul className="activity-groups">{day.groups.map((group) => { const Icon = ICON[group.kind] ?? Activity; const key = groupKey(day, group.kind); const openGroup = expandedGroups[key] ?? false; const shown = fullGroups[key] ? group.entries : group.entries.slice(0, 6); return <li key={group.kind} className={`activity-group is-${group.kind} ${openGroup ? "is-open" : ""}`}>
            <button type="button" className="activity-group-head" aria-expanded={openGroup} onClick={() => setExpandedGroups((value) => ({ ...value, [key]: !openGroup }))}><Icon aria-hidden="true" /><span>{group.label}</span><small>{group.entries.length === 1 ? "1 Eintrag" : `${group.entries.length} Einträge`}</small></button>
            {openGroup && <ul className="activity-entries">{shown.map((entry: ActivityEntry) => <li key={entry.id} className="activity-entry">
              <time>{clock(entry.createdAt)}</time>
              <div><span className="activity-entry-title">{entry.title}</span>{entry.detail ? <small>{entry.detail}</small> : null}{entry.actorName ? <small className="activity-entry-actor">von {entry.actorName}</small> : null}</div>
              {entry.leadPublicId ? <button type="button" className="activity-entry-lead" title="Lead öffnen" onClick={() => openLead(entry.leadPublicId!)}>{entry.leadPublicId}</button> : null}
            </li>)}{group.entries.length > shown.length && <li className="activity-more"><button type="button" onClick={() => setFullGroups((value) => ({ ...value, [key]: true }))}>Alle {group.entries.length} anzeigen</button></li>}</ul>}
          </li>; })}</ul>}
        </li>)}</ol>}
    </div>}
  </div>;
}
