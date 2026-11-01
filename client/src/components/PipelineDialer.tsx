import { Badge } from "@/components/ui/badge";
import { rememberedSipgateDevice, rememberSipgateDevice } from "@/lib/sipgate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import AutoNoteSwitch from "@/components/AutoNoteSwitch";
import { trpc } from "@/lib/trpc";
import { useSoftphone } from "@/lib/useSoftphone";
import { CALL_STATUS_LABELS, DISPOSITIONS, type DispositionKey } from "../../../shared/dialer";
import { lostStage, stageLabel, type PipelineStage, type StageDef } from "../../../shared/sales-pipeline";
import { ChevronRight, Mic, MicOff, Phone, PhoneOff, Play, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/** Ein Kontakt in der Wählliste des Pipeline-Dialers (Karten der Pipeline, in Spaltenreihenfolge). */
export type DialTarget = { id: number; publicId: string; name: string; phone: string | null; stage: PipelineStage; company?: string | null; city?: string | null };
export type DialMode = "einzel" | "manuell" | "power" | "predictive";

/** Welche Stufe nach einem Anruf-Ergebnis sinnvoll ist – nur vorwärts, nie zurück. */
export function stageAfterDisposition(disposition: DispositionKey, current: PipelineStage, stageDefs: StageDef[]): PipelineStage | null {
  const wanted: PipelineStage | null = disposition === "verkauft" ? "termin" : disposition === "interessiert" ? "qualifiziert" : disposition === "wiedervorlage" ? "kontaktiert" : disposition === "kein_interesse" || disposition === "nicht_anrufen" ? lostStage(stageDefs) : null;
  if (!wanted || !stageDefs.some((stage) => stage.key === wanted)) return null;
  if (wanted === lostStage(stageDefs)) return current === wanted ? null : wanted;
  const order = stageDefs.map((stage) => stage.key);
  const from = order.indexOf(current); const to = order.indexOf(wanted);
  return to > from ? wanted : null;
}

export const DIAL_MODES: Array<{ key: Exclude<DialMode, "einzel">; label: string; hint: string }> = [
  { key: "manuell", label: "Manuell", hint: "Du startest jeden Anruf selbst – Kontakt für Kontakt in Spaltenreihenfolge." },
  { key: "power", label: "Power", hint: "Nach jedem Ergebnis wählt die Software sofort den nächsten Kontakt. Besetzt/Keine Antwort → später erneut." },
  { key: "predictive", label: "Predictive", hint: "Die Software wählt mehrere Nummern gleichzeitig und stellt angenommene Gespräche zu dir durch." },
];

const fmt = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
const ENDED = ["beendet", "besetzt", "keine_antwort", "anrufbeantworter", "abgebrochen", "fehlgeschlagen"];
const stamp = () => new Date().toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/**
 * Dialer direkt in der Vertriebspipeline: eine Karte anrufen (Einzelanruf) oder eine ganze Stufe als Wählliste –
 * manuell, Power oder Predictive, mit Ergebnis, automatischer Gesprächsnotiz (Schalter) und passender Stufe nach dem
 * Gespräch. Läuft über dieselbe Telefonie wie das Callcenter (sipgate oder Simulation); Stufen-Listen werden als
 * Kampagne „Pipeline: …“ angelegt (sichtbar unter Telefonie → Kampagnen, mit Wiederholung bei Besetzt/Keine Antwort).
 */
export default function PipelineDialer({ queue, start, mode: initialMode, listLabel, stageDefs, onClose, onChanged }: { queue: DialTarget[]; start: number; mode: "einzel" | "setup"; listLabel?: string; stageDefs: StageDef[]; onClose: () => void; onChanged: () => void }) {
  const utils = trpc.useUtils();
  const phone = useSoftphone();
  const session = trpc.leadops.currentDialerSession.useQuery(undefined, { retry: false, refetchInterval: 2500 });
  const settings = trpc.leadops.getTelephonySettings.useQuery(undefined, { retry: false });
  const sipgate = settings.data?.provider === "sipgate";
  const devices = trpc.leadops.sipgateDevices.useQuery(undefined, { retry: false, enabled: Boolean(sipgate) });
  const [deviceId, setDeviceId] = useState<string>(() => rememberedSipgateDevice() ?? "");
  const chosenDevice = deviceId || settings.data?.sipgate?.deviceId || "";
  const startSession = trpc.leadops.startDialerSession.useMutation();
  const updateSession = trpc.leadops.updateDialerSession.useMutation();
  const place = trpc.leadops.placeManualCall.useMutation();
  const nextCall = trpc.leadops.nextDialerCall.useMutation();
  const tick = trpc.leadops.runPredictiveTick.useMutation();
  const saveCampaign = trpc.leadops.saveDialerCampaign.useMutation();
  const buildQueue = trpc.leadops.buildDialerQueue.useMutation();
  const setCampaignStatus = trpc.leadops.setDialerCampaignStatus.useMutation();
  const end = trpc.leadops.endDialerCall.useMutation();
  const consent = trpc.leadops.markCallConsent.useMutation({ onSuccess: () => { toast.success("Einwilligung vermerkt – Aufzeichnung läuft."); session.refetch(); }, onError: (error) => toast.error(error.message) });
  const disposition = trpc.leadops.setCallDisposition.useMutation();
  const pipelineSettings = trpc.leadops.pipelineSettings.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const move = trpc.leadops.movePipelineStage.useMutation();
  const autoNotes = trpc.leadops.setAutoCallNotes.useMutation({ onSuccess: () => { session.refetch(); utils.leadops.getTelephonySettings.invalidate(); }, onError: (error) => toast.error(error.message) });

  const [phase, setPhase] = useState<"setup" | "running" | "done">(initialMode === "einzel" ? "running" : "setup");
  const [dialMode, setDialMode] = useState<DialMode>(initialMode === "einzel" ? "einzel" : "power");
  const [campaignId, setCampaignId] = useState<number | null>(null);
  const [index, setIndex] = useState(start);
  const [notes, setNotes] = useState(""); const [followUp, setFollowUp] = useState("240");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [calls, setCalls] = useState(0);
  const [lastResult, setLastResult] = useState<{ name: string; label: string; summary: string | null; autoNotes: boolean; stage: PipelineStage | null } | null>(null);
  const [activeCallId, setActiveCallId] = useState<number | null>(null);
  const handledRef = useRef<number | null>(null);
  const startedRef = useRef(false);
  const idleTicksRef = useRef(0);

  const callQuery = trpc.leadops.getDialerCall.useQuery({ callId: activeCallId ?? 0 }, { enabled: Boolean(activeCallId), refetchInterval: 2000, retry: false });
  const queueState = trpc.leadops.listDialerQueue.useQuery({ campaignId: campaignId ?? 0, limit: 1000 }, { enabled: Boolean(campaignId), refetchInterval: 5000, retry: false });

  const current = session.data;
  // Predictive: der Anruf kommt über die Sitzung herein
  useEffect(() => { if (dialMode === "predictive" && current?.currentCallId && current.currentCallId !== activeCallId) { setActiveCallId(current.currentCallId); handledRef.current = null; setNotes(""); setLastResult(null); setCalls((value) => value + 1); } }, [dialMode, current?.currentCallId, activeCallId]);
  const call = activeCallId ? (callQuery.data ?? (current?.call && current.call.id === activeCallId ? current.call : null)) : null;
  const callEnded = Boolean(call && ENDED.includes(call.status));
  const callActive = Boolean(call && !callEnded);
  const target: DialTarget | null = dialMode === "einzel" ? queue[index] ?? null : call?.lead?.publicId ? queue.find((item) => item.publicId === call.lead!.publicId) ?? { id: 0, publicId: call.lead.publicId, name: call.lead.name, phone: call.toNumber, stage: stageDefs[0]?.key ?? "neu", city: call.lead.city } : null;
  const effectiveAutoNotes = current ? current.autoNotes !== false : settings.data?.autoCallNotes !== false;
  const queueStats = (() => { const items = queueState.data ?? []; const finished = items.filter((item) => item.status === "erledigt" || item.status === "ausgeschlossen").length; const waiting = items.filter((item) => item.status === "wiederholen").length; const open = items.filter((item) => item.status === "offen" || item.status === "waehlt" || item.status === "verbunden").length; return { total: items.length, finished, waiting, open }; })();
  const refreshPipeline = useCallback(() => { onChanged(); utils.leadops.listPipelineNotes.invalidate(); utils.leadops.pipelineHistory.invalidate(); utils.leadops.listDialerCalls.invalidate(); utils.leadops.listDialerCampaigns.invalidate(); utils.leadops.pipelineDueList.invalidate(); utils.leadops.listPipelineTasks.invalidate(); }, [onChanged, utils]);

  useEffect(() => { if (!call?.connectedAt || callEnded) { if (!call?.connectedAt) setElapsed(0); return; } const timer = window.setInterval(() => setElapsed(Math.max(0, Math.round((Date.now() - new Date(call.connectedAt!).getTime()) / 1000))), 1000); return () => window.clearInterval(timer); }, [call?.connectedAt, callEnded]);

  const failWith = (reason: unknown, fallback: string) => { const message = reason instanceof Error ? reason.message : fallback; setError(message); toast.error(message); };

  /** Einzelanruf: Sitzung sicherstellen (manuell, Browser) und die Karte anrufen. */
  const dialSingle = useCallback(async (i: number) => {
    const next = queue[i]; if (!next) { setPhase("done"); return; }
    if (!next.phone) { toast(`${next.name}: keine Telefonnummer.`); setPhase("done"); return; }
    setBusy(true); setError(null); setLastResult(null); setNotes(""); setIndex(i);
    try {
      const existing = await utils.leadops.currentDialerSession.fetch();
      if (existing?.currentCallId) { await end.mutateAsync({ callId: existing.currentCallId, durationSeconds: null }).catch(() => undefined); await updateSession.mutateAsync({ status: "bereit" }).catch(() => undefined); }
      if (!existing || existing.mode !== "manuell" || existing.campaignId) await startSession.mutateAsync({ campaignId: null, mode: "manuell", connection: sipgate ? "sipgate" : "browser", agentPhone: null, agentDeviceId: chosenDevice || null });
      const instruction = await place.mutateAsync({ publicId: next.publicId });
      setActiveCallId(instruction.callId); handledRef.current = null; setCalls((value) => value + 1);
      await phone.connect(instruction.params).catch((connectError: Error) => toast.error(connectError.message));
      await session.refetch();
    } catch (reason) { failWith(reason, "Anruf konnte nicht gestartet werden."); } finally { setBusy(false); }
  }, [queue, utils, end, updateSession, startSession, place, phone, session, sipgate, chosenDevice]);

  /** Kampagnen-Modi: nächsten fälligen Eintrag der Wählliste anrufen. */
  const dialNext = useCallback(async () => {
    setBusy(true); setError(null); setLastResult(null); setNotes("");
    try {
      const existing = await utils.leadops.currentDialerSession.fetch();
      if (existing?.currentCallId) { const openCall = existing.call; if (openCall && !ENDED.includes(openCall.status)) await end.mutateAsync({ callId: openCall.id, durationSeconds: null }).catch(() => undefined); await updateSession.mutateAsync({ status: "bereit" }).catch(() => undefined); }
      const result = await nextCall.mutateAsync();
      if (result.done || !result.instruction) { setPhase("done"); await queueState.refetch(); return; }
      setActiveCallId(result.instruction.callId); handledRef.current = null; setCalls((value) => value + 1);
      await phone.connect(result.instruction.params).catch((connectError: Error) => toast.error(connectError.message));
      await session.refetch();
    } catch (reason) { failWith(reason, "Der nächste Anruf konnte nicht gestartet werden."); } finally { setBusy(false); }
  }, [utils, end, updateSession, nextCall, phone, session, queueState]);

  /** Stufe als Kampagne anlegen (nur diese Karten), Wählliste füllen, Sitzung starten. */
  const startCampaign = async (selected: Exclude<DialMode, "einzel">) => {
    setBusy(true); setError(null);
    try {
      const ids = queue.map((item) => item.id).filter((id) => id > 0);
      const saved = await saveCampaign.mutateAsync({ name: `Pipeline: ${listLabel ?? "Auswahl"} · ${stamp()}`, mode: selected, leadFilter: { leadIds: ids, statuses: [] }, callerNumberId: null, maxAttempts: 3, retryMinutes: 240, wrapUpSeconds: 0, pacingRatio: selected === "predictive" ? 1.5 : null, autoNotes: null, callWindow: { weekdays: [0, 1, 2, 3, 4, 5, 6], from: "00:00", to: "23:59" }, script: "" });
      await buildQueue.mutateAsync({ campaignId: saved.id });
      await setCampaignStatus.mutateAsync({ id: saved.id, status: "aktiv" });
      const existing = await utils.leadops.currentDialerSession.fetch();
      if (existing?.currentCallId) await end.mutateAsync({ callId: existing.currentCallId, durationSeconds: null }).catch(() => undefined);
      await startSession.mutateAsync({ campaignId: saved.id, mode: selected, connection: sipgate ? "sipgate" : "browser", agentPhone: null, agentDeviceId: chosenDevice || null });
      setCampaignId(saved.id); setDialMode(selected); setPhase("running"); idleTicksRef.current = 0;
      if (selected !== "predictive") await dialNext();
      else await tick.mutateAsync().catch(() => undefined);
    } catch (reason) { failWith(reason, "Die Wählliste konnte nicht gestartet werden."); } finally { setBusy(false); }
  };

  useEffect(() => { if (initialMode === "einzel" && !startedRef.current) { startedRef.current = true; void dialSingle(start); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Predictive: alle 5 s wählen lassen, solange die Sitzung bereit ist; fertig, wenn nichts mehr offen ist
  useEffect(() => {
    if (phase !== "running" || dialMode !== "predictive" || !campaignId) return undefined;
    const timer = window.setInterval(async () => {
      if (current?.status !== "bereit") return;
      const summary = await tick.mutateAsync().catch(() => null);
      const items = (await queueState.refetch()).data ?? [];
      const pending = items.some((item) => item.status === "offen" || item.status === "waehlt" || item.status === "verbunden" || (item.status === "wiederholen" && item.nextAttemptAt && new Date(item.nextAttemptAt) <= new Date()));
      idleTicksRef.current = summary && (summary.dialed > 0 || summary.connected > 0) ? 0 : idleTicksRef.current + 1;
      if (!pending && idleTicksRef.current >= 2) setPhase("done");
    }, 5000);
    return () => window.clearInterval(timer);
  }, [phase, dialMode, campaignId, current?.status, tick, queueState]);

  const hangup = async () => { if (!call) return; try { await end.mutateAsync({ callId: call.id, durationSeconds: elapsed || null }); phone.hangup(); await session.refetch(); await callQuery.refetch(); } catch (reason) { toast.error(reason instanceof Error ? reason.message : "Auflegen fehlgeschlagen."); } };

  const finish = useCallback(async (key: DispositionKey, options: { silent?: boolean } = {}) => {
    if (!call) return;
    setBusy(true);
    try {
      const result = await disposition.mutateAsync({ callId: call.id, disposition: key, notes: notes.trim() || null, followUpMinutes: key === "wiedervorlage" ? Number(followUp) || null : null });
      const definition = DISPOSITIONS.find((item) => item.key === key)!;
      const name = target?.name ?? call.lead?.name ?? call.toNumber;
      const nextStage = target && target.id > 0 ? stageAfterDisposition(key, target.stage, stageDefs) : null;
      if (nextStage && target) await move.mutateAsync({ publicId: target.publicId, stage: nextStage, note: `Anruf-Ergebnis: ${definition.label}` }).catch((moveError: Error) => toast.error(moveError.message));
      setLastResult({ name, label: options.silent ? `${definition.label} (${CALL_STATUS_LABELS[call.status] ?? call.status})` : definition.label, summary: result?.summary ?? null, autoNotes: result?.autoNotes !== false, stage: nextStage });
      if (options.silent) toast(`${name}: ${CALL_STATUS_LABELS[call.status] ?? call.status} – ${dialMode === "power" ? "weiter zum nächsten Kontakt." : "später erneut."}`); else toast.success(nextStage ? `${name}: ${definition.label} → ${stageLabel(nextStage, stageDefs)}` : `${name}: ${definition.label}`);
      if (!options.silent && (key === "wiedervorlage" || key === "interessiert" || key === "nicht_erreicht") && pipelineSettings.data?.dispositionTasks !== false) toast(key === "wiedervorlage" ? "Wiedervorlage unter „Aufgaben“ angelegt." : key === "interessiert" ? "Aufgabe „Angebot / Unterlagen schicken“ unter „Aufgaben“ angelegt." : "Erneuter Versuch unter „Aufgaben“ eingeplant.");
      refreshPipeline(); await session.refetch(); await callQuery.refetch();
      if (dialMode === "einzel") setPhase("done");
      else if (dialMode === "power") window.setTimeout(() => { void dialNext(); }, options.silent ? 1200 : 900);
      else if (dialMode === "predictive") { setActiveCallId(null); idleTicksRef.current = 0; }
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : "Ergebnis konnte nicht gespeichert werden."); }
    finally { setBusy(false); }
  }, [call, target, disposition, notes, followUp, stageDefs, move, refreshPipeline, session, callQuery, dialMode, dialNext]);

  // Nicht erreicht (Besetzt/Keine Antwort/Anrufbeantworter): in den Listen-Modi automatisch verbuchen – die Wählliste wiederholt später
  useEffect(() => {
    if (!call || !callEnded || call.disposition || call.status === "beendet" || dialMode === "einzel" || handledRef.current === call.id || busy) return;
    handledRef.current = call.id;
    void finish("nicht_erreicht", { silent: true });
  }, [call, callEnded, dialMode, busy, finish]);

  const close = async () => {
    if (callActive) await hangup();
    if (campaignId) { await setCampaignStatus.mutateAsync({ id: campaignId, status: phase === "done" ? "beendet" : "pausiert" }).catch(() => undefined); await updateSession.mutateAsync({ status: "offline" }).catch(() => undefined); utils.leadops.listDialerCampaigns.invalidate(); }
    onClose();
  };
  const switchAutoNotes = async (enabled: boolean) => { try { if (call && !call.disposition) await autoNotes.mutateAsync({ scope: "anruf", callId: call.id, enabled }); await autoNotes.mutateAsync(campaignId ? { scope: "kampagne", campaignId, enabled } : { scope: "global", enabled }); toast.success(enabled ? "Automatische Gesprächsnotiz an." : "Automatische Gesprächsnotiz aus."); } catch { /* onError */ } };
  const missingNumber = error ? /Rufnummer/i.test(error) : false;
  const modeLabel = dialMode === "einzel" ? "Einzelanruf" : DIAL_MODES.find((item) => item.key === dialMode)?.label ?? dialMode;
  const statusText = call ? CALL_STATUS_LABELS[call.status] ?? call.status : busy ? "Wählt …" : phase === "done" ? "Fertig" : dialMode === "predictive" ? (current?.status === "bereit" ? "Wählt für dich …" : "Bereit") : "Bereit";
  const lineBadge = phone.provider === "sipgate" ? "sipgate – das Gespräch läuft über dein sipgate-Telefon" : phone.simulated ? "Simulation (kein echtes Audio)" : phone.state === "bereit" ? "Softphone bereit" : phone.state === "im_gespraech" ? "Leitung aktiv" : phone.state === "fehler" ? `Softphone: ${phone.error}` : "Softphone lädt …";
  const withPhone = queue.filter((item) => item.phone).length;
  const progress = dialMode === "einzel" ? null : campaignId ? `${queueStats.finished} / ${queueStats.total || withPhone} erledigt${queueStats.waiting ? ` · ${queueStats.waiting} Wiederholung` : ""}` : `${withPhone} Kontakte`;
  const numberLink = missingNumber && <> <a href="/?page=Telefonie&view=rufnummern" onClick={(event) => { event.preventDefault(); window.location.assign("/?page=Telefonie&view=rufnummern"); }}>Rufnummer einrichten (Telefonie → Rufnummern)</a></>;

  if (phase === "setup") return <aside className="pipeline-dialer" role="dialog" aria-label="Dialer in der Pipeline">
    <header className="pipeline-dialer-head"><div className="pipeline-dialer-title"><Phone className="h-4 w-4" aria-hidden="true" /><strong>Dialer</strong><span>{listLabel ? `Stufe ${listLabel}` : "Wählliste"} · {withPhone} Kontakt{withPhone === 1 ? "" : "e"} mit Telefonnummer</span><small className="pipeline-dialer-line">{lineBadge}</small></div><div className="pipeline-dialer-tools"><AutoNoteSwitch enabled={effectiveAutoNotes} pending={autoNotes.isPending} onChange={switchAutoNotes} /><button type="button" className="pipeline-dialer-close" aria-label="Dialer schließen" onClick={onClose}><X className="h-4 w-4" /></button></div></header>
    <div className="pipeline-dialer-body pipeline-dialer-setup">
      {sipgate && <label className="pipeline-dialer-device">Mein sipgate-Gerät (klingelt zuerst)<select className="lead-action-select" value={chosenDevice} onChange={(event) => { setDeviceId(event.target.value); rememberSipgateDevice(event.target.value || null); }}><option value="">— bitte wählen —</option>{(devices.data ?? []).map((device) => <option key={device.id} value={device.id}>{device.alias} ({device.id})</option>)}</select></label>}
      <div className="pipeline-dialer-modes" role="radiogroup" aria-label="Dialer-Modus">{DIAL_MODES.filter((item) => !(sipgate && item.key === "predictive")).map((item) => <button key={item.key} type="button" role="radio" aria-checked={dialMode === item.key} className={`pipeline-dialer-mode ${dialMode === item.key ? "active" : ""}`} onClick={() => setDialMode(item.key)}><strong>{item.label}</strong><span>{item.hint}</span></button>)}</div>
      <div className="pipeline-dialer-setup-actions"><p className="text-xs text-slate-400">Die Liste wird als Kampagne „Pipeline: {listLabel ?? "Auswahl"}“ angelegt (Telefonie → Kampagnen): Besetzt, Keine Antwort und Anrufbeantworter werden nach 4 Stunden erneut versucht, höchstens 3-mal. Ergebnisse, Notizen und Stufenwechsel landen direkt an den Karten.</p><Button className="flux-button" disabled={busy || !withPhone} onClick={() => { void startCampaign(dialMode === "einzel" ? "power" : dialMode); }}><Play /> {busy ? "Startet …" : `${DIAL_MODES.find((item) => item.key === dialMode)?.label ?? "Power"} starten`}</Button></div>
      {error && <p className="pipeline-dialer-error">{error}{numberLink}</p>}
    </div>
  </aside>;

  return <aside className="pipeline-dialer" role="dialog" aria-label="Dialer in der Pipeline">
    <header className="pipeline-dialer-head">
      <div className="pipeline-dialer-title"><Phone className="h-4 w-4" aria-hidden="true" /><strong>Dialer</strong><span>{modeLabel}{progress ? ` · ${progress}` : ""}</span><Badge variant="outline" className={callActive ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200" : "border-white/15 text-slate-300"}>{statusText}</Badge>{call?.connectedAt && !callEnded && <span className="pipeline-dialer-timer">{fmt(elapsed)}</span>}<small className="pipeline-dialer-line">{lineBadge}</small></div>
      <div className="pipeline-dialer-tools"><AutoNoteSwitch enabled={effectiveAutoNotes} pending={autoNotes.isPending} onChange={switchAutoNotes} /><button type="button" className="pipeline-dialer-close" aria-label="Dialer schließen" onClick={() => { void close(); }}><X className="h-4 w-4" /></button></div>
    </header>
    <div className="pipeline-dialer-body">
      <div className="pipeline-dialer-contact">
        {target ? <><strong>{target.name}</strong><span>{[target.company, target.city].filter(Boolean).join(" · ") || "–"}</span><span className="pipeline-dialer-phone">{target.phone ?? call?.toNumber ?? "keine Telefonnummer"}</span><span className="dash-pill muted">{stageLabel(target.stage, stageDefs)}</span></> : phase === "done" ? <strong>Keine weiteren Kontakte.</strong> : dialMode === "predictive" ? <><strong>Warte auf Gespräch …</strong><span>Die Software wählt für dich; angenommene Gespräche erscheinen hier.</span></> : <strong>Bereit.</strong>}
      </div>
      <div className="pipeline-dialer-controls">
        {callActive && <Button size="sm" variant="outline" onClick={() => { void hangup(); }} disabled={end.isPending}><PhoneOff /> Auflegen</Button>}
        {callActive && call?.status === "verbunden" && !phone.simulated && <Button size="sm" variant="outline" onClick={phone.toggleMute}>{phone.muted ? <><MicOff /> Stumm aus</> : <><Mic /> Stumm</>}</Button>}
        {callActive && call?.status === "verbunden" && settings.data?.consentMode === "agent_button" && !settings.data?.recordWithoutConsent && !call.consentAt && <Button size="sm" className="flux-button" onClick={() => consent.mutate({ callId: call.id })} disabled={consent.isPending}><ShieldCheck /> Einwilligung erteilt → Aufzeichnung</Button>}
        {callActive && settings.data?.recordWithoutConsent && settings.data.recordCalls && call?.status === "verbunden" ? <span className="dash-pill" title="Einstellung: Aufzeichnung ohne Einwilligungsabfrage">Aufzeichnung ohne Abfrage</span> : callActive && call?.consentAt && <span className="dash-pill">Aufzeichnung mit Einwilligung</span>}
        {!callActive && phase !== "done" && !busy && dialMode === "einzel" && !call && target && <Button size="sm" className="flux-button" onClick={() => { void dialSingle(index); }}><Phone /> Anrufen</Button>}
        {!callActive && phase !== "done" && !busy && dialMode === "manuell" && (!call || call.disposition) && <Button size="sm" className="flux-button" onClick={() => { void dialNext(); }}><Phone /> Nächsten anrufen</Button>}
        {!callActive && phase !== "done" && !busy && dialMode === "power" && (!call || call.disposition) && <Button size="sm" variant="ghost" onClick={() => { void dialNext(); }}>Weiter <ChevronRight /></Button>}
        {phase === "done" && <Button size="sm" variant="outline" onClick={() => { void close(); }}>Schließen</Button>}
      </div>
      {error && <p className="pipeline-dialer-error">{error}{numberLink}</p>}
      {call && callEnded && !call.disposition && (call.status === "beendet" || dialMode === "einzel") && <div className="pipeline-dialer-result">
        <span className="eyebrow">ERGEBNIS</span>
        <textarea value={notes} rows={2} placeholder="Notizen zum Gespräch (optional)" onChange={(event) => setNotes(event.target.value)} />
        <div className="pipeline-dialer-dispositions">{DISPOSITIONS.map((item) => <button key={item.key} type="button" className={`segment-tab ${item.key === "verkauft" || item.key === "interessiert" ? "active" : ""}`} disabled={busy || disposition.isPending} onClick={() => { void finish(item.key); }}>{item.label}</button>)}</div>
        <label className="pipeline-dialer-followup">Wiedervorlage in <Input value={followUp} onChange={(event) => setFollowUp(event.target.value)} /> Min.</label>
        {call.status !== "beendet" && <small className="text-slate-500">Kein Gespräch zustande gekommen ({CALL_STATUS_LABELS[call.status] ?? call.status}) – „Nicht erreicht“ legt den Kontakt zur Wiedervorlage.</small>}
      </div>}
      {call && callEnded && call.status === "beendet" && !call.disposition && <div className="call-note-box"><span className="eyebrow">GESPRÄCHSNOTIZ (AUTOMATISCH)</span>{call.summary ? <p>{call.summary}</p> : call.autoNotes === false ? <p className="text-slate-400">Für diesen Anruf ausgeschaltet.</p> : <p className="text-slate-400">Wird erstellt … erscheint hier, an der Karte und im Verlauf.</p>}</div>}
      {lastResult && (!call || call.disposition) && <div className="call-note-box"><span className="eyebrow">LETZTES GESPRÄCH · {lastResult.name.toUpperCase()}</span><p><b>Ergebnis: {lastResult.label}</b>{lastResult.stage ? ` · Karte → ${stageLabel(lastResult.stage, stageDefs)}` : ""}</p>{lastResult.summary ? <p>{lastResult.summary}</p> : <p className="text-slate-400">{lastResult.autoNotes ? "Gesprächsnotiz wird erstellt, sobald Transkript und Bewertung vorliegen." : "Automatische Notiz war ausgeschaltet."}</p>}</div>}
      {phase === "done" && <p className="pipeline-dialer-done">{dialMode === "einzel" ? "Gespräch abgeschlossen – die Notiz steht an der Karte." : `Liste abtelefoniert – ${calls} Anruf${calls === 1 ? "" : "e"}${queueStats.waiting ? `, ${queueStats.waiting} Kontakt${queueStats.waiting === 1 ? "" : "e"} auf Wiederholung (Telefonie → Kampagnen)` : ""}. Die Notizen stehen an den Karten.`}</p>}
    </div>
  </aside>;
}
