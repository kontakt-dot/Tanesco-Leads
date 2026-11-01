import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { Save } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { consentScript, DEFAULT_CONSENT_TEMPLATE, DEFAULT_SMS_TEMPLATE, OPT_IN_PLACEHOLDERS, type OptInSettings } from "../../../shared/opt-in";

/** Einstellungen → Opt-in: Firma, Widerruf-Adresse, Datenschutz-Link, Einwilligungstext (Schritt 2), SMS-Text, automatische SMS nach Zuteilung. Mit Vorschau. */
export default function OptInSettingsPanel() {
  const settings = trpc.leadops.optInSettings.useQuery(undefined, { retry: false });
  const [form, setForm] = useState<OptInSettings | null>(null);
  useEffect(() => { if (settings.data && !form) setForm(settings.data); }, [settings.data, form]);
  const utils = trpc.useUtils();
  const save = trpc.leadops.saveOptInSettings.useMutation({ onSuccess: (saved) => { setForm(saved); utils.leadops.optInSettings.invalidate(); toast.success("Opt-in-Einstellungen gespeichert."); }, onError: (error) => toast.error(error.message) });
  if (!form) return <p className="mt-6 text-sm text-slate-400">Wird geladen …</p>;
  const preview = consentScript(form, { now: new Date(), name: "Max Mustermann", firstName: "Max", phone: "0171 2345678", city: "Frankfurt", category: "Photovoltaik", buyerName: "Müller Solartechnik, Frankfurt" });
  const set = (patch: Partial<OptInSettings>) => setForm({ ...form, ...patch });
  return <div className="mt-6 space-y-4 opt-in-settings">
    <div className="rounded-xl border border-white/10 bg-white/[.018] p-4">
      <span className="eyebrow">OPT-IN · EINWILLIGUNGSNACHWEIS</span>
      <p className="mt-1 text-sm text-slate-400">Diese Angaben stehen im Text, den der Agent beim „Opt-in aufnehmen“ vorliest, in der SMS-Bestätigung und auf dem Nachweis (PDF). Werbeanrufe bei Verbrauchern brauchen eine vorherige ausdrückliche Einwilligung (§ 7 UWG); sie muss dokumentiert und 5 Jahre aufbewahrt werden (§ 7a UWG).</p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="text-xs text-slate-400">Unsere Firma (wird vorgelesen)<Input className="mt-1" placeholder="Tanesco Digital GbR" value={form.companyName} onChange={(event) => set({ companyName: event.target.value })} /></label>
        <label className="text-xs text-slate-400">Anschrift (für den Nachweis)<Input className="mt-1" placeholder="Straße, PLZ Ort" value={form.companyAddress} onChange={(event) => set({ companyAddress: event.target.value })} /></label>
        <label className="text-xs text-slate-400">E-Mail für den Widerruf<Input className="mt-1" placeholder="kontakt@…" value={form.revokeEmail} onChange={(event) => set({ revokeEmail: event.target.value })} /></label>
        <label className="text-xs text-slate-400">Link zur Datenschutzerklärung<Input className="mt-1" placeholder="https://…/datenschutz" value={form.privacyUrl} onChange={(event) => set({ privacyUrl: event.target.value })} /></label>
        <label className="text-xs text-slate-400 md:col-span-2">Kanäle, für die eingewilligt wird<Input className="mt-1" value={form.channels} onChange={(event) => set({ channels: event.target.value })} /></label>
        <label className="text-xs text-slate-400 md:col-span-2">Einwilligungstext (Schritt 2 – wird auf der Aufnahme vorgelesen)<textarea className="opt-in-textarea mt-1" rows={5} value={form.consentTemplate} onChange={(event) => set({ consentTemplate: event.target.value })} /><span className="opt-in-placeholders">Platzhalter: {OPT_IN_PLACEHOLDERS.filter(([key]) => key !== "{{link}}").map(([key, label]) => <code key={key} title={label}>{key}</code>)} · <button type="button" className="opt-in-link" onClick={() => set({ consentTemplate: DEFAULT_CONSENT_TEMPLATE })}>Standardtext</button></span></label>
        <label className="text-xs text-slate-400 md:col-span-2">SMS-Bestätigung (mit Link)<textarea className="opt-in-textarea mt-1" rows={3} value={form.smsTemplate} onChange={(event) => set({ smsTemplate: event.target.value })} /><span className="opt-in-placeholders">Platzhalter: {OPT_IN_PLACEHOLDERS.map(([key, label]) => <code key={key} title={label}>{key}</code>)} · <button type="button" className="opt-in-link" onClick={() => set({ smsTemplate: DEFAULT_SMS_TEMPLATE })}>Standardtext</button> · {form.smsTemplate.length} Zeichen (SMS-Länge zählt nach dem Einsetzen)</span></label>
        <label className="mh-toggle md:col-span-2"><input type="checkbox" checked={form.autoSms} onChange={(event) => set({ autoSms: event.target.checked })} /><span><strong>SMS-Bestätigung automatisch nach der Zuteilung</strong><small>Wenn ein Lead an einen Fachbetrieb geht, für den noch keine gültige Einwilligung mit Firmennamen vorliegt, geht die SMS mit dem Namen des Betriebs von selbst raus.</small></span></label>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2"><Button className="flux-button" disabled={save.isPending} onClick={() => save.mutate(form)}><Save /> {save.isPending ? "Speichert …" : "Speichern"}</Button>{!form.companyName && <small className="opt-in-hint is-warn">Ohne Firmennamen lässt sich kein Opt-in aufnehmen.</small>}</div>
    </div>
    <div className="rounded-xl border border-white/10 bg-white/[.018] p-4">
      <span className="eyebrow">SO KLINGT ES IM GESPRÄCH (BEISPIEL)</span>
      {preview.steps.map((step) => <section key={step.key} className="opt-in-step"><h4>{step.title}</h4><p className="opt-in-read">{step.text}</p><small>{step.hint}</small></section>)}
    </div>
  </div>;
}
