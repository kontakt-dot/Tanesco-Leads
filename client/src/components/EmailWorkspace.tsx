import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { confirmAction } from "@/lib/confirm";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { Clock3, Eye, Mail, MailCheck, MailWarning, Play, RotateCcw, Send, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type Overview = inferRouterOutputs<AppRouter>["leadops"]["emailOverview"];
type Template = Overview["templates"][number];
type EmailEvent = Overview["events"][number];
type Tab = "versand" | "vorlagen" | "ablauf";

const KIND_LABEL: Record<string, string> = { willkommen: "Willkommensmail", erinnerung_1: "1. Erinnerung", erinnerung_2: "2. Erinnerung", erinnerung_3: "3. Erinnerung", frei: "Freie Vorlage", test: "Testmail" };
const STATUS: Record<string, { label: string; cls: string }> = { geplant: { label: "Geplant", cls: "border-sky-400/25 bg-sky-500/10 text-sky-200" }, gesendet: { label: "Gesendet", cls: "border-emerald-400/25 bg-emerald-500/10 text-emerald-200" }, simuliert: { label: "Simuliert (kein SMTP)", cls: "border-amber-400/25 bg-amber-500/10 text-amber-200" }, zugestellt: { label: "Zugestellt", cls: "border-emerald-400/25 bg-emerald-500/10 text-emerald-200" }, geöffnet: { label: "Geöffnet", cls: "border-emerald-400/25 bg-emerald-500/10 text-emerald-200" }, fehlgeschlagen: { label: "Fehlgeschlagen", cls: "border-red-400/25 bg-red-500/10 text-red-200" }, übersprungen: { label: "Übersprungen (angemeldet)", cls: "border-white/15 text-slate-300" }, abgebrochen: { label: "Abgebrochen", cls: "border-white/15 text-slate-400" }, entwurf: { label: "Entwurf", cls: "border-white/15 text-slate-400" } };
const PLACEHOLDERS = ["{{vorname}}", "{{nachname}}", "{{name}}", "{{firma}}", "{{email}}", "{{login_url}}", "{{passwort}}", "{{firma_plattform}}"];
const SAMPLE = { vorname: "Sabine", nachname: "Krüger", name: "Sabine Krüger", firma: "Nordlicht Energie", email: "s.krueger@nordlicht-energie.de", login_url: "https://leads.tanesco.digital", passwort: "Beispiel-Passwort", firma_plattform: "Tanesco Leads" } as Record<string, string>;
const render = (text: string) => text.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (_, key: string) => SAMPLE[key] ?? "");
const stamp = (value: Date | string | null | undefined) => value ? new Date(value).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "–";

export default function EmailWorkspace() {
  const [tab, setTab] = useState<Tab>("versand"); const [status, setStatus] = useState(""); const [preview, setPreview] = useState<EmailEvent | null>(null);
  const utils = trpc.useUtils();
  const overview = trpc.leadops.emailOverview.useQuery({ status: status || undefined }, { retry: false });
  const refresh = () => utils.leadops.emailOverview.invalidate();
  const onError = (error: { message: string }) => toast.error(error.message);
  const sendNow = trpc.leadops.sendEmailNow.useMutation({ onSuccess: (result) => { refresh(); toast[result.ok ? "success" : "error"](result.ok ? (result.status === "simuliert" ? "Versand simuliert (kein SMTP hinterlegt)." : "E-Mail gesendet.") : `Versand fehlgeschlagen: ${result.note ?? ""}`); }, onError });
  const cancel = trpc.leadops.cancelEmail.useMutation({ onSuccess: () => { refresh(); toast.success("E-Mail abgebrochen."); }, onError });
  const runQueue = trpc.leadops.runEmailQueue.useMutation({ onSuccess: (result) => { refresh(); toast.success(`Warteschlange geprüft: ${result.sent} gesendet, ${result.skipped} übersprungen, ${result.failed} fehlgeschlagen.`); }, onError });
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setPreview(null); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, []);
  const counts = overview.data?.counts ?? {};
  const smtp = overview.data?.smtp;
  return <>
    <header className="page-intro compact"><div><span className="eyebrow">KOMMUNIKATION</span><h1>E-Mails</h1><p>Was die Plattform automatisch verschickt: Willkommensmail beim Anlegen eines Benutzers und Erinnerungen, solange er sich noch nicht angemeldet hat. Hier siehst du jeden Versand und bearbeitest die Vorlagen.</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={runQueue.isPending} onClick={() => runQueue.mutate()}><Play /> Fällige jetzt senden</Button></div></header>
    <div className="grid gap-3 md:grid-cols-4">
      <div className="metric-card"><span>Geplant</span><strong>{counts.geplant ?? 0}</strong><small>warten auf ihren Termin</small></div>
      <div className="metric-card"><span>Gesendet</span><strong>{(counts.gesendet ?? 0) + (counts.zugestellt ?? 0) + (counts.geöffnet ?? 0)}</strong><small>{counts.simuliert ? `+ ${counts.simuliert} simuliert` : "über SMTP"}</small></div>
      <div className="metric-card"><span>Übersprungen</span><strong>{counts.übersprungen ?? 0}</strong><small>Benutzer hatte sich angemeldet</small></div>
      <div className="metric-card"><span>Fehlgeschlagen</span><strong>{counts.fehlgeschlagen ?? 0}</strong><small>bitte prüfen</small></div>
    </div>
    <div className="mt-4 flex flex-wrap gap-2">{([["versand", "Versand"], ["vorlagen", "Vorlagen"], ["ablauf", "Ablauf & SMTP"]] as Array<[Tab, string]>).map(([key, label]) => <button key={key} type="button" className={`segment-tab ${tab === key ? "active" : ""}`} onClick={() => setTab(key)}>{label}</button>)}</div>

    {tab === "versand" && <section className="surface-panel lead-panel mt-4 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"><span className="eyebrow">VERSANDPROTOKOLL</span><select className="filter-select h-8" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Status filtern"><option value="">Alle Status</option>{Object.entries(STATUS).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></div>
      {overview.isLoading ? <p className="p-5 text-sm text-slate-400">Wird geladen …</p> : overview.error ? <p className="p-5 text-sm text-red-200">{overview.error.message}</p> : !overview.data?.events.length ? <p className="p-5 text-sm text-slate-400">Noch keine E-Mails. Sobald du einen Benutzer anlegst, erscheinen hier Willkommensmail und Erinnerungen.</p> :
        <div className="overflow-x-auto"><table className="flux-table"><thead><tr><th>Empfänger</th><th>Betreff</th><th>Art</th><th>Status</th><th>Termin / gesendet</th><th>Aktionen</th></tr></thead><tbody>{overview.data.events.map((event) => { const state = STATUS[event.deliveryStatus] ?? { label: event.deliveryStatus, cls: "border-white/15 text-slate-300" }; return <tr key={event.id}><td><span className="block text-sm font-medium text-slate-100">{event.recipientName ?? event.recipientEmail}</span>{(event.recipientName || event.recipientCompany) && <span className="text-xs text-slate-500">{event.recipientCompany ? `${event.recipientCompany} · ` : ""}{event.recipientName ? event.recipientEmail : ""}</span>}</td><td className="max-w-[320px]"><span className="block truncate" title={event.subject}>{event.subject}</span></td><td><Badge variant="outline" className="border-white/15 text-slate-300">{KIND_LABEL[event.kind ?? "frei"] ?? event.kind}</Badge></td><td><Badge variant="outline" className={state.cls}>{state.label}</Badge>{event.note && <span className="mt-1 block max-w-[220px] truncate text-[11px] text-slate-500" title={event.note}>{event.note}</span>}</td><td className="whitespace-nowrap text-xs text-slate-400">{event.sentAt ? stamp(event.sentAt) : event.scheduledFor ? `geplant ${stamp(event.scheduledFor)}` : stamp(event.createdAt)}</td><td><div className="flex gap-1 whitespace-nowrap"><Button size="sm" variant="ghost" title="Vorschau" aria-label="Vorschau" onClick={() => setPreview(event)}><Eye className="h-4 w-4" /></Button>{(event.deliveryStatus === "geplant" || event.deliveryStatus === "fehlgeschlagen") && <Button size="sm" variant="outline" disabled={sendNow.isPending} onClick={() => sendNow.mutate({ eventId: event.id })}><Send className="h-3.5 w-3.5" /> Jetzt senden</Button>}{(event.deliveryStatus === "gesendet" || event.deliveryStatus === "simuliert") && <Button size="sm" variant="outline" disabled={sendNow.isPending} onClick={() => sendNow.mutate({ eventId: event.id })}><RotateCcw className="h-3.5 w-3.5" /> Erneut</Button>}{event.deliveryStatus === "geplant" && <Button size="sm" variant="ghost" aria-label="Abbrechen" title="Abbrechen" onClick={async () => { if (await confirmAction("Geplante E-Mail wirklich abbrechen?")) cancel.mutate({ eventId: event.id }); }}><X className="h-4 w-4" /></Button>}</div></td></tr>; })}</tbody></table></div>}
    </section>}

    {tab === "vorlagen" && <div className="mt-4 grid gap-4">{(overview.data?.templates ?? []).filter((template) => ["willkommen", "erinnerung_1", "erinnerung_2", "erinnerung_3"].includes(String(template.kind))).map((template) => <TemplateCard key={template.id} template={template} onSaved={refresh} />)}{overview.data && !overview.data.templates.length && <p className="text-sm text-slate-400">Vorlagen werden angelegt …</p>}</div>}

    {tab === "ablauf" && <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <section className="surface-panel p-5"><span className="eyebrow">SO LÄUFT ES</span><ol className="mt-3 space-y-3 text-sm text-slate-300">
        <li className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-violet-500/15 text-xs font-bold text-violet-100">1</span><span><strong className="text-slate-100">Benutzer anlegen</strong> (Benutzer → Neuer Benutzer). Die Willkommensmail geht sofort an die eingetragene E-Mail-Adresse – mit Anmeldeadresse, Benutzername und dem vergebenen Passwort.</span></li>
        <li className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-violet-500/15 text-xs font-bold text-violet-100">2</span><span><strong className="text-slate-100">Erinnerungen</strong> werden zum Anlegen gleich mitgeplant (Standard: nach 3 und 7 Tagen). Der Zeitplaner prüft alle 15 Minuten, was fällig ist.</span></li>
        <li className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-violet-500/15 text-xs font-bold text-violet-100">3</span><span><strong className="text-slate-100">Meldet sich der Benutzer an</strong>, werden offene Erinnerungen automatisch übersprungen – niemand bekommt eine unnötige Mail.</span></li>
        <li className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-violet-500/15 text-xs font-bold text-violet-100">4</span><span><strong className="text-slate-100">Alles nachvollziehbar</strong> im Versandprotokoll: geplant, gesendet, übersprungen, fehlgeschlagen – jede Mail lässt sich ansehen, sofort senden oder abbrechen.</span></li></ol></section>
      <section className="surface-panel p-5"><span className="eyebrow">SMTP-VERSAND</span>
        <div className="mt-3 flex items-center gap-3">{smtp?.configured ? <MailCheck className="h-8 w-8 text-emerald-300" /> : <MailWarning className="h-8 w-8 text-amber-300" />}<div><strong className="block text-sm text-slate-100">{smtp?.configured ? "SMTP ist eingerichtet" : "Noch kein SMTP hinterlegt"}</strong><span className="text-xs text-slate-400">{smtp?.configured ? `Absender: ${smtp.from ?? "Standard"}` : "Mails werden protokolliert, aber nur simuliert."}</span></div></div>
        <p className="mt-4 text-sm text-slate-300">Für den echten Versand trägst du beim Hosting (Railway → Variables) zwei Werte ein:</p>
        <dl className="mt-2 space-y-2 text-sm"><div><dt className="font-mono text-xs text-violet-200">SMTP_URL</dt><dd className="text-slate-400">z. B. <code className="text-xs">smtps://benutzer:passwort@smtp.deinanbieter.de:465</code> (Zugang von deinem Mail-Anbieter, z. B. IONOS, Strato, Google Workspace, Brevo)</dd></div><div><dt className="font-mono text-xs text-violet-200">SMTP_FROM</dt><dd className="text-slate-400">z. B. <code className="text-xs">Tanesco Leads &lt;service@tanesco.digital&gt;</code></dd></div><div><dt className="font-mono text-xs text-violet-200">APP_URL</dt><dd className="text-slate-400">wird als Anmeldeadresse in die Mails eingesetzt{smtp?.appUrl ? ` (aktuell ${smtp.appUrl})` : ""}</dd></div></dl>
        <p className="mt-4 text-xs text-slate-500">Nach dem Eintragen die Software einmal neu starten. Ob es klappt, zeigt „Testmail an mich“ bei den Vorlagen.</p></section>
    </div>}

    {preview && <div className="side-drawer-backdrop" onClick={() => setPreview(null)} role="presentation"><aside className="side-drawer" role="dialog" aria-label="E-Mail-Vorschau" onClick={(event) => event.stopPropagation()}><header className="side-drawer-head"><div><span className="eyebrow">E-MAIL-VORSCHAU</span><h2 className="mt-1 text-base font-semibold text-slate-100">{preview.subject}</h2><p className="text-xs text-slate-500">an {preview.recipientEmail} · {KIND_LABEL[preview.kind ?? "frei"] ?? preview.kind} · {STATUS[preview.deliveryStatus]?.label ?? preview.deliveryStatus}</p></div><Button size="icon" variant="ghost" aria-label="Vorschau schließen" onClick={() => setPreview(null)}><X className="h-4 w-4" /></Button></header><div className="side-drawer-body"><div className="email-preview" dangerouslySetInnerHTML={{ __html: preview.bodyPreview ?? "<p>(kein Inhalt gespeichert)</p>" }} /></div></aside></div>}
  </>;
}

function TemplateCard({ template, onSaved }: { template: Template; onSaved: () => void }) {
  const [form, setForm] = useState({ subject: template.subject, bodyHtml: template.bodyHtml, delayDays: String(template.delayDays), active: template.status === "aktiv" });
  useEffect(() => { setForm({ subject: template.subject, bodyHtml: template.bodyHtml, delayDays: String(template.delayDays), active: template.status === "aktiv" }); }, [template.id, template.subject, template.bodyHtml, template.delayDays, template.status]);
  const onError = (error: { message: string }) => toast.error(error.message);
  const update = trpc.leadops.updateEmailTemplate.useMutation({ onSuccess: () => { onSaved(); toast.success("Vorlage gespeichert."); }, onError });
  const reset = trpc.leadops.resetEmailTemplate.useMutation({ onSuccess: () => { onSaved(); toast.success("Standardtext wiederhergestellt."); }, onError });
  const test = trpc.leadops.sendTestEmail.useMutation({ onSuccess: (result) => { onSaved(); toast[result.ok ? "success" : "error"](result.ok ? (result.status === "simuliert" ? "Testmail protokolliert – ohne SMTP nur simuliert." : "Testmail an dich gesendet.") : `Testmail fehlgeschlagen: ${result.note ?? ""}`); }, onError });
  const dirty = form.subject !== template.subject || form.bodyHtml !== template.bodyHtml || Number(form.delayDays) !== template.delayDays || form.active !== (template.status === "aktiv");
  const isWelcome = template.kind === "willkommen";
  return <section className="surface-panel p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-500/15 text-violet-100">{isWelcome ? <Mail className="h-5 w-5" /> : <Clock3 className="h-5 w-5" />}</span><div><span className="eyebrow">{(KIND_LABEL[String(template.kind)] ?? String(template.kind ?? "")).toUpperCase()}</span><h2 className="text-base font-semibold text-slate-100">{template.name}</h2><p className="text-xs text-slate-500">{isWelcome ? "Geht sofort raus, wenn ein Benutzer angelegt wird." : "Geht nur raus, wenn sich der Benutzer bis dahin noch nicht angemeldet hat."}</p></div></div>
      <label className="flex items-center gap-2 text-xs text-slate-400"><Switch checked={form.active} onCheckedChange={(checked) => setForm({ ...form, active: checked })} aria-label="Vorlage aktiv" />{form.active ? "Aktiv" : "Aus"}</label></div>
    <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="grid gap-3">
        {!isWelcome && <label className="grid gap-1 text-xs text-slate-400">Senden nach (Tagen seit Anlegen)<Input type="number" min={1} max={365} className="w-32" value={form.delayDays} onChange={(event) => setForm({ ...form, delayDays: event.target.value })} /></label>}
        <label className="grid gap-1 text-xs text-slate-400">Betreff<Input value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} /></label>
        <label className="grid gap-1 text-xs text-slate-400">Text (einfaches HTML erlaubt)<textarea className="min-h-[220px] w-full rounded-md border border-white/10 bg-slate-900 p-3 font-mono text-xs leading-5 text-slate-100" value={form.bodyHtml} onChange={(event) => setForm({ ...form, bodyHtml: event.target.value })} /></label>
        <div className="flex flex-wrap items-center gap-1.5"><span className="text-[11px] text-slate-500">Platzhalter:</span>{PLACEHOLDERS.map((item) => <button key={item} type="button" className="rounded-full border border-white/10 px-2 py-0.5 font-mono text-[11px] text-slate-300 hover:border-violet-400/40 hover:text-white" onClick={() => setForm({ ...form, bodyHtml: `${form.bodyHtml} ${item}` })}>{item}</button>)}</div>
        <div className="flex flex-wrap gap-2"><Button className="flux-button" disabled={!dirty || update.isPending} onClick={() => update.mutate({ id: template.id, subject: form.subject.trim(), bodyHtml: form.bodyHtml, delayDays: isWelcome ? 0 : Math.max(1, Number(form.delayDays) || 1), status: form.active ? "aktiv" : "entwurf" })}>Speichern</Button><Button variant="outline" disabled={test.isPending} onClick={() => test.mutate({ templateId: template.id })}><Send /> Testmail an mich</Button><Button variant="ghost" disabled={reset.isPending} onClick={async () => { if (await confirmAction("Standardtext wiederherstellen? Deine Änderungen an dieser Vorlage gehen verloren.")) reset.mutate({ id: template.id }); }}><RotateCcw /> Standard</Button></div>
      </div>
      <div className="rounded-xl border border-white/10 bg-slate-950/30 p-4"><span className="eyebrow">VORSCHAU MIT BEISPIELDATEN</span><p className="mt-2 text-sm font-semibold text-slate-100">{render(form.subject)}</p><div className="email-preview mt-3" dangerouslySetInnerHTML={{ __html: render(form.bodyHtml) }} /></div>
    </div>
  </section>;
}
