import { Button } from "@/components/ui/button";
import { CallAttemptsSection } from "@/components/CallLog";
import { Input } from "@/components/ui/input";
import { confirmAction } from "@/lib/confirm";
import { catPill } from "@/lib/colors";
import { trpc } from "@/lib/trpc";
import { embedded } from "@/lib/voice";
import type { inferRouterOutputs } from "@trpc/server";
import { ArrowLeft, Bell, CalendarDays, Check, Euro, ExternalLink, Mail, MessageSquare, Phone, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { AppRouter } from "../../../server/routers";
import { categoryEmoji } from "../../../shared/category-emoji";
import { CHANNEL_LABELS, euro, formatAppointment, formatDue, normalizePhone, taskKindEmoji, taskKindLabel, TEMPERATURE_HOT_FROM, TEMPERATURE_WARM_FROM, type MessageChannel } from "../../../shared/pipeline-extras";
import { historyLabel, lostStage, nextStageKey, stageLabel, wonStage, type StageDef } from "../../../shared/sales-pipeline";
import LeadActionDialog, { type ActionLead, type ActionMode } from "@/components/LeadActionDialog";
import type { DialTarget } from "@/components/PipelineDialer";
import PipelineNotes from "@/components/PipelineNotes";
import EmailThread, { useEmailThread } from "@/components/EmailThread";

/**
 * Lead-Seite (eigene Seite statt Overlay): öffnet sich nur bewusst – über den Namen oder „Öffnen“ an der Karte, über
 * „Aufgaben“/„Termine“ oder den Link ?lead=… Hier lässt sich der Kontakt komplett bearbeiten: Stammdaten (Anrede, Name,
 * Firma, Telefon, E-Mail, Anschrift, Kategorie), Stufe, Vertriebler, Angebot, Termin, Wiedervorlage, Notizen (mit Mikrofon),
 * Aufgaben, Nachrichten, Anrufe, E-Mail-Serien, E-Mail-Verlauf (alles, was mit der Adresse per Mail hin- und herging, auch
 * vor dem Anlegen des Leads) – und am Ende das Löschen.
 */
type Detail = inferRouterOutputs<AppRouter>["leadops"]["pipelineLeadDetail"];
type Tab = "verlauf" | "notizen" | "aufgaben" | "nachrichten" | "anrufe" | "serien" | "emails";
type MasterData = { salutation: string; firstName: string; lastName: string; company: string; phone: string; email: string; postcode: string; city: string; categoryId: string };
const stamp = (value: Date | string | null | undefined, withTime = true) => value ? new Date(value).toLocaleString("de-DE", withTime ? { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "2-digit", year: "2-digit" }) : "–";
const platformLabel = (platform: string | null) => platform === "instagram" ? "Instagram" : platform === "kaltakquise" ? "Kaltakquise" : platform === "posteingang" ? "Posteingang" : platform === "email" ? "E-Mail-Kampagne" : "Facebook";
const CALL_STATUS: Record<string, string> = { initiiert: "gestartet", klingelt: "klingelt", wartet: "wartet", verbunden: "verbunden", beendet: "beendet", besetzt: "besetzt", keine_antwort: "keine Antwort", anrufbeantworter: "Anrufbeantworter", abgebrochen: "abgebrochen", fehlgeschlagen: "fehlgeschlagen" };
const RECIPIENT_STATUS: Record<string, string> = { wartet: "wartet", laeuft: "läuft", fertig: "fertig", fehler: "Fehler", abgemeldet: "abgemeldet", bounce: "unzustellbar", beschwerde: "Beschwerde" };
/** Platzhalter-Schlüssel lesbar: anzahl_mitarbeiter → Anzahl mitarbeiter */
const fieldLabel = (key: string) => key.replace(/_/g, " ").replace(/^./, (ch) => ch.toUpperCase());
const duration = (seconds: number | null) => seconds === null || seconds === undefined ? "–" : seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} min`;
const masterOf = (lead: Detail): MasterData => ({ salutation: lead.salutation ?? "", firstName: lead.firstName ?? "", lastName: lead.lastName ?? "", company: lead.company ?? "", phone: lead.phone ?? "", email: lead.email ?? "", postcode: lead.postcode ?? "", city: lead.city ?? "", categoryId: lead.categoryId ? String(lead.categoryId) : "" });
/** Link auf diese Lead-Seite (für „Neuer Tab“) – nur außerhalb der Chat-Vorschau, dort hat die Seite keine ladbare Adresse. */
export const leadPageUrl = (publicId: string, source?: string | null) => { try { const params = new URLSearchParams(window.location.search); params.set("page", "Vertriebspipeline"); if (source) params.set("quelle", source); params.set("lead", publicId); return `${window.location.origin}${window.location.pathname}?${params.toString()}`; } catch { return null; } };

export default function PipelineLeadPage({ publicId, stageDefs: fallbackStageDefs, owners, onClose, onChanged, onDial }: { publicId: string; stageDefs: StageDef[]; owners: Array<{ userId: number; name: string; initials?: string }>; onClose: () => void; onChanged: () => void; onDial: (queue: DialTarget[], start: number, mode: "einzel" | "setup", listLabel?: string) => void }) {
  const detail = trpc.leadops.pipelineLeadDetail.useQuery({ publicId }, { retry: false });
  // Jede Pipeline hat eigene Stufen: die Lead-Seite nimmt die Stufen der Pipeline, zu der der Lead gehört (liefert der Server mit).
  const stageDefs = (detail.data as { stages?: StageDef[] } | undefined)?.stages?.length ? (detail.data as { stages: StageDef[] }).stages : fallbackStageDefs;
  const categories = trpc.leadops.listCategories.useQuery(undefined, { retry: false });
  const thread = useEmailThread(publicId);
  const utils = trpc.useUtils();
  const refresh = () => { utils.leadops.pipelineLeadDetail.invalidate({ publicId }); utils.leadops.leadEmailThread.invalidate({ publicId }); onChanged(); };
  const [tab, setTab] = useState<Tab>("verlauf");
  const [action, setAction] = useState<{ mode: ActionMode; channel?: MessageChannel } | null>(null);
  const [master, setMaster] = useState<MasterData | null>(null);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [publicId]);
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !action && !document.querySelector(".app-confirm-backdrop")) onClose(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [onClose, action]);
  const move = trpc.leadops.movePipelineStage.useMutation({ onSuccess: (result) => { toast.success(`${stageLabel(result.from, stageDefs)} → ${stageLabel(result.to, stageDefs)}${result.series ? ` · Serie „${result.series}“ gestartet` : ""}`); refresh(); }, onError: (error) => toast.error(error.message) });
  const assign = trpc.leadops.assignPipelineOwner.useMutation({ onSuccess: (result) => { toast.success(result.ownerName ? `Gehört jetzt ${result.ownerName.split(" ")[0]}.` : "Zuteilung entfernt."); refresh(); }, onError: (error) => toast.error(error.message) });
  const save = trpc.leadops.updatePipelineLead.useMutation({ onSuccess: (result) => { toast.success(result.changed ? `Stammdaten gespeichert (${result.changed} Änderung${result.changed === 1 ? "" : "en"}).` : "Nichts geändert."); setMaster(null); refresh(); }, onError: (error) => toast.error(error.message) });
  const removeLead = trpc.leadops.deletePipelineLead.useMutation({ onSuccess: (result) => { toast.success(`${result.name} gelöscht.`); onChanged(); onClose(); }, onError: (error) => toast.error(error.message) });
  const complete = trpc.leadops.completePipelineTask.useMutation({ onSuccess: () => { toast.success("Erledigt."); refresh(); }, onError: (error) => toast.error(error.message) });
  const lead = detail.data;
  const color = lead?.categoryColor ?? "#8278ff";
  const won = wonStage(stageDefs); const lost = lostStage(stageDefs); const stage = lead?.pipelineStage ?? stageDefs[0]?.key ?? "neu"; const next = stage === won || stage === lost ? null : nextStageKey(stage, stageDefs);
  const actionLead: ActionLead | null = lead ? { publicId: lead.publicId, name: lead.name, firstName: lead.firstName, lastName: lead.lastName, company: lead.company, phone: lead.phone, email: lead.email, categoryName: lead.categoryName, appointmentAt: lead.appointmentAt, dealValue: lead.dealValue ? Number(lead.dealValue) : null, ownerUserId: lead.ownerUserId, metadata: { salutation: lead.salutation } } : null;
  const form = master ?? (lead ? masterOf(lead) : null);
  const dirty = Boolean(lead && master && JSON.stringify(master) !== JSON.stringify(masterOf(lead)));
  const edit = (patch: Partial<MasterData>) => { if (!form) return; setMaster({ ...form, ...patch }); };
  const saveMaster = () => { if (!lead || !form) return; const phone = form.phone.trim() ? normalizePhone(form.phone) : ""; if (form.phone.trim() && !phone) { toast.error("Das ist keine gültige Telefonnummer."); return; } if (!form.firstName.trim() && !form.lastName.trim()) { toast.error("Bitte mindestens Vor- oder Nachname angeben."); return; } save.mutate({ publicId: lead.publicId, salutation: form.salutation || null, firstName: form.firstName.trim() || null, lastName: form.lastName.trim() || null, company: form.company.trim() || null, phone: phone || null, email: form.email.trim() || null, postcode: form.postcode.trim() || null, city: form.city.trim() || null, categoryId: form.categoryId ? Number(form.categoryId) : null }); };
  const dial = () => { if (!lead) return; if (!lead.phone) { toast("Erst eine Telefonnummer eintragen – links bei den Stammdaten."); document.getElementById("lead-page-phone")?.focus(); return; } onDial([{ id: lead.id, publicId: lead.publicId, name: lead.name, phone: lead.phone, stage: stage as DialTarget["stage"], company: lead.company, city: lead.city }], 0, "einzel"); };
  const tabs: Array<[Tab, string, number | null]> = lead ? [["verlauf", "Verlauf", lead.history.length], ["notizen", "Notizen", lead.noteCount], ["aufgaben", "Aufgaben & Termine", lead.tasks.filter((task) => !task.doneAt).length], ["nachrichten", "Nachrichten", lead.messages.length], ["anrufe", "Anrufe", lead.calls.length], ["serien", "E-Mail-Serien", lead.campaigns.length], ["emails", "E-Mail-Verlauf", thread.data?.items.length ?? lead.inbox.length]] : [];
  const newTabUrl = useMemo(() => (lead && !embedded() ? leadPageUrl(lead.publicId, lead.adPlatform === "kaltakquise" ? "kaltakquise" : lead.adPlatform === "email" || lead.adPlatform === "posteingang" ? "email" : "ads") : null), [lead]);
  if (!lead) return <section className="lead-page"><button type="button" className="lead-page-back" onClick={onClose}><ArrowLeft className="h-4 w-4" /> Vertriebspipeline</button><div className="p-10 text-center text-sm text-slate-400">{detail.isLoading ? "Wird geladen …" : detail.error?.message ?? "Lead nicht gefunden."}</div></section>;
  return <section className="lead-page" aria-label={`Lead-Seite: ${lead.name}`} style={{ borderTopColor: color }}>
    <header className="lead-page-head">
      <div className="lead-window-title">
        <button type="button" className="lead-page-back" onClick={onClose}><ArrowLeft className="h-4 w-4" /> Vertriebspipeline</button>
        <div className="lead-page-eyebrow"><span className="lead-window-cat cat-strong" style={catPill(color)}><span aria-hidden="true">{categoryEmoji({ name: lead.categoryName, emoji: lead.categoryEmoji })}</span> {lead.categoryName ?? "–"}{lead.categoryShortcode ? <small> · {lead.categoryShortcode}</small> : null}</span><span className="eyebrow">{platformLabel(lead.adPlatform).toUpperCase()} · {lead.publicId}</span></div>
        <h1>{lead.name}</h1>
        <p>{[lead.company, [lead.postcode, lead.city].filter(Boolean).join(" "), lead.ownerName ? `Vertriebler ${lead.ownerName.split(" ")[0]}` : "nicht zugeteilt", `Stufe ${stageLabel(stage, stageDefs)}`].filter(Boolean).join(" · ")}</p>
        <div className="lead-window-badges">
          {stage !== won && stage !== lost && <span className={`lead-temp is-${lead.temperature}`} title={`${lead.score} von 100 Punkten`}>{lead.temperature === "heiss" ? "🔥 " : ""}{lead.scoreLabel} · {lead.score} Punkte</span>}
          {lead.stale && <span className="card-flag is-stale">💤 seit {lead.staleDays} Tagen keine Bewegung</span>}
          {lead.appointmentAt && new Date(lead.appointmentAt) >= new Date() && <span className="card-flag is-termin"><CalendarDays className="h-3 w-3" /> {formatAppointment(lead.appointmentAt)}</span>}
          {lead.followUpAt && <span className={`card-flag ${new Date(lead.followUpAt) < new Date() ? "is-overdue" : "is-due"}`}><Bell className="h-3 w-3" /> Wiedervorlage {formatDue(lead.followUpAt)}</span>}
          {lead.dealValue ? <span className="dash-pill pipeline-card-value">{euro(lead.dealValue)}</span> : null}
        </div>
      </div>
      <div className="lead-window-controls">
        <label className="lead-action-field">Stufe<select className="lead-action-select" value={stage} onChange={(event) => move.mutate({ publicId: lead.publicId, stage: event.target.value, note: "Auf der Lead-Seite gesetzt" })}>{stageDefs.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
        <label className="lead-action-field">Vertriebler<select className="lead-action-select" value={lead.ownerUserId ?? ""} onChange={(event) => assign.mutate({ publicIds: [lead.publicId], ownerUserId: event.target.value ? Number(event.target.value) : null })}><option value="">– nicht zugeteilt –</option>{owners.map((owner) => <option key={owner.userId} value={owner.userId}>{owner.name}</option>)}</select></label>
        {newTabUrl && <a className="lead-page-newtab" href={newTabUrl} target="_blank" rel="noreferrer" title="Diese Lead-Seite in einem neuen Browser-Tab öffnen"><ExternalLink className="h-3.5 w-3.5" /> Neuer Tab</a>}
        <button type="button" className="lead-window-close" aria-label="Lead-Seite schließen" title="Schließen (Esc)" onClick={onClose}><X className="h-4 w-4" /></button>
      </div>
    </header>
    <div className="lead-window-actions">
      <Button size="sm" className="flux-button" onClick={dial}><Phone /> {lead.phone ? "Anrufen" : "Nummer + Anrufen"}</Button>
      <Button size="sm" variant="outline" onClick={() => setAction({ mode: "wiedervorlage" })}><Bell /> Wiedervorlage</Button>
      <Button size="sm" variant="outline" onClick={() => setAction({ mode: "termin" })}><CalendarDays /> Termin</Button>
      <Button size="sm" variant="outline" onClick={() => setAction({ mode: "wert" })}><Euro /> Wert</Button>
      <Button size="sm" variant="outline" disabled={!lead.phone} onClick={() => setAction({ mode: "nachricht", channel: "sms" })}><MessageSquare /> SMS</Button>
      <Button size="sm" variant="outline" disabled={!lead.phone} onClick={() => setAction({ mode: "nachricht", channel: "whatsapp" })}><span aria-hidden="true">🟢</span> WhatsApp</Button>
      <Button size="sm" variant="outline" disabled={!lead.email} onClick={() => setAction({ mode: "nachricht", channel: "email" })}><Mail /> E-Mail</Button>
      <span className="lead-window-spacer" />
      {next && <Button size="sm" variant="outline" disabled={move.isPending} onClick={() => move.mutate({ publicId: lead.publicId, stage: next })}>→ {stageLabel(next, stageDefs)}</Button>}
      {stage !== won && stage !== lost && <Button size="sm" variant="ghost" disabled={move.isPending} onClick={async () => { if (await confirmAction(`${lead.name} als ${stageLabel(lost, stageDefs).toLowerCase()} markieren?`, { danger: true })) move.mutate({ publicId: lead.publicId, stage: lost, note: `Als ${stageLabel(lost, stageDefs)} markiert` }); }}>{stageLabel(lost, stageDefs)}</Button>}
      {(stage === lost || stage === won) && <Button size="sm" variant="ghost" disabled={move.isPending} onClick={() => move.mutate({ publicId: lead.publicId, stage: stageDefs[1]?.key ?? stageDefs[0].key, note: "Wieder aufgenommen" })}>Wieder aufnehmen</Button>}
    </div>
    <div className="lead-page-body">
      <aside className="lead-window-side">
        <section className="lead-page-master">
          <div className="flex items-center justify-between gap-2"><span className="eyebrow">STAMMDATEN</span>{dirty && <small className="text-xs text-amber-200">nicht gespeichert</small>}</div>
          {form && <div className="lead-page-form">
            <label className="lead-action-field">Anrede<select className="lead-action-select" value={form.salutation} onChange={(event) => edit({ salutation: event.target.value })}><option value="">–</option><option value="herr">Herr</option><option value="frau">Frau</option></select></label>
            <label className="lead-action-field">Kategorie<select className="lead-action-select" value={form.categoryId} onChange={(event) => edit({ categoryId: event.target.value })}>{!form.categoryId && <option value="">–</option>}{(categories.data ?? []).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
            <label className="lead-action-field">Vorname<Input value={form.firstName} onChange={(event) => edit({ firstName: event.target.value })} /></label>
            <label className="lead-action-field">Nachname<Input value={form.lastName} onChange={(event) => edit({ lastName: event.target.value })} /></label>
            <label className="lead-action-field is-wide">Firma<Input value={form.company} onChange={(event) => edit({ company: event.target.value })} /></label>
            <label className="lead-action-field is-wide">Telefon<Input id="lead-page-phone" placeholder="+49 …" value={form.phone} onChange={(event) => edit({ phone: event.target.value })} />{!lead.phone && !form.phone.trim() && <small className="text-amber-200">fehlt – für den Dialer eintragen</small>}</label>
            <label className="lead-action-field is-wide">E-Mail<Input type="email" value={form.email} onChange={(event) => edit({ email: event.target.value })} /></label>
            <label className="lead-action-field">PLZ<Input value={form.postcode} onChange={(event) => edit({ postcode: event.target.value })} /></label>
            <label className="lead-action-field">Ort<Input value={form.city} onChange={(event) => edit({ city: event.target.value })} /></label>
            <div className="is-wide flex flex-wrap items-center justify-between gap-2"><small className="text-xs text-slate-500">{lead.phone ? <a className="text-violet-200 hover:underline" href={`tel:${lead.phone.replace(/\s+/g, "")}`}>{lead.phone}</a> : "ohne Telefon"}{lead.email ? <> · <a className="text-violet-200 hover:underline" href={`mailto:${lead.email}`}>{lead.email}</a></> : null}</small><div className="flex gap-2">{dirty && <Button size="sm" variant="ghost" onClick={() => setMaster(null)}>Verwerfen</Button>}<Button size="sm" className="flux-button" disabled={!dirty || save.isPending} onClick={saveMaster}><Check /> Speichern</Button></div></div>
          </div>}
        </section>
        <section><span className="eyebrow">HERKUNFT</span><dl className="lead-kv mt-2"><div><dt>Quelle</dt><dd>{platformLabel(lead.adPlatform)}</dd></div>{lead.adPlatform === "kaltakquise" ? <div><dt>Liste</dt><dd>{(lead.adCampaignName ?? lead.listName ?? "").replace(/^Liste: /, "") || "–"}</dd></div> : lead.adPlatform === "email" || lead.adPlatform === "posteingang" ? <div><dt>E-Mail-Kampagne</dt><dd>{lead.adCampaignName ?? "–"}</dd></div> : <><div><dt>Kampagne</dt><dd>{lead.adCampaignName ?? "–"}</dd></div><div><dt>Anzeigengruppe</dt><dd>{lead.adsetName ?? "–"}</dd></div><div><dt>Anzeige</dt><dd>{lead.adName ?? "–"}</dd></div><div><dt>Formular</dt><dd>{lead.adFormName ?? "–"}</dd></div></>}<div><dt>Eingegangen</dt><dd>{stamp(lead.createdAt)}</dd></div><div><dt>Letzte Bewegung</dt><dd>{stamp(lead.lastActivityAt)}</dd></div>{lead.lastCallDisposition && <div><dt>Letzter Anruf</dt><dd>{lead.lastCallDisposition}</dd></div>}</dl>{lead.notesFromImport && <p className="lead-window-import-note">{lead.notesFromImport}</p>}</section>
        {Object.keys(lead.fields ?? {}).length > 0 && <section><span className="eyebrow">AUS DER LISTE</span><p className="mt-1 text-xs text-slate-500">Zusatzspalten der hochgeladenen Liste – als Platzhalter in E-Mails und Nachrichten nutzbar.</p><dl className="lead-kv mt-2">{Object.entries(lead.fields ?? {}).map(([key, value]) => <div key={key}><dt title={`Platzhalter {{${key}}}`}>{fieldLabel(key)}</dt><dd>{value}</dd></div>)}</dl></section>}
        <CallAttemptsSection publicId={lead.publicId} name={lead.name} />
        <section className="lead-temp-section"><span className="eyebrow">EINSCHÄTZUNG</span>
          <div className="lead-temp-head"><span className={`lead-temp is-${lead.temperature}`}>{lead.temperature === "heiss" ? "🔥 " : ""}{lead.scoreLabel}</span><strong>{lead.score} / 100</strong></div>
          <div className="lead-temp-bar" aria-hidden="true"><span className={`is-${lead.temperature}`} style={{ width: `${Math.max(2, lead.score)}%` }} /></div>
          <p className="mt-1 text-xs text-slate-500">{stage === won ? "Kunde geworden – die Einschätzung ist abgeschlossen." : stage === lost ? "Als verloren markiert." : `Ab ${TEMPERATURE_HOT_FROM} Punkten heiß, ab ${TEMPERATURE_WARM_FROM} warm. Was zählt:`}</p>
          {stage !== won && stage !== lost && <ul className="lead-temp-reasons">{(lead.scoreReasons ?? []).map((reason: string) => <li key={reason}>{reason}</li>)}</ul>}
        </section>
        <section><span className="eyebrow">ANGEBOT & TERMINE</span><dl className="lead-kv mt-2"><div><dt>Angebotswert</dt><dd>{lead.dealValue ? euro(lead.dealValue) : "–"} <button type="button" className="text-[11px] text-violet-200 hover:underline" onClick={() => setAction({ mode: "wert" })}>ändern</button></dd></div><div><dt>Termin</dt><dd>{lead.appointmentAt ? formatAppointment(lead.appointmentAt) : "–"} <button type="button" className="text-[11px] text-violet-200 hover:underline" onClick={() => setAction({ mode: "termin" })}>{lead.appointmentAt ? "ändern" : "eintragen"}</button></dd></div><div><dt>Wiedervorlage</dt><dd>{lead.followUpAt ? formatDue(lead.followUpAt) : "–"} <button type="button" className="text-[11px] text-violet-200 hover:underline" onClick={() => setAction({ mode: "wiedervorlage" })}>neu</button></dd></div><div><dt>Offene Aufgaben</dt><dd>{lead.openTasks}</dd></div></dl></section>
        <section className="lead-page-danger"><span className="eyebrow">LÖSCHEN</span><p className="mt-1 text-xs text-slate-500">Entfernt den Kontakt samt Aufgaben, Verlauf, Notizen und Nachrichten aus der Pipeline. Nicht rückgängig zu machen.</p><Button size="sm" variant="ghost" className="mt-2 text-red-200 hover:text-red-100" disabled={removeLead.isPending} onClick={async () => { if (await confirmAction(`${lead.name} endgültig aus der Pipeline löschen?`, { danger: true })) removeLead.mutate({ publicId: lead.publicId }); }}><Trash2 className="h-4 w-4" /> Kontakt löschen</Button></section>
      </aside>
      <section className="lead-window-main">
        <div className="dashboard-segments lead-window-tabs">{tabs.map(([key, label, count]) => <button key={key} type="button" className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}{count ? <span className="count">{count}</span> : null}</button>)}</div>
        <div className="lead-window-tab">
          {tab === "verlauf" && (lead.history.length ? <ul className="lead-window-list">{lead.history.map((event) => <li key={event.id}><strong>{historyLabel(event.toStage, stageDefs)}</strong>{event.fromStage && event.fromStage !== event.toStage && stageDefs.some((item) => item.key === event.fromStage) ? <small> von {stageLabel(event.fromStage, stageDefs)}</small> : null}{event.note && <p>{event.note}</p>}<small>{stamp(event.createdAt)} · {event.actor}</small></li>)}</ul> : <p className="lead-window-empty">Noch kein Verlauf.</p>)}
          {tab === "notizen" && <PipelineNotes publicId={lead.publicId} onChanged={refresh} />}
          {tab === "aufgaben" && (lead.tasks.length ? <ul className="lead-window-list">{lead.tasks.map((task) => <li key={task.id} className={task.doneAt ? "is-done" : ""}><strong>{taskKindEmoji(task.kind)} {task.title}</strong>{task.note && <p>{task.note}</p>}<small>{taskKindLabel(task.kind)} · {task.doneAt ? `erledigt ${stamp(task.doneAt)}` : `fällig ${formatDue(task.dueAt)}`}{task.ownerName ? ` · ${task.ownerName}` : ""}</small>{!task.doneAt && <button type="button" className="lead-window-done" disabled={complete.isPending} onClick={() => complete.mutate({ id: task.id })}><Check className="h-3 w-3" /> Erledigt</button>}</li>)}</ul> : <p className="lead-window-empty">Keine Aufgaben oder Termine. <button type="button" className="text-violet-200 hover:underline" onClick={() => setAction({ mode: "wiedervorlage" })}>Wiedervorlage anlegen</button></p>)}
          {tab === "nachrichten" && (lead.messages.length ? <ul className="lead-window-list">{lead.messages.map((message) => <li key={message.id}><strong>{CHANNEL_LABELS[message.channel as MessageChannel] ?? message.channel}{message.subject ? ` · ${message.subject}` : ""}</strong><p>{message.text}</p><small>{stamp(message.createdAt)} · {message.author} · {message.status}{message.error ? ` · ${message.error}` : ""}</small></li>)}</ul> : <p className="lead-window-empty">Noch keine Nachricht gesendet.</p>)}
          {tab === "anrufe" && (lead.calls.length ? <ul className="lead-window-list">{lead.calls.map((call) => <li key={call.id}><strong>{CALL_STATUS[call.status] ?? call.status}{call.disposition ? ` · ${call.disposition}` : ""}</strong>{call.summary ? <p>{call.summary}</p> : call.notes ? <p>{call.notes}</p> : null}<small>{stamp(call.startedAt)} · {duration(call.talkSeconds ?? call.durationSeconds)}{call.agent ? ` · ${call.agent}` : ""} · {call.toNumber}</small></li>)}</ul> : <p className="lead-window-empty">Noch kein Anruf. <button type="button" className="text-violet-200 hover:underline" onClick={dial}>Jetzt anrufen</button></p>)}
          {tab === "serien" && (lead.campaigns.length ? <ul className="lead-window-list">{lead.campaigns.map((row) => <li key={row.id}><strong>{row.campaignName}</strong><p>{RECIPIENT_STATUS[row.status] ?? row.status} · {row.sentCount} gesendet{row.variant ? ` · Variante ${row.variant}` : ""}</p><small>{row.lastSentAt ? `zuletzt ${stamp(row.lastSentAt)}` : "noch nichts gesendet"}{row.openedAt ? ` · geöffnet ${stamp(row.openedAt)}` : ""}{row.clickedAt ? ` · geklickt ${stamp(row.clickedAt)}` : ""}{row.repliedAt ? ` · geantwortet ${stamp(row.repliedAt)}` : ""}</small></li>)}</ul> : <p className="lead-window-empty">In keiner E-Mail-Serie.</p>)}
          {tab === "emails" && <EmailThread publicId={lead.publicId} thread={thread.data} />}
        </div>
      </section>
    </div>
    {action && actionLead && <LeadActionDialog lead={actionLead} mode={action.mode} initialChannel={action.channel} owners={owners} onClose={() => setAction(null)} onChanged={refresh} />}
  </section>;
}
