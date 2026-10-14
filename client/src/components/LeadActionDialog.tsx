import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { Bell, CalendarDays, Euro, MessageSquare, Send, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CHANNEL_LABELS, fillMessage, formatAppointment, MESSAGE_TEMPLATES, messageValues, normalizePhone, parseMoney, SMS_LIMIT, TASK_KINDS, type MessageChannel, type TaskKind } from "../../../shared/pipeline-extras";

/**
 * Aktionen an einer Pipeline-Karte als kleiner Dialog:
 *  - Wiedervorlage/Aufgabe (erscheint unter „Aufgaben“), Termin (Kalender, Einladung mit Kalendereintrag, Erinnerung),
 *  - Angebotswert (Pipeline-Wert, Umsatz je Vertriebler), Nachricht per SMS/WhatsApp/E-Mail (Vorlagen mit Platzhaltern).
 */
export type ActionLead = { publicId: string; name: string; firstName?: string | null; lastName?: string | null; company?: string | null; phone?: string | null; email?: string | null; categoryName?: string | null; appointmentAt?: Date | string | null; dealValue?: number | null; ownerUserId?: number | null; metadata?: unknown };
export type ActionMode = "wiedervorlage" | "termin" | "wert" | "nachricht";
const pad = (value: number) => String(value).padStart(2, "0");
/** Datum für <input type="datetime-local"> (lokale Zeit). */
export const toLocalInput = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
const defaultDue = (daysAhead: number, hour: number) => { const date = new Date(); date.setDate(date.getDate() + daysAhead); date.setHours(hour, 0, 0, 0); return date; };

export default function LeadActionDialog({ lead, mode, onClose, onChanged, owners = [], initialChannel }: { lead: ActionLead; mode: ActionMode; onClose: () => void; onChanged: () => void; owners?: Array<{ userId: number; name: string }>; initialChannel?: MessageChannel }) {
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [onClose]);
  const title = mode === "wiedervorlage" ? "Wiedervorlage / Aufgabe" : mode === "termin" ? "Termin" : mode === "wert" ? "Angebotswert" : "Nachricht senden";
  const Icon = mode === "wiedervorlage" ? Bell : mode === "termin" ? CalendarDays : mode === "wert" ? Euro : MessageSquare;
  return <div className="app-confirm-backdrop lead-action-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="app-confirm lead-action-dialog" role="dialog" aria-modal="true" aria-label={`${title}: ${lead.name}`}>
      <header className="lead-action-head"><div><span className="eyebrow"><Icon className="inline h-3.5 w-3.5" /> {title.toUpperCase()}</span><h2>{lead.name}</h2><small>{[lead.company, lead.phone, lead.email].filter(Boolean).join(" · ") || "–"}</small></div><button type="button" className="pipeline-dialer-close" aria-label="Schließen" onClick={onClose}><X className="h-4 w-4" /></button></header>
      {mode === "wiedervorlage" && <FollowUpForm lead={lead} owners={owners} onDone={() => { onChanged(); onClose(); }} />}
      {mode === "termin" && <AppointmentForm lead={lead} onDone={() => { onChanged(); onClose(); }} />}
      {mode === "wert" && <DealValueForm lead={lead} onDone={() => { onChanged(); onClose(); }} />}
      {mode === "nachricht" && <MessageForm lead={lead} initialChannel={initialChannel} onDone={() => { onChanged(); onClose(); }} />}
    </div>
  </div>;
}

function FollowUpForm({ lead, owners, onDone }: { lead: ActionLead; owners: Array<{ userId: number; name: string }>; onDone: () => void }) {
  const [kind, setKind] = useState<TaskKind>("anruf"); const [title, setTitle] = useState(""); const [note, setNote] = useState(""); const [due, setDue] = useState(() => toLocalInput(defaultDue(1, 9))); const [owner, setOwner] = useState<string>(lead.ownerUserId ? String(lead.ownerUserId) : "");
  const create = trpc.leadops.createPipelineTask.useMutation({ onSuccess: (result) => { toast.success(`Wiedervorlage gespeichert – ${new Date(result.dueAt).toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}.`); onDone(); }, onError: (error) => toast.error(error.message) });
  const quick: Array<[string, () => Date]> = [["Heute 16 Uhr", () => defaultDue(0, 16)], ["Morgen 9 Uhr", () => defaultDue(1, 9)], ["In 3 Tagen", () => defaultDue(3, 10)], ["Nächste Woche", () => defaultDue(7, 10)]];
  return <div className="lead-action-body">
    <div className="lead-action-kinds">{TASK_KINDS.map((item) => <button key={item.key} type="button" className={`segment-tab ${kind === item.key ? "active" : ""}`} onClick={() => setKind(item.key)}><span aria-hidden="true">{item.emoji}</span> {item.label}</button>)}</div>
    <Input value={title} maxLength={200} placeholder={`Worum geht es? (z. B. „${kind === "anruf" ? "Rückruf wegen Angebot" : kind === "email" ? "Unterlagen schicken" : "Entscheidung nachfragen"}“)`} onChange={(event) => setTitle(event.target.value)} />
    <div className="lead-action-row"><label className="lead-action-field">Fällig am<Input type="datetime-local" value={due} onChange={(event) => setDue(event.target.value)} /></label><label className="lead-action-field">Zuständig<select className="lead-action-select" value={owner} onChange={(event) => setOwner(event.target.value)}><option value="">Wie Karte / ich</option>{owners.map((item) => <option key={item.userId} value={item.userId}>{item.name.split(" ")[0]}</option>)}</select></label></div>
    <div className="lead-action-quick">{quick.map(([label, make]) => <button key={label} type="button" onClick={() => setDue(toLocalInput(make()))}>{label}</button>)}</div>
    <textarea className="lead-action-textarea" rows={2} maxLength={600} placeholder="Notiz (optional)" value={note} onChange={(event) => setNote(event.target.value)} />
    <div className="lead-action-actions"><small>Erscheint unter „Aufgaben“ und als Hinweis an der Karte. Aus dem Dialer entstehen Wiedervorlagen automatisch.</small><Button className="flux-button" disabled={create.isPending || !due} onClick={() => create.mutate({ publicId: lead.publicId, kind, title: title || null, note: note || null, dueAt: new Date(due), ownerUserId: owner ? Number(owner) : null })}><Bell /> Speichern</Button></div>
  </div>;
}

function AppointmentForm({ lead, onDone }: { lead: ActionLead; onDone: () => void }) {
  const meta = (lead.metadata && typeof lead.metadata === "object" ? (lead.metadata as { appointmentLocation?: string | null; appointmentNote?: string | null; appointmentDuration?: number | null }) : {});
  const [when, setWhen] = useState(() => toLocalInput(lead.appointmentAt ? new Date(lead.appointmentAt) : defaultDue(1, 10))); const [duration, setDuration] = useState(String(meta.appointmentDuration ?? 60)); const [location, setLocation] = useState(meta.appointmentLocation ?? ""); const [note, setNote] = useState(meta.appointmentNote ?? ""); const [invite, setInvite] = useState(Boolean(lead.email)); const [moveStage, setMoveStage] = useState(true);
  const save = trpc.leadops.setPipelineAppointment.useMutation({ onSuccess: (result, variables) => { const at = variables.appointmentAt instanceof Date ? variables.appointmentAt : variables.appointmentAt ? new Date(String(variables.appointmentAt)) : null; if (!at) toast.success("Termin entfernt."); else toast.success(`Termin gespeichert: ${formatAppointment(at)}${result.invitation ? ` · Einladung ${result.invitation.status === "gesendet" ? "gesendet" : "simuliert"}` : ""}.`); onDone(); }, onError: (error) => toast.error(error.message) });
  return <div className="lead-action-body">
    <div className="lead-action-row"><label className="lead-action-field">Wann<Input type="datetime-local" value={when} onChange={(event) => setWhen(event.target.value)} /></label><label className="lead-action-field">Dauer<select className="lead-action-select" value={duration} onChange={(event) => setDuration(event.target.value)}>{[30, 45, 60, 90, 120].map((minutes) => <option key={minutes} value={minutes}>{minutes} Minuten</option>)}</select></label></div>
    <Input value={location} maxLength={200} placeholder="Ort (z. B. „Vor Ort beim Kunden“, „Telefon“, „Video“)" onChange={(event) => setLocation(event.target.value)} />
    <textarea className="lead-action-textarea" rows={2} maxLength={400} placeholder="Notiz zum Termin (optional)" value={note} onChange={(event) => setNote(event.target.value)} />
    <label className="lead-action-check"><input type="checkbox" checked={invite} disabled={!lead.email} onChange={(event) => setInvite(event.target.checked)} /> Einladung mit Kalendereintrag per E-Mail schicken{lead.email ? ` (${lead.email})` : " – keine E-Mail-Adresse"}</label>
    <label className="lead-action-check"><input type="checkbox" checked={moveStage} onChange={(event) => setMoveStage(event.target.checked)} /> Karte in die Stufe „Termin“ schieben (nur vorwärts)</label>
    <div className="lead-action-actions"><small>Der Termin steht im Kalender und unter „Aufgaben“; die Erinnerung geht automatisch raus (Automatik).</small><div className="flex gap-2">{lead.appointmentAt && <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate({ publicId: lead.publicId, appointmentAt: null })}><Trash2 /> Entfernen</Button>}<Button className="flux-button" disabled={save.isPending || !when} onClick={() => save.mutate({ publicId: lead.publicId, appointmentAt: new Date(when), durationMinutes: Number(duration) || 60, location: location || null, note: note || null, sendInvitation: invite, moveToStage: moveStage })}><CalendarDays /> Speichern</Button></div></div>
  </div>;
}

function DealValueForm({ lead, onDone }: { lead: ActionLead; onDone: () => void }) {
  const [value, setValue] = useState(lead.dealValue ? String(lead.dealValue).replace(".", ",") : "");
  const save = trpc.leadops.setPipelineDealValue.useMutation({ onSuccess: (result) => { toast.success(result.dealValue === null ? "Angebotswert entfernt." : `Angebotswert ${result.dealValue.toLocaleString("de-DE", { style: "currency", currency: "EUR" })} gespeichert.`); onDone(); }, onError: (error) => toast.error(error.message) });
  const parsed = parseMoney(value);
  return <div className="lead-action-body">
    <label className="lead-action-field">Angebots- bzw. Auftragswert in Euro (netto)<Input inputMode="decimal" value={value} placeholder="z. B. 18.900" onChange={(event) => setValue(event.target.value)} /></label>
    <div className="lead-action-quick">{[5000, 10000, 15000, 25000, 40000].map((amount) => <button key={amount} type="button" onClick={() => setValue(amount.toLocaleString("de-DE"))}>{amount.toLocaleString("de-DE")} €</button>)}</div>
    <div className="lead-action-actions"><small>Fließt in Pipeline-Wert, Abschlussquote in Euro und Umsatz je Vertriebler ein.</small><div className="flex gap-2">{lead.dealValue ? <Button variant="outline" disabled={save.isPending} onClick={() => save.mutate({ publicId: lead.publicId, dealValue: null })}><Trash2 /> Entfernen</Button> : null}<Button className="flux-button" disabled={save.isPending || parsed === null || !value.trim()} onClick={() => save.mutate({ publicId: lead.publicId, dealValue: parsed ?? 0 })}><Euro /> Speichern</Button></div></div>
  </div>;
}

function MessageForm({ lead, initialChannel, onDone }: { lead: ActionLead; initialChannel?: MessageChannel; onDone: () => void }) {
  const phone = normalizePhone(lead.phone);
  const [channel, setChannel] = useState<MessageChannel>(initialChannel ?? (phone ? "sms" : "email")); const [templateKey, setTemplateKey] = useState("rueckruf"); const [text, setText] = useState(MESSAGE_TEMPLATES[0].text); const [subject, setSubject] = useState(""); const [nodeChoice, setNodeChoice] = useState(""); const [result, setResult] = useState<{ status: string; link: string | null } | null>(null);
  const nodes = trpc.leadops.emailSendNodes.useQuery(undefined, { enabled: channel === "email", retry: false });
  const owners = trpc.leadops.pipelineOwners.useQuery(undefined, { retry: false });
  const me = owners.data?.find((item) => item.userId === lead.ownerUserId)?.name ?? null;
  const values = useMemo(() => messageValues({ firstName: lead.firstName, lastName: lead.lastName, company: lead.company, categoryName: lead.categoryName, appointmentAt: lead.appointmentAt, metadata: lead.metadata }, me), [lead, me]);
  const preview = fillMessage(text, values);
  const templates = MESSAGE_TEMPLATES.filter((item) => item.channels.includes(channel));
  const pickTemplate = (key: string) => { setTemplateKey(key); const template = MESSAGE_TEMPLATES.find((item) => item.key === key); if (template) { setText(template.text); setSubject(template.subject ?? ""); } setNodeChoice(""); };
  const send = trpc.leadops.sendLeadMessage.useMutation({ onSuccess: (response) => { setResult({ status: response.status, link: response.link }); if (response.link) { window.open(response.link, "_blank", "noopener"); toast.success("WhatsApp geöffnet – Nachricht ist vorausgefüllt."); } else toast.success(response.status === "gesendet" ? `${CHANNEL_LABELS[channel]} gesendet.` : `${CHANNEL_LABELS[channel]} simuliert – kein Versand eingerichtet.`); if (!response.link) onDone(); }, onError: (error) => toast.error(error.message) });
  const [campaignId, nodeId] = nodeChoice.split("/");
  const [aiBrief, setAiBrief] = useState(""); const [aiOpen, setAiOpen] = useState(false);
  const aiDraft = trpc.leadops.draftMessageWithAi.useMutation({ onSuccess: (generated) => { setText(generated.text); if (generated.subject) setSubject(generated.subject); setTemplateKey("frei"); setNodeChoice(""); toast.success(generated.source === "ki" ? "Text von der KI geschrieben – bitte kurz prüfen." : "Regelbasierter Textvorschlag (ohne KI-Schlüssel) – bitte anpassen."); }, onError: (error) => toast.error(error.message) });
  return <div className="lead-action-body">
    <div className="dashboard-segments">{(["sms", "whatsapp", "email"] as MessageChannel[]).map((item) => <button key={item} type="button" className={channel === item ? "active" : ""} disabled={item === "email" ? !lead.email : !phone} title={item === "email" ? (lead.email ?? "keine E-Mail-Adresse") : (phone ?? "keine Telefonnummer")} onClick={() => { setChannel(item); setResult(null); if (item !== "email" && templateKey === "frei" && !text) pickTemplate("rueckruf"); }}>{CHANNEL_LABELS[item]}</button>)}</div>
    <label className="lead-action-field">Vorlage<select className="lead-action-select" value={nodeChoice ? `vorlage:${nodeChoice}` : templateKey} onChange={(event) => { const value = event.target.value; if (value.startsWith("vorlage:")) { setNodeChoice(value.slice(8)); setTemplateKey("frei"); } else pickTemplate(value); }}>{templates.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}{channel === "email" && (nodes.data ?? []).length > 0 && <optgroup label="E-Mail-Vorlagen aus Kampagnen">{(nodes.data ?? []).map((node) => <option key={`${node.campaignId}/${node.nodeId}`} value={`vorlage:${node.campaignId}/${node.nodeId}`}>{node.isTemplate ? "Vorlage" : "Kampagne"} „{node.campaignName}“ → {node.label}</option>)}</optgroup>}</select></label>
    <div className="ai-inline"><button type="button" className={`segment-tab ${aiOpen ? "active" : ""}`} onClick={() => setAiOpen((value) => !value)}><Sparkles className="inline h-3.5 w-3.5" /> KI-Text</button>{aiOpen && <><Input placeholder="Worum geht es? z. B. „Rückruf wegen Angebot, freundlich, Termin anbieten“" value={aiBrief} onChange={(event) => setAiBrief(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && aiBrief.trim().length >= 3) aiDraft.mutate({ brief: aiBrief, channel, category: lead.categoryName ?? null, sender: me }); }} /><Button size="sm" variant="outline" disabled={aiDraft.isPending || aiBrief.trim().length < 3} onClick={() => aiDraft.mutate({ brief: aiBrief, channel, category: lead.categoryName ?? null, sender: me })}>{aiDraft.isPending ? "Schreibt …" : "Text erzeugen"}</Button></>}</div>
    {nodeChoice ? <p className="lead-action-hint">Die E-Mail wird im Design der Kampagne gerendert (Platzhalter wie {"{{vorname}}"} werden gefüllt) und sofort an {lead.email} geschickt.</p> : <>
      {channel === "email" && <Input value={subject} maxLength={320} placeholder="Betreff" onChange={(event) => setSubject(event.target.value)} />}
      <textarea className="lead-action-textarea" rows={5} maxLength={channel === "email" ? 20000 : SMS_LIMIT} value={text} onChange={(event) => { setText(event.target.value); setTemplateKey("frei"); }} />
      <div className="lead-action-preview"><span className="eyebrow">VORSCHAU</span><p>{preview || "–"}</p><small>{channel === "email" ? `Betreff: ${fillMessage(subject, values) || "–"}` : `${preview.length} / ${SMS_LIMIT} Zeichen${preview.length > 160 ? ` · ${Math.ceil(preview.length / 153)} SMS-Teile` : ""}`} · Platzhalter: {"{{anrede}} {{nachname}} {{vorname}} {{firma}} {{termin}} {{absender}}"}</small></div>
    </>}
    {result?.link && <p className="lead-action-hint">WhatsApp ohne Business-Anbindung: Die Nachricht wurde als Link vorbereitet. <a href={result.link} target="_blank" rel="noreferrer">Erneut öffnen</a></p>}
    <div className="lead-action-actions"><small>{channel === "whatsapp" ? "Mit WhatsApp-Business-Absender (Twilio) geht die Nachricht direkt raus, sonst öffnet sich WhatsApp mit vorausgefülltem Text." : channel === "sms" ? "Versand über die eigene Rufnummer (Telefonie). Jede Nachricht landet im Verlauf der Karte." : "Versand über die E-Mail-Einstellungen; Sperrliste wird beachtet."}</small><Button className="flux-button" disabled={send.isPending || (channel !== "email" && !phone) || (channel === "email" && !lead.email) || (!nodeChoice && !preview)} onClick={() => send.mutate({ publicId: lead.publicId, channel, text, subject: subject || null, templateKey: nodeChoice ? null : templateKey, campaignId: nodeChoice ? Number(campaignId) : null, nodeId: nodeChoice ? nodeId : null })}><Send /> {channel === "whatsapp" ? "WhatsApp öffnen / senden" : "Senden"}</Button></div>
  </div>;
}
