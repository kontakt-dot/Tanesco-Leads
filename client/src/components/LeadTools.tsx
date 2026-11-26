import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { confirmAction } from "@/lib/confirm";
import { ChevronDown, ExternalLink, FileUp, Send, ShieldCheck, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { endpointTestLabel, endpointTestNote } from "../../../shared/endpoint-test";

/**
 * Werkzeuge über der Leads-Tabelle (seit v377 in einer eigenen Datei):
 *  • TestLeadPanel – „Testlead senden“: an eine Schnittstelle beim Käufer oder an eine Verbindung aus Einstellungen → Integrationen
 *  • ImportDrop – Feld, in das man die CSV-Datei zieht (oder klickt)
 *  • SavedFilters – gespeicherte Filter laden und löschen
 */

type TestResult = { ok: boolean; title: string; text: string; sent?: string };

/**
 * „Testlead senden“. Die Auswahl zeigt beides: die eingeschalteten Schnittstellen der Käufer (Benutzer → Käufer → Integration) und die
 * Verbindungen aus Einstellungen → Integrationen. Bei einer Schnittstelle gibt sie die Kategorie vor. Zeigt eine Wattfox-Schnittstelle
 * auf das Live-System, geht kein erfundener Lead raus – geprüft wird nur die Anmeldung. Das Ergebnis steht direkt im Fenster.
 */
export function TestLeadPanel({ onClose }: { onClose: () => void }) {
  const utils = trpc.useUtils();
  const integrations = trpc.leadops.listPartnerIntegrations.useQuery(undefined, { retry: false });
  const endpoints = trpc.leadops.listEndpointTestTargets.useQuery(undefined, { retry: false });
  const categories = trpc.leadops.listCategories.useQuery(undefined, { retry: false });
  const [target, setTarget] = useState(""); const [categoryId, setCategoryId] = useState(""); const [result, setResult] = useState<TestResult | null>(null);
  const targets = endpoints.data ?? []; const active = useMemo(() => (integrations.data ?? []).filter((item) => item.status === "aktiv"), [integrations.data]);
  const endpoint = target.startsWith("e:") ? targets.find((item) => item.id === Number(target.slice(2))) : undefined;
  const integration = target.startsWith("i:") ? active.find((item) => item.id === Number(target.slice(2))) : undefined;
  const loginOnly = endpoint?.kind === "wattfox-live";
  const testEndpoint = trpc.leadops.testDeliveryEndpoint.useMutation({
    onSuccess: (answer) => setResult(answer.loginOnly
      ? { ok: answer.ok, title: answer.ok ? "Anmeldung klappt – es wurde kein Lead gesendet" : "Anmeldung fehlgeschlagen – es wurde kein Lead gesendet", text: answer.responseBody }
      : { ok: answer.ok, title: answer.ok ? `Angekommen (HTTP ${answer.status})` : `Nicht angenommen (HTTP ${answer.status || "ohne Antwort"})`, text: answer.responseBody || "(keine Antwort)", sent: answer.requestBody }),
    onError: (error) => setResult({ ok: false, title: "Der Test ließ sich nicht senden", text: error.message }),
  });
  const testIntegration = trpc.leadops.sendIntegrationTestLead.useMutation({
    onSuccess: (answer) => { utils.leadops.listPartnerIntegrations.invalidate(); const ok = answer.eventType === "geliefert"; const status = `HTTP ${answer.responseStatus ?? "ohne Antwort"}`; setResult({ ok, title: ok ? `Testlead ${answer.publicId} angekommen (${status})` : `Testlead ${answer.publicId} nicht angenommen (${status})`, text: answer.responseBody?.trim() || "Den Vorgang findest du auch im Integrationslog der Verbindung." }); toast[ok ? "success" : "error"](`Testlead ${answer.publicId} gesendet (${status}).`); },
    onError: (error) => setResult({ ok: false, title: "Der Test ließ sich nicht senden", text: error.message }),
  });
  const busy = testEndpoint.isPending || testIntegration.isPending;
  const ready = endpoint ? true : Boolean(integration && Number(categoryId));
  const pick = (value: string) => { setTarget(value); setResult(null); };
  const send = () => { setResult(null); if (endpoint) testEndpoint.mutate({ membershipId: endpoint.membershipId, id: endpoint.id }); else if (integration) testIntegration.mutate({ integrationId: integration.id, categoryId: Number(categoryId) }); };
  const loaded = !integrations.isLoading && !endpoints.isLoading; const none = loaded && !targets.length && !active.length;
  const pretty = (text: string) => { try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; } };

  return <section className="surface-panel ld-panel ld-test" aria-label="Testlead senden">
    <header className="ld-head"><div><span className="eyebrow">SICHERER VERBINDUNGSTEST</span><h2>Testlead senden</h2><p>Ein erfundener Lead ohne Kundendaten. Wähle, wohin er gehen soll – das Ergebnis steht gleich hier darunter.</p></div><button type="button" className="ld-close" aria-label="Schließen" onClick={onClose}><X aria-hidden="true" /></button></header>
    {none ? <div className="ld-empty"><p><b>Es ist noch keine Schnittstelle eingeschaltet.</b> Leads gehen über die Schnittstelle beim Käufer raus: unter „Benutzer“ den Käufer öffnen und im Reiter „Integration“ die Schnittstelle einrichten.</p><a className="lt-chip ld-link" href="/?page=Benutzer">Zu den Benutzern <ExternalLink aria-hidden="true" /></a></div>
    : <>
      <div className="ld-fields">
        <label className="ld-field"><span>Wohin?</span><select className="filter-select" aria-label="Schnittstelle auswählen" value={target} onChange={(event) => pick(event.target.value)}>
          <option value="">{loaded ? "Schnittstelle auswählen" : "Schnittstellen werden geladen …"}</option>
          {targets.length > 0 && <optgroup label="Schnittstellen der Käufer">{targets.map((item) => <option key={`e${item.id}`} value={`e:${item.id}`}>{endpointTestLabel(item, targets)}</option>)}</optgroup>}
          {active.length > 0 && <optgroup label="Verbindungen aus Einstellungen → Integrationen">{active.map((item) => <option key={`i${item.id}`} value={`i:${item.id}`}>{item.name}</option>)}</optgroup>}
        </select></label>
        <label className="ld-field"><span>Lead-Kategorie</span>{endpoint
          ? <output className="ld-fixed" aria-label="Lead-Kategorie">{endpoint.categoryName}<small>von der Schnittstelle vorgegeben</small></output>
          : <select className="filter-select" aria-label="Lead-Kategorie auswählen" disabled={!integration} value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setResult(null); }}><option value="">Lead-Kategorie auswählen</option>{categories.data?.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>}</label>
      </div>
      {endpoint && <p className={`ld-note ${loginOnly ? "is-live" : ""}`}><ShieldCheck aria-hidden="true" /><span>{endpointTestNote(endpoint.kind)}{endpoint.host ? <> Ziel: <b>{endpoint.host}</b>.</> : null} <a href={`/?page=Benutzer&member=${endpoint.membershipId}&tab=integration`}>Schnittstelle beim Käufer öffnen</a></span></p>}
      {endpoints.error && <p className="ld-note"><ShieldCheck aria-hidden="true" /><span>Schnittstellen der Käufer kann nur ein Administrator testen – hier stehen deshalb nur die Verbindungen aus den Einstellungen.</span></p>}
      {result && <div className={`ld-result ${result.ok ? "is-ok" : "is-bad"}`} role="status"><strong>{result.title}</strong><pre>{pretty(result.text)}</pre>{result.sent && <details><summary>Gesendete Daten ansehen</summary><pre>{pretty(result.sent)}</pre></details>}</div>}
      <footer className="ld-actions"><Button variant="outline" onClick={onClose}>{result ? "Schließen" : "Abbrechen"}</Button><Button className="flux-button" disabled={!ready || busy} onClick={send}><Send aria-hidden="true" /> {busy ? (loginOnly ? "Prüft die Anmeldung …" : "Sendet …") : loginOnly ? "Anmeldung prüfen" : "Testlead senden"}</Button></footer>
    </>}
  </section>;
}

/**
 * Feld für den Datei-Import: Datei hineinziehen oder klicken. Nimmt nur CSV – eine Excel-Datei wird mit einem Hinweis abgelehnt,
 * statt als Zeichensalat eingelesen zu werden.
 */
export function ImportDrop({ disabled, fileName, onFile }: { disabled?: boolean; fileName?: string; onFile: (file: File) => void }) {
  const [over, setOver] = useState(false);
  const take = (file?: File | null) => {
    if (!file) return;
    if (/\.(xlsx?|numbers|ods)$/i.test(file.name)) { toast.error("Das ist eine Excel-Datei. Hier geht nur CSV: in Excel „Datei → Speichern unter → CSV“ wählen und die neue Datei hochladen."); return; }
    if (!/\.(csv|txt)$/i.test(file.name) && !/csv|text\/plain/i.test(file.type)) { toast.error("Bitte eine CSV-Datei wählen (Endung .csv)."); return; }
    onFile(file);
  };
  return <label className={`ld-drop ${over ? "is-over" : ""} ${disabled ? "is-off" : ""}`}
    onDragEnter={(event) => { event.preventDefault(); if (!disabled) setOver(true); }} onDragOver={(event) => { event.preventDefault(); if (!disabled) setOver(true); }}
    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false); }}
    onDrop={(event) => { event.preventDefault(); setOver(false); if (!disabled) take(event.dataTransfer.files?.[0]); }}>
    <input type="file" className="sr-only" disabled={disabled} accept=".csv,text/csv" aria-label="CSV-Datei auswählen" onChange={(event) => { const file = event.target.files?.[0]; take(file); try { event.target.value = ""; } catch { /* dieselbe Datei lässt sich so noch einmal wählen */ } }} />
    <FileUp aria-hidden="true" />
    <span className="ld-drop-text"><b>{over ? "Loslassen – die Datei wird eingelesen" : fileName ? fileName : "CSV-Datei hierher ziehen"}</b><small>{fileName && !over ? "Andere Datei hierher ziehen oder klicken" : "oder klicken und Datei auswählen"}</small></span>
  </label>;
}

/** Gespeicherte Filter: anklicken lädt, der Papierkorb löscht (mit Rückfrage). Klick daneben oder Esc schließt das Menü. */
export function SavedFilters<View extends { id: string; name: string }>({ views, onLoad, onDelete, onDeleteAll }: { views: View[]; onLoad: (view: View) => void; onDelete: (view: View) => void; onDeleteAll: () => void }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const close = () => { if (ref.current) ref.current.open = false; };
  useEffect(() => {
    const onDown = (event: PointerEvent) => { if (ref.current?.open && !ref.current.contains(event.target as Node)) close(); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("pointerdown", onDown); window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("pointerdown", onDown); window.removeEventListener("keydown", onKey); };
  }, []);
  if (!views.length) return null;
  const remove = async (view: View) => { if (await confirmAction(`Gespeicherten Filter „${view.name}“ löschen?`, { confirmLabel: "Löschen", danger: true })) onDelete(view); };
  const removeAll = async () => { if (await confirmAction(`Alle ${views.length} gespeicherten Filter löschen?`, { confirmLabel: "Alle löschen", danger: true })) { onDeleteAll(); close(); } };
  return <details className="lt-savedmenu" ref={ref}>
    <summary className="lt-chip" aria-label={`Gespeicherte Filter (${views.length})`}>Gespeicherte Filter<em>{views.length}</em><ChevronDown aria-hidden="true" /></summary>
    <div className="lt-savedmenu-list" role="group" aria-label="Gespeicherte Filter laden oder löschen">
      {views.map((view) => <div key={view.id} className="lt-saved-row">
        <button type="button" className="lt-saved-load" title={`„${view.name}“ laden`} onClick={() => { onLoad(view); close(); }}>{view.name}</button>
        <button type="button" className="lt-saved-del" aria-label={`Gespeicherten Filter „${view.name}“ löschen`} title="Löschen" onClick={() => void remove(view)}><Trash2 aria-hidden="true" /></button>
      </div>)}
      {views.length > 1 && <button type="button" className="lt-saved-all" onClick={() => void removeAll()}>Alle gespeicherten Filter löschen</button>}
    </div>
  </details>;
}
