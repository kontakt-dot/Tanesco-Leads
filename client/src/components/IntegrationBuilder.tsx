import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { CheckCircle2, CircleAlert, FileText, ListChecks, Sparkles, Wand2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export type IntegrationBuilderDraft = {
  integrationName: string;
  provider: "custom_api" | "webhook";
  endpoint: string;
  endpointKnown: boolean;
  direction: "eingehend" | "ausgehend" | "beidseitig";
  authMethod: "api_key" | "bearer" | "basic" | "ohne";
  processes: Array<"lead_import" | "lead_export" | "status_callback" | "reklamation" | "bestellstatus">;
  requiredInputs: string[];
  payloadFields: Array<{ sourceField: string; targetField: string; required: boolean; description: string }>;
  testPlan: string[];
  missingInformation: string[];
  assumptions: string[];
  riskNotes: string[];
};

const processLabels: Record<IntegrationBuilderDraft["processes"][number], string> = {
  lead_import: "Leads empfangen", lead_export: "Leads übergeben", status_callback: "Rückmeldungen erhalten", reklamation: "Reklamationen austauschen", bestellstatus: "Bestellstatus austauschen",
};

export default function IntegrationBuilder({ onCreated }: { onCreated: (integrationId: number | null) => void }) {
  const [documentation, setDocumentation] = useState("");
  const [integrationNameHint, setIntegrationNameHint] = useState("");
  const [endpointHint, setEndpointHint] = useState("");
  const [processGoal, setProcessGoal] = useState("Ich möchte Leads aus Tanesco Leads an meinen Partner übergeben.");
  const [draft, setDraft] = useState<IntegrationBuilderDraft | null>(null);
  const [createdIntegrationId, setCreatedIntegrationId] = useState<number | null>(null);
  const build = trpc.leadops.buildIntegrationDraft.useMutation({ onSuccess: (result) => { setDraft(result); toast.success("Dein Einrichtungsplan ist fertig. Prüfe die gelben Hinweise."); }, onError: (error) => toast.error(error.message) });
  const createIntegration = trpc.leadops.createPartnerIntegration.useMutation({ onSuccess: (result) => { setCreatedIntegrationId(result.integrationId); onCreated(result.integrationId); toast.success("Die Schnittstelle wurde als sicherer Entwurf angelegt. Hinterlege jetzt den Zugangsschlüssel und teste die Verbindung."); }, onError: (error) => toast.error(error.message) });

  const importTextFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 200_000) return toast.error("Bitte verwenden Sie eine Datei mit maximal 200 KB.");
    try { setDocumentation((await file.text()).slice(0, 60_000)); toast.success(`${file.name} wurde übernommen.`); }
    catch { toast.error("Diese Datei konnte nicht gelesen werden. Kopieren Sie den Text bitte direkt in das Feld."); }
  };
  const startBuild = () => {
    if (documentation.trim().length < 30) return toast.error("Fügen Sie bitte die Informationen Ihres Partners ein. Schon ein Link, ein Beispiel oder eine Feldliste reicht als Start.");
    build.mutate({ documentation: documentation.trim(), integrationNameHint: integrationNameHint.trim() || undefined, endpointHint: endpointHint.trim() || undefined, processGoal: processGoal.trim() || undefined });
  };
  const canApply = Boolean(draft?.endpointKnown && draft.endpoint.startsWith("https://"));
  const createFromDraft = () => {
    if (!draft || !canApply) return;
    createIntegration.mutate({ provider: draft.provider, name: draft.integrationName, callbackUrl: draft.endpoint, status: "inaktiv", config: { direction: draft.direction, authMethod: draft.authMethod, processes: draft.processes, fieldMapping: draft.payloadFields, builderCreated: true } });
  };

  return <section className="surface-panel operations-panel mt-4 overflow-hidden">
    <div className="border-b border-violet-400/15 bg-violet-500/[.045] px-5 py-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex gap-3"><div className="grid h-11 w-11 place-items-center rounded-xl border border-violet-400/25 bg-violet-500/10"><Wand2 className="h-5 w-5 text-violet-200" /></div><div><span className="eyebrow">SCHRITT-FÜR-SCHRITT</span><h2 className="mt-1 text-lg text-slate-100">Integration einfach einrichten</h2><p className="mt-1 max-w-3xl text-sm text-slate-400">Du musst keine API verstehen. Gib nur weiter, was du von deinem Partner bekommen hast. Die KI macht daraus einen verständlichen Einrichtungsplan.</p></div></div>
        <Badge variant="outline" className="border-violet-400/25 bg-violet-500/10 text-violet-100"><Sparkles className="mr-1 h-3.5 w-3.5" /> Für Einsteiger</Badge>
      </div>
    </div>
    <div className="grid gap-3 border-b border-white/7 bg-slate-950/15 p-5 md:grid-cols-3">
      <Step number="1" title="Unterlagen besorgen" text="Bitte deinen Partner um eine API-Dokumentation, einen Beispiel-Link oder eine Liste der Datenfelder." />
      <Step number="2" title="Hier einfügen" text="Kopiere den Text hinein oder lies eine Textdatei ein. Geheime Schlüssel bitte niemals einfügen." />
      <Step number="3" title="Schnittstelle erstellen" text="Die KI erstellt die Verbindung als sicheren Entwurf. Danach hinterlegst du den Schlüssel und testest erst dann." />
    </div>
    <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,.8fr)]">
      <div>
        <div className="flex items-center justify-between gap-3"><label className="text-xs font-medium uppercase tracking-wide text-slate-400">Was hat dein Partner dir geschickt?</label><label className="cursor-pointer text-xs text-violet-200 hover:text-violet-100"><input className="sr-only" type="file" accept=".json,.yaml,.yml,.txt,.md,.csv" onChange={(event) => importTextFile(event.target.files?.[0])} /><FileText className="mr-1 inline h-3.5 w-3.5" /> Datei auswählen</label></div>
        <Textarea value={documentation} onChange={(event) => setDocumentation(event.target.value)} className="mt-2 min-h-52 bg-slate-950/35 text-sm leading-6" placeholder={'Kopiere alles hinein, was du hast. Zum Beispiel:\n\n• einen Link zur API-Dokumentation\n• eine E-Mail des Partners mit technischen Informationen\n• ein Beispiel für Daten, die gesendet werden sollen\n• eine Liste mit Feldern wie Name, Telefon oder Postleitzahl'} />
        <p className="mt-2 text-xs text-slate-500">Akzeptiert werden eingefügter Text oder Textdateien wie JSON, YAML, Markdown und CSV. Passwörter, API-Keys und Tokens gehören nicht in dieses Feld.</p>
      </div>
      <div className="space-y-3">
        <label className="grid gap-2 text-xs text-slate-400">Wie heißt der Partner? <Input value={integrationNameHint} onChange={(event) => setIntegrationNameHint(event.target.value)} placeholder="z. B. Musterfirma" /></label>
        <label className="grid gap-2 text-xs text-slate-400">Kennst du die Webadresse? <Input value={endpointHint} onChange={(event) => setEndpointHint(event.target.value)} placeholder="Optional · https://..." /></label>
        <label className="grid gap-2 text-xs text-slate-400">Was soll passieren? <Textarea value={processGoal} onChange={(event) => setProcessGoal(event.target.value)} className="min-h-24 bg-slate-950/35" /></label>
        <Button className="flux-button w-full" onClick={startBuild} disabled={build.isPending}><Sparkles /> {build.isPending ? "Ihr Plan wird erstellt …" : "Meinen Einrichtungsplan erstellen"}</Button>
        <div className="rounded-lg border border-white/7 bg-slate-950/25 p-3 text-xs text-slate-500"><strong className="block text-slate-300">Sie kennen nichts Technisches?</strong><p className="mt-1.5">Kein Problem. Fragen Sie Ihren Partner einfach nach: „Bitte senden Sie mir die Dokumentation und die Webadresse für die Datenübergabe an Tanesco Leads.“</p></div>
      </div>
    </div>
    {draft && <div className="border-t border-white/7 bg-slate-950/15 px-5 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><span className="eyebrow">IHR EINRICHTUNGSPLAN</span><h3 className="mt-1 text-base font-semibold text-slate-100">{draft.integrationName}</h3><p className="mt-1 text-sm text-slate-400">Die KI hat die Unterlagen geprüft und die nächsten Schritte vorbereitet.</p></div><div className={`rounded-lg border px-3 py-2 text-xs ${canApply ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200" : "border-amber-400/25 bg-amber-500/10 text-amber-200"}`}>{canApply ? <><CheckCircle2 className="mr-1 inline h-3.5 w-3.5" /> Bereit zur Übernahme</> : <><CircleAlert className="mr-1 inline h-3.5 w-3.5" /> Erst noch Angaben ergänzen</>}</div></div>
      <div className="mt-4 grid gap-4 xl:grid-cols-3"><BuilderList title="Das brauchen Sie noch" values={draft.requiredInputs} tone="violet" /><BuilderList title="Bitte beim Partner nachfragen" values={draft.missingInformation} tone="amber" /><BuilderList title="Wichtige Hinweise" values={[...draft.assumptions, ...draft.riskNotes]} tone="slate" /></div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(250px,.7fr)]"><div className="rounded-xl border border-white/7"><div className="flex items-center gap-2 border-b border-white/7 px-4 py-3"><ListChecks className="h-4 w-4 text-cyan-200" /><strong className="text-sm text-slate-100">Erkannte Daten</strong></div>{draft.payloadFields.length ? <div className="max-h-48 overflow-auto"><table><thead><tr><th>Tanesco Leads</th><th>Beim Partner</th><th>Erforderlich</th></tr></thead><tbody>{draft.payloadFields.map((field, index) => <tr key={`${field.sourceField}-${index}`}><td><code className="text-xs text-slate-200">{field.sourceField}</code><p className="mt-1 text-xs text-slate-500">{field.description}</p></td><td><code className="text-xs text-violet-200">{field.targetField}</code></td><td>{field.required ? "Ja" : "Nein"}</td></tr>)}</tbody></table></div> : <p className="p-4 text-xs text-slate-500">Die Unterlagen enthalten noch keine klare Liste der Daten. Fragen Sie beim Partner nach den benötigten Feldern.</p>}</div><div className="rounded-xl border border-white/7 p-4"><strong className="text-sm text-slate-100">So testen Sie die Verbindung</strong><ol className="mt-3 space-y-2 text-xs text-slate-400">{draft.testPlan.map((step, index) => <li key={step} className="flex gap-2"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-violet-400/25 text-[10px] text-violet-200">{index + 1}</span><span>{step}</span></li>)}</ol><div className="mt-4 flex flex-wrap gap-2">{draft.processes.map((process) => <Badge key={process} variant="outline" className="border-cyan-400/20 bg-cyan-500/10 text-cyan-100">{processLabels[process]}</Badge>)}</div></div></div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/7 pt-4"><p className="max-w-2xl text-xs text-slate-500">Die Erstellung schaltet nichts live. Tanesco Leads legt eine echte, inaktive Schnittstelle mit Endpunkt, Richtung, Prozessen und Feldzuordnung an. Zugangsschlüssel hinterlegen Sie danach getrennt und sicher.</p>{createdIntegrationId !== null ? <Badge className="border-emerald-400/25 bg-emerald-500/10 text-emerald-100"><CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Schnittstelle angelegt</Badge> : <Button className="flux-button" onClick={createFromDraft} disabled={!canApply || createIntegration.isPending}><CheckCircle2 /> {createIntegration.isPending ? "Schnittstelle wird angelegt …" : "Schnittstelle jetzt erstellen"}</Button>}</div>
    </div>}
  </section>;
}

function Step({ number, title, text }: { number: string; title: string; text: string }) { return <article className="flex gap-3 rounded-xl border border-white/7 bg-white/[.018] p-4"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-violet-400/30 bg-violet-500/10 text-xs font-bold text-violet-100">{number}</span><div><strong className="text-sm text-slate-100">{title}</strong><p className="mt-1 text-xs leading-5 text-slate-400">{text}</p></div></article>; }
function BuilderList({ title, values, tone }: { title: string; values: string[]; tone: "violet" | "amber" | "slate" }) { const classes = tone === "amber" ? "border-amber-400/20 bg-amber-500/[.035]" : tone === "violet" ? "border-red-400/20 bg-red-500/[.035]" : "border-white/7 bg-white/[.015]"; return <article className={`rounded-xl border p-4 ${classes}`}><strong className="text-sm text-slate-100">{title}</strong>{values.length ? <ul className="mt-3 space-y-2 text-xs text-slate-400">{values.map((value, index) => <li key={`${value}-${index}`} className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />{value}</li>)}</ul> : <p className="mt-3 text-xs text-slate-500">Hier ist aktuell nichts weiter zu tun.</p>}</article>; }
