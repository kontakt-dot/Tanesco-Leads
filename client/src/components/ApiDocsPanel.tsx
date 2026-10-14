import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { useMemo, useState } from "react";
import { toast } from "sonner";

const Code = ({ children }: { children: string }) => <pre className="mt-2 max-h-80 overflow-auto rounded-md border border-white/10 bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-100 whitespace-pre-wrap">{children}</pre>;
const Section = ({ title, children }: { title: string; children: React.ReactNode }) => <section className="surface-panel operations-panel p-5"><span className="eyebrow">{title}</span><div className="mt-2 text-sm text-slate-300">{children}</div></section>;
const Row = ({ code, text }: { code: string; text: string }) => <div className="grid gap-1 border-b border-white/8 py-2 md:grid-cols-[110px_1fr]"><code className="text-xs text-violet-200">{code}</code><span className="text-xs text-slate-300">{text}</span></div>;

export default function ApiDocsPanel() {
  const base = typeof window !== "undefined" ? window.location.origin : "https://leads.example.de";
  const categories = trpc.leadops.listCategories.useQuery(undefined, { retry: false });
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const selected = categoryId ?? categories.data?.[0]?.id ?? null;
  const fields = trpc.leadops.listCategoryFields.useQuery({ categoryId: selected ?? 0 }, { retry: false, enabled: Boolean(selected) });
  const category = categories.data?.find((item) => item.id === selected);
  const copy = async (value: string) => { try { await navigator.clipboard.writeText(value); toast.success("Kopiert."); } catch { toast.error("Kopieren nicht möglich."); } };
  const importExample = useMemo(() => `curl -X POST ${base}/api/v1/leads \\
  -H "Authorization: Bearer <DEIN_TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "lead_type_id": "${category?.shortcode ?? "PV"}",
    "first_name": "Max",
    "last_name": "Mustermann",
    "email": "max@example.de",
    "phone": "+49 170 1234567",
    "zip_code": "10115",
    "city": "Berlin",
    "country_code": "DE",
    "custom_data": {${(fields.data ?? []).slice(0, 4).map((field) => `\n      "${field.fieldKey}": ${Array.isArray(field.options) && (field.options as unknown[]).length ? `"${String((field.options as unknown[])[0])}"` : field.fieldType === "zahl" ? "120" : '"…"'}`).join(",")}
    }
  }'`, [base, category, fields.data]);
  return <div className="mt-4 grid gap-4">
    <header><span className="eyebrow">API-DOKUMENTATION</span><h2 className="mt-1 text-lg text-slate-100">Lead-Import, Reklamation und Rechnungen per API</h2><p className="mt-1 text-xs text-slate-400">Basis-Adresse: <code className="text-violet-200">{base}</code>. Alle Antworten sind JSON. Zeiten in UTC (ISO 8601).</p></header>
    <Section title="AUTHENTIFIZIERUNG"><p>Jede Anfrage trägt einen Token im Header <code className="text-violet-200">Authorization: Bearer &lt;TOKEN&gt;</code>. Es gibt zwei Arten:</p><Row code="Mandant" text="Mandantenweiter Token (oben auf dieser Seite erzeugen): darf Leads in jede Kategorie importieren; der Lieferant wird über supplierId oder supplierName gesetzt." /><Row code="Persönlich" text="Persönlicher Token eines Benutzers (Benutzer → Lieferant → Token): Importe laufen auf dessen Lieferantenprofil, seine Kategorie-/Feld-/Wert-Mappings und PrePing greifen, max. 120 Importe pro Minute. Nur dieser Token darf reklamieren." /><p className="mt-2 text-xs text-slate-400">Ein unbekannter oder zurückgezogener Token liefert 401.</p></Section>
    <Section title="POST /api/v1/leads — LEAD IMPORTIEREN"><p>Legt einen Lead an, löst die Automatisierung aus und liefert bei Echtzeit-Bestellungen sofort aus. Auch erreichbar unter <code className="text-violet-200">/api/leads</code>.</p>
      <div className="mt-3"><Row code="categoryId" text="Nummer der Lead-Kategorie – oder alternativ lead_type_id (Kürzel oder Name, ggf. über das Kategorie-Mapping des Lieferanten)." /><Row code="first_name" text="Vorname (alias firstName)." /><Row code="last_name" text="Nachname (alias lastName)." /><Row code="email" text="E-Mail-Adresse." /><Row code="phone" text="Telefonnummer; bei aktiver Telefonnummern-Prüfung wird sie geprüft." /><Row code="zip_code" text="Postleitzahl (alias postcode)." /><Row code="city" text="Ort." /><Row code="country_code" text="DE, AT oder CH (alias country; Standard DE)." /><Row code="custom_data" text="Objekt mit den Zusatzfeldern der Kategorie (Schlüssel siehe unten; alias metadata)." /><Row code="supplierId / supplierName" text="Nur bei mandantenweitem Token: Lieferant des Leads." /><Row code="cost" text="Einkaufspreis des Leads (Zahl, optional)." /></div>
      <div className="mt-3 flex items-center gap-2"><span className="text-xs text-slate-400">Feldschlüssel für Kategorie:</span><select className="h-9 rounded-md border border-white/10 bg-slate-900 px-2 text-xs text-slate-100" value={selected ?? ""} onChange={(event) => setCategoryId(Number(event.target.value))}>{(categories.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name} ({item.shortcode})</option>)}</select></div>
      {fields.data && <div className="mt-2">{fields.data.map((field) => <Row key={field.id} code={field.fieldKey} text={`${field.label} · ${field.fieldType}${field.required ? " · Pflicht" : ""}${Array.isArray(field.options) && (field.options as unknown[]).length ? ` · Werte: ${(field.options as unknown[]).join(", ")}` : ""}`} />)}{!fields.data.length && <p className="text-xs text-slate-500">Diese Kategorie hat keine Zusatzfelder.</p>}</div>}
      <div className="mt-3 flex items-center justify-between"><span className="text-xs text-slate-400">Beispiel</span><Button size="sm" variant="ghost" onClick={() => copy(importExample)}>Kopieren</Button></div><Code>{importExample}</Code>
      <p className="mt-3 text-xs text-slate-400">Antworten:</p><Row code="201" text='{ "id": "API-XXXXXXXX", "status": "neu", "supplierId": 12, "automation": { "executed": 1, "delivered": 1 } }' /><Row code="401" text="Token ungültig." /><Row code="403" text="Persönlicher Token ohne Lieferantenprofil." /><Row code="409" text='{ "error": "duplicated lead", "existingLeadId": "…" } – PrePing: Kontakt existiert bereits (E-Mail/Telefon).' /><Row code="422" text="Pflichtangabe fehlt, Kategorie unbekannt („Lead type not found“) oder strikt abgelehnter Wert." /><Row code="429" text="Mehr als 120 Importe pro Minute (persönlicher Token)." />
    </Section>
    <Section title="POST /api/reclaim — LEAD REKLAMIEREN"><p>Nur mit dem persönlichen Token des Käufers, dem der Lead zugewiesen wurde. Prüft Reklamationsfenster, gesperrte Kategorien und ausgeschlossene Gründe des Käufers. Bei „API-Reklamationen automatisch annehmen“ wird sofort genehmigt, erstattet und – wenn der Grund weiterreicht – an den nächsten Stop weitergegeben.</p>
      <div className="mt-3"><Row code="reason" text="Grund-Key: Name des Reklamationsgrunds in Kleinbuchstaben mit Unterstrichen (z. B. dublette, falsche_telefonnummer); Alias duplikat = Dublette." /><Row code="lead_number" text="Interne Lead-Nummer (lead_number aus dem API-Call) – oder" /><Row code="lead_id" text="Öffentliche Lead-ID (z. B. API-1A2B3C4D) – oder" /><Row code="partner_lead_id" text="Referenz aus der Antwort des Käufer-Systems (z. B. Aroundhome-UUID)." /><Row code="comment" text="Freitext (optional)." /></div>
      <Code>{`curl -X POST ${base}/api/reclaim \\
  -H "Authorization: Bearer <PERSOENLICHER_TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{ "reason": "duplikat", "lead_number": 4711, "comment": "Kunde bereits bekannt" }'`}</Code>
      <p className="mt-3 text-xs text-slate-400">Antworten:</p><Row code="200" text='{ "reclamation_id": 99, "reinjected": true, "refund_cents": 4800, "status": "approved" | "open" }' /><Row code="403" text="Reklamationsfenster abgelaufen, Kategorie gesperrt, Grund ausgeschlossen oder mandantenweiter Token." /><Row code="404" text="Lead nicht gefunden oder nicht diesem Käufer zugewiesen." /><Row code="409" text="Bereits reklamiert oder Lead nicht im Zustand „zugewiesen“." /><Row code="422" text='Unbekannter Grund – Antwort enthält "valid": [ …gültige Keys… ].' />
    </Section>
    <Section title="POST /api/v1/claims — REKLAMATION (MANDANTENTOKEN)"><p>Für interne Systeme mit mandantenweitem Token: <code className="text-violet-200">{`{ "publicId": "…", "reason": "…" }`}</code>. Die Reklamation entsteht offen zur Prüfung.</p></Section>
    <Section title="GET /api/v1/invoices — RECHNUNGEN"><p>Liefert die Rechnungen des Mandanten (Token mit Bereich invoices:read).</p><Code>{`curl ${base}/api/v1/invoices -H "Authorization: Bearer <TOKEN>"`}</Code></Section>
    <Section title="AUSGEHEND: WAS DER KÄUFER BEKOMMT"><p>Bei jeder Zuweisung senden wir an die Endpoints des Käufers (Benutzer → Integration) den Body seiner Vorlage. Ohne Vorlage: <code className="text-violet-200">{`{ "lead_id", "lead_number", "first_name", "last_name", "email", "phone", "postal_code", "city", "country_code", "custom_data": { … } }`}</code>. Zusätzlich an die Webhook-URL des Käufers: das Standardformat mit <code className="text-violet-200">lead</code>, <code className="text-violet-200">fields</code> und <code className="text-violet-200">test: true</code> bei Tests.</p>
      <p className="mt-2">Platzhalter für Vorlagen: <code className="text-violet-200">{`{{lead_id}} {{lead_number}} {{salutation}} {{first_name}} {{last_name}} {{email}} {{phone}} {{street}} {{street_name}} {{house_number}} {{postal_code}} {{city}} {{country_code}} {{lead_type}} {{lead_type_shortcode}} {{date}} {{custom_data.<feld>}}`}</code>, in Rückgabe-Webhooks zusätzlich <code className="text-violet-200">{`{{returned}} {{reclaim_reason}}`}</code>.</p></Section>
    <Section title="PARTNER-RÜCKMELDUNGEN"><Row code="WattFox" text={`GET oder POST auf die Tracking-URL (Einstellungen → Integrationen) mit lead_id (oder uuid), status und code|reason. Stornos werden über die Zuordnung zu Reklamationen.`} /><Row code="Aroundhome" text="Abgleich über den Export-Link des Kontos; Vorgänge mit Status „storniert“ erzeugen Reklamationen, zugeordnet über die Stornogründe." /><Row code="Cron" text={`POST ${base}/api/scheduled/integration-health mit Header x-cron-secret für die geplante Integrationsprüfung.`} /></Section>
  </div>;
}
