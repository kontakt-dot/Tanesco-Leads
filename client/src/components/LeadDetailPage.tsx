import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import LeadClaimForm from "@/components/LeadClaimForm";
import { LeadLogTimeline } from "@/components/LeadLogDrawer";
import LeadTagManager from "@/components/LeadTagManager";
import { trpc } from "@/lib/trpc";
import { catPill, categoryColor, statusStyle } from "@/lib/colors";
import { AlertTriangle, ArrowLeft, Ban, Check, Clock3, Copy, ListChecks, Mail, MapPin, PackageCheck, Phone, PhoneCall, SearchX, Send, ShieldQuestion, Tag, Truck, UserRound, X } from "lucide-react";
import type React from "react";
import { leadDisplayName, metaLabel } from "../../../shared/lead-fields";
import { formatPhone, nameInitials } from "../../../shared/lead-age";
import { leadJourney, leadMoney, sinceText } from "../../../shared/lead-journey";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { confirmAction } from "@/lib/confirm";

const money = (value: string | number | null | undefined) => value === null || value === undefined ? "–" : `${Number(value).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const stamp = (value: Date | string | null | undefined) => value ? new Date(value).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "–";
const DECISION: Record<string, { label: string; color: string }> = { freigegeben: { label: "Freigegeben", color: "#16a34a" }, pruefen: { label: "Zur Prüfung", color: "#d97706" }, zurueckgewiesen: { label: "Zurückgewiesen", color: "#dc2626" }, offen: { label: "Offen", color: "#64748b" } };
const ANSWER: Record<string, { label: string; tone: string }> = { ja: { label: "Ja", tone: "is-yes" }, nein: { label: "Nein", tone: "is-no" }, unklar: { label: "Unklar", tone: "is-open" } };
const minutes = (seconds: number | null | undefined) => (typeof seconds === "number" && seconds > 0 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} Min` : null);
const resultLabel: Record<string, string> = { angeboten: "angeboten", angenommen: "angenommen", abgelehnt: "abgelehnt", übersprungen: "übersprungen", reklamiert: "reklamiert" };
/** Ton einer Auslieferung: angenommen (grün), im Reklamationsfenster (blau), abgelehnt/reklamiert (rot), übersprungen (bernstein) */
const resultTone = (result: string, inWindow: boolean) => result === "angenommen" ? (inWindow ? "info" : "good") : result === "abgelehnt" || result === "reklamiert" ? "bad" : result === "übersprungen" ? "warn" : "info";
const claimStatus: Record<string, string> = { offen: "Offen", in_prüfung: "In Prüfung", genehmigt: "Genehmigt", abgelehnt: "Abgelehnt" };
const claimTone = (status: string) => status === "genehmigt" ? "bad" : status === "abgelehnt" ? "good" : "warn";
const tint = (color: string) => ({ ["--cat" as string]: color }) as React.CSSProperties;
const scoreTone = (score: number) => (score >= 70 ? "good" : score >= 40 ? "warn" : "bad");
function copyText(text: string, what: string, done?: () => void) {
  if (!navigator.clipboard?.writeText) { toast.error("Kopieren geht in diesem Browser nicht."); return; }
  void navigator.clipboard.writeText(text).then(() => { toast.success(`${what} kopiert.`); done?.(); }, () => toast.error("Kopieren ging nicht."));
}
/** Überschrift einer Karte: Zeichen im Kästchen, Name (der Name ist das erste <span> im Kopf) */
const Title = ({ icon, children }: { icon: React.ReactNode; children: string }) => <span className="lp-title"><i className="lp-title-icon" aria-hidden="true">{icon}</i>{children}</span>;

/**
 * Lead-Seite (neu gestaltet in Version 367) – die Akte eines Leads:
 *  - Kopf: Kreis mit Kürzel in der Farbe der Kategorie, Name, Kategorie und Status, Ort, wie lange er da ist, Lieferant, ID zum Kopieren;
 *    darunter Anrufen, E-Mail schreiben und „Kontakt kopieren“ – rechts Reklamation, Deaktivieren, Jetzt ausliefern.
 *  - Weg des Leads in vier Schritten: Eingegangen → Geprüft → Ausgeliefert → nach dem Verkauf (Fenster, Reklamation, fest verkauft).
 *  - Wirtschaftlich (nur intern, nicht für Käufer und Lieferanten): Einkauf, Verkauf, Erstattet, Marge.
 *  - Links Fachfelder, Gespräch (Bewertung als Balken), Kontakt, Herkunft; rechts Auslieferung, Reklamationen, Tags, Lead-Log.
 */
export default function LeadDetailPage({ publicId, onBack, onOpenLog }: { publicId: string; onBack: () => void; onOpenLog?: () => void }) {
  const utils = trpc.useUtils();
  const detail = trpc.leadops.getLeadDetail.useQuery({ publicId }, { retry: false });
  const [claimOpen, setClaimOpen] = useState(false); const [showEmpty, setShowEmpty] = useState(false);
  // Nach dem Kopieren zeigt der Knopf kurz einen Haken
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (key: string, text: string, what: string) => copyText(text, what, () => { setCopied(key); window.setTimeout(() => setCopied((value) => (value === key ? null : value)), 1600); });
  const copyMark = (key: string) => (copied === key ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />);
  const refresh = () => { utils.leadops.getLeadDetail.invalidate({ publicId }); utils.leadops.getLeadAuditLog.invalidate({ publicId }); utils.leadops.listLeadsPaged.invalidate(); };
  const deliver = trpc.leadops.deliverLead.useMutation({ onSuccess: (result) => { refresh(); toast.success(result.result === "angenommen" ? `Ausgeliefert an ${result.buyerName}.` : result.result === "angeboten" ? `Angeboten an ${result.buyerName}.` : "Kein Käufer hat den Lead angenommen."); }, onError: (error) => toast.error(error.message) });
  const deactivate = trpc.leadops.deactivateLeads.useMutation({ onSuccess: () => { refresh(); toast.success("Lead deaktiviert."); }, onError: (error) => toast.error(error.message) });
  const lead = detail.data;
  // Zusatzfelder ohne eigene Definition: Der Server liefert sie schon mit lesbarem Namen und ohne die Vermerke der Software (Nummer des Gesprächs, Name der Liste …)
  const extraMeta = useMemo(() => lead?.extra ?? [], [lead]);
  const journey = useMemo(() => lead ? leadJourney({ status: lead.status, createdAt: lead.createdAt, supplierName: lead.supplier?.name ?? null, call: lead.call ? { decision: lead.call.decision ?? null, score: lead.call.score ?? null, at: lead.call.at ?? null } : null, deliveries: lead.deliveries, claims: lead.claims }) : [], [lead]);
  const worth = useMemo(() => lead ? leadMoney(lead.cost, lead.deliveries, lead.claims) : null, [lead]);
  // Laden: der Kopf als ruhige Platzhalter-Form (kein Springen, wenn die Daten da sind)
  if (detail.isLoading) return <div className="lead-profile" aria-busy="true"><span className="sr-only" role="status">Lead wird geladen …</span><button type="button" className="lp-back" onClick={onBack}><ArrowLeft aria-hidden="true" />Zurück zu den Leads</button><div className="lp-hero lp-loading" aria-hidden="true"><div className="lp-identity"><i className="lp-avatar lp-skel" /><div className="lp-identity-text"><span className="lp-skel" style={{ width: 150, height: 12 }} /><span className="lp-skel" style={{ width: 260, height: 28, marginTop: 10 }} /><span className="lp-skel" style={{ width: 340, height: 12, marginTop: 12 }} /></div></div></div><div className="lp-journey lp-loading" aria-hidden="true">{[0, 1, 2, 3].map((index) => <span key={index} className="lp-skel" style={{ height: 44 }} />)}</div></div>;
  if (detail.error || !lead) return <div className="lead-profile"><button type="button" className="lp-back" onClick={onBack}><ArrowLeft aria-hidden="true" />Zurück zu den Leads</button><section className="lp-missing" role="alert"><i aria-hidden="true"><SearchX /></i><div><h2>Lead nicht gefunden</h2><p>{detail.error?.message && detail.error.message !== "Lead wurde nicht gefunden." ? detail.error.message : `Zur ID ${publicId} gibt es keinen Lead – vielleicht wurde er gelöscht, oder die ID ist falsch geschrieben.`}</p><Button variant="outline" className="mt-3" onClick={onBack}>Zurück zu den Leads</Button></div></section></div>;
  const name = leadDisplayName(lead) || lead.publicId; const call = lead.call; const decision = call ? DECISION[call.decision ?? "offen"] ?? DECISION.offen : null;
  const latest = lead.deliveries.find((delivery) => delivery.result !== "übersprungen") ?? null;
  const format = (value: unknown) => Array.isArray(value) ? value.join(", ") : typeof value === "boolean" ? (value ? "Ja" : "Nein") : value === null || value === undefined || value === "" ? "–" : String(value);
  const status = statusStyle(lead.status); const catColor = categoryColor(lead.category ?? null);
  const place = [lead.street, [lead.postcode, lead.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const abroad = lead.country && lead.country !== "DE" ? lead.country : "";
  const contactText = [name, lead.company, lead.street, [lead.postcode, lead.city].filter(Boolean).join(" "), abroad, lead.phone, lead.email].filter(Boolean).join("\n");
  const filled = lead.fields.filter((field) => field.value !== null && field.value !== undefined && field.value !== ""); const empty = lead.fields.filter((field) => !filled.includes(field));
  const internal = lead.internal !== false;
  // Reklamationen in einem Satz: „keine Reklamation“, „1 Reklamation offen“, „2 Reklamationen, 1 offen“, „2 Reklamationen“
  const claimCount = lead.claims.length; const openClaims = lead.claims.filter((claim) => claim.status === "offen" || claim.status === "in_prüfung").length;
  const claimsNote = !claimCount ? "keine Reklamation" : openClaims === claimCount ? `${claimCount} ${claimCount === 1 ? "Reklamation" : "Reklamationen"} offen` : openClaims ? `${claimCount} Reklamationen, ${openClaims} offen` : `${claimCount} ${claimCount === 1 ? "Reklamation" : "Reklamationen"}`;
  return <div className="lead-profile">
    <button type="button" className="lp-back" onClick={onBack}><ArrowLeft aria-hidden="true" />Zurück zu den Leads</button>
    <header className="lp-hero" style={tint(catColor)}>
      <div className="lp-hero-top">
        <div className="lp-identity">
          <i className="lp-avatar" aria-hidden="true">{nameInitials(name)}</i>
          <div className="lp-identity-text">
            <p className="lp-kicker">{lead.category && <b className="lp-cat-code">{lead.category.shortcode}</b>}<span className="lp-cat-name">{lead.category?.name ?? "Ohne Kategorie"}</span><span className="lp-status" style={tint(status.color)}><i aria-hidden="true" />{status.label}</span></p>
            <h1>{name}</h1>
            <p className="lp-facts">
              {(place || abroad) && <span><MapPin aria-hidden="true" />{[place, abroad].filter(Boolean).join(" · ")}</span>}
              <span title={`Eingegangen am ${stamp(lead.createdAt)}`}><Clock3 aria-hidden="true" />eingegangen {sinceText(lead.createdAt)}</span>
              {lead.supplier && <span><Truck aria-hidden="true" />von {lead.supplier.name}</span>}
              <button type="button" className={`lp-id${copied === "id" ? " is-copied" : ""}`} title="ID kopieren" aria-label={`ID ${lead.publicId} kopieren`} onClick={() => copy("id", lead.publicId, "ID")}><code>{lead.publicId}</code>{copyMark("id")}</button>
            </p>
          </div>
        </div>
        <div className="lp-actions"><Button variant="outline" onClick={() => setClaimOpen(true)}><AlertTriangle /> Reklamation erfassen</Button><Button variant="outline" disabled={deactivate.isPending || lead.status === "deaktiviert"} onClick={async () => { if (await confirmAction("Lead wirklich deaktivieren?")) deactivate.mutate({ publicIds: [lead.publicId] }); }}><Ban /> Deaktivieren</Button><Button className="flux-button" disabled={deliver.isPending} onClick={() => deliver.mutate({ publicId: lead.publicId })}><Send /> Jetzt ausliefern</Button></div>
      </div>
      <div className="lp-quick" role="group" aria-label="Kunden erreichen">
        {lead.phone ? <a className="lp-quick-btn is-call" href={`tel:${lead.phone}`}><i aria-hidden="true"><Phone /></i><span><small>Anrufen</small><b>{formatPhone(lead.phone)}</b></span></a> : <span className="lp-quick-btn is-empty"><i aria-hidden="true"><Phone /></i><span><small>Anrufen</small><b>keine Rufnummer</b></span></span>}
        {lead.email ? <a className="lp-quick-btn" href={`mailto:${lead.email}`}><i aria-hidden="true"><Mail /></i><span><small>E-Mail schreiben</small><b>{lead.email}</b></span></a> : <span className="lp-quick-btn is-empty"><i aria-hidden="true"><Mail /></i><span><small>E-Mail schreiben</small><b>keine E-Mail-Adresse</b></span></span>}
        <button type="button" className={`lp-quick-btn${copied === "contact" ? " is-copied" : ""}`} onClick={() => copy("contact", contactText, "Kontakt")}><i aria-hidden="true">{copyMark("contact")}</i><span><small>Name, Anschrift, Telefon, E-Mail</small><b>{copied === "contact" ? "Kopiert" : "Kontakt kopieren"}</b></span></button>
      </div>
    </header>

    <ol className="lp-journey" aria-label="Weg des Leads">{journey.map((step, index) => <li key={step.key} className={`lp-step is-${step.state}`}><span className="lp-step-mark" aria-hidden="true">{step.state === "done" ? <Check /> : step.state === "fail" ? <X /> : step.state === "warn" ? "!" : index + 1}</span><span className="lp-step-text"><b>{step.title}</b><small>{step.detail}</small>{typeof step.progress === "number" && <span className="lp-step-bar" title={`${Math.round(step.progress * 100)} % der Frist sind um`} aria-hidden="true"><i style={{ width: `${Math.round(step.progress * 100)}%` }} /></span>}</span></li>)}</ol>

    {internal && worth && <dl className="lp-money" aria-label="Was der Lead gebracht hat">
      <div><dt>Einkauf</dt><dd><b>{money(worth.bought)}</b><small>beim Lieferanten</small></dd></div>
      <div><dt>Verkauf</dt><dd><b>{worth.buyers ? money(worth.sold) : "–"}</b><small>{worth.buyers ? `an ${worth.buyers} Käufer` : "noch nicht verkauft"}</small></dd></div>
      <div><dt>Erstattet</dt><dd><b>{worth.refunded ? `− ${money(worth.refunded)}` : "–"}</b><small>{claimsNote}</small></dd></div>
      <div className={`is-margin ${worth.buyers ? (worth.margin > 0 ? "is-plus" : worth.margin < 0 ? "is-minus" : "") : ""}`}><dt>Marge</dt><dd><b>{worth.buyers ? `${worth.margin > 0 ? "+ " : worth.margin < 0 ? "− " : ""}${money(Math.abs(worth.margin))}` : "–"}</b><small>{worth.marginShare !== null ? `${worth.marginShare < 0 ? "−" : ""}${Math.abs(worth.marginShare)} % vom Verkauf` : worth.buyers ? "ohne Verkaufspreis" : "nach dem Verkauf"}</small>{worth.marginShare !== null && worth.marginShare > 0 && <span className="lp-money-meter" aria-hidden="true"><i style={{ width: `${Math.min(100, worth.marginShare)}%` }} /></span>}</dd></div>
    </dl>}

    {claimOpen && <div className="mb-4"><LeadClaimForm leadId={lead.id} publicId={lead.publicId} onClose={() => setClaimOpen(false)} onCreated={() => { setClaimOpen(false); refresh(); toast.success("Reklamation erfasst."); }} /></div>}
    <div className="lead-page-grid lp-grid">
      <div className="lp-col">
        <section className="lead-page-card lead-fields-card"><header><Title icon={<ListChecks />}>Fachfelder</Title><span className="lp-head-note">{lead.fields.length ? `${filled.length} von ${lead.fields.length} ausgefüllt` : lead.category?.name ?? ""}</span></header><div>{(() => { const note = lead.fieldsFromCallAt ? <p className="lead-fields-note"><PhoneCall aria-hidden="true" /> Aus dem Gespräch übernommen am {stamp(lead.fieldsFromCallAt)} – leere Felder kamen im Gespräch nicht vor.</p> : call && call.decision === "freigegeben" ? <p className="lead-fields-note is-waiting"><PhoneCall aria-hidden="true" /> Die Felder werden gerade aus dem Gespräch gelesen. Das dauert ein paar Minuten – dann stehen sie hier.</p> : null; return !filled.length && !extraMeta.length && !empty.length ? <>{note}<p className="lp-empty">Für diese Lead-Kategorie sind keine Fachfelder angelegt.</p></> : <>{note}{(filled.length || extraMeta.length) ? <dl className="lead-kv lp-tiles">{filled.map((field) => <div key={field.key}><dt>{field.label}</dt><dd>{format(field.value)}</dd></div>)}{extraMeta.map((field) => <div key={field.key}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl> : <p className="lp-empty">Noch keine Fachfelder ausgefüllt.</p>}{empty.length > 0 && <div className="mt-3"><button type="button" className="lp-link" onClick={() => setShowEmpty((value) => !value)}>{showEmpty ? "Leere Felder ausblenden" : `${empty.length} leere ${empty.length === 1 ? "Feld" : "Felder"} anzeigen`}</button>{showEmpty && <dl className="lead-kv lp-tiles is-empty mt-3">{empty.map((field) => <div key={field.key}><dt>{field.label}</dt><dd>–</dd></div>)}</dl>}</div>}</>; })()}</div></section>
        {call && decision && <section className="lead-page-card lead-call-card"><header><Title icon={<PhoneCall />}>Gespräch</Title><a className="lp-link" href={`/?page=Gespr%C3%A4che&callId=${call.id}`}>Gespräch öffnen</a></header><div>
          <div className="lead-call-top"><Badge variant="outline" className="cat-strong" style={catPill(decision.color)}>{decision.label}</Badge>{typeof call.score === "number" && <span className="lead-call-score" title="Punkte der Gesprächsbewertung"><b>{call.score}</b> von 100 Punkten</span>}<span>{stamp(call.at)}{minutes(call.durationSeconds) ? ` · ${minutes(call.durationSeconds)}` : ""}</span>{call.agentName && <span>Agent <b>{call.agentName}</b>{call.agentAlias && call.agentAlias !== call.agentName ? ` (am Telefon: ${call.agentAlias})` : ""}</span>}{call.campaign && <span>Kampagne <b>{call.campaign}</b></span>}{call.count > 1 && <span>{call.count} Gespräche mit diesem Lead</span>}</div>
          {typeof call.score === "number" && <span className={`lp-score is-${scoreTone(call.score)}`} role="meter" aria-label="Bewertung des Gesprächs" aria-valuemin={0} aria-valuemax={100} aria-valuenow={call.score}><i style={{ width: `${Math.max(0, Math.min(100, call.score))}%` }} /></span>}
          {call.summary && <p className="lead-call-summary">{call.summary}</p>}
          {call.answers.length > 0 && <><h3 className="lead-call-title">Antworten aus dem Gespräch</h3><ul className="lead-call-answers">{call.answers.map((item) => { const answer = ANSWER[item.answer] ?? ANSWER.unklar; return <li key={item.key}><span className={`lead-call-answer ${answer.tone}`}>{answer.label}</span><div><strong>{item.label}</strong>{item.note && <p>{item.note}</p>}</div></li>; })}</ul></>}
        </div></section>}
        <section className="lead-page-card"><header><Title icon={<UserRound />}>Kontakt</Title></header><div><dl className="lead-kv"><div><dt>Name</dt><dd>{name}</dd></div>{lead.company && <div><dt>Firma</dt><dd>{lead.company}</dd></div>}<div><dt>E-Mail</dt><dd>{lead.email ? <span className="lp-value-row"><a className="lp-contact" href={`mailto:${lead.email}`}><Mail aria-hidden="true" />{lead.email}</a><button type="button" className={`lp-copy${copied === "email" ? " is-copied" : ""}`} aria-label="E-Mail-Adresse kopieren" title="Kopieren" onClick={() => copy("email", lead.email!, "E-Mail-Adresse")}>{copyMark("email")}</button></span> : "–"}</dd></div><div><dt>Telefon</dt><dd>{lead.phone ? <span className="lp-value-row"><a className="lp-contact" href={`tel:${lead.phone}`}><Phone aria-hidden="true" />{formatPhone(lead.phone)}</a><button type="button" className={`lp-copy${copied === "phone" ? " is-copied" : ""}`} aria-label="Rufnummer kopieren" title="Kopieren" onClick={() => copy("phone", lead.phone!, "Rufnummer")}>{copyMark("phone")}</button></span> : "–"}</dd></div><div><dt>Adresse</dt><dd><span className="lp-value-row is-top"><MapPin className="lp-inline-icon" aria-hidden="true" /><span>{lead.street && <>{lead.street}<br /></>}{[lead.postcode, lead.city].filter(Boolean).join(" ") || (lead.street ? "" : "–")}{lead.country ? ` · ${lead.country}` : ""}</span></span></dd></div></dl></div></section>
        <section className="lead-page-card"><header><Title icon={<Truck />}>Herkunft</Title></header><div><dl className="lead-kv"><div><dt>Lieferant</dt><dd>{lead.supplier?.name ?? "–"}</dd></div><div><dt>Lieferanten-Kontakt</dt><dd>{lead.supplier?.email ?? "–"}</dd></div><div><dt>Quelle</dt><dd>{format(lead.metadata.source ?? lead.metadata.quelle ?? lead.metadata.utm_source)}</dd></div><div><dt>Kampagne</dt><dd>{format(lead.metadata.campaign ?? lead.metadata.kampagne ?? lead.metadata.utm_campaign)}</dd></div>{lead.metadata.partnerReference ? <div><dt>Partner-Referenz</dt><dd>{String(lead.metadata.partnerReference)}</dd></div> : null}{(["dialerResult", "dialerNote", "dialerCallbackAt"] as const).map((key) => lead.metadata[key] ? <div key={key}><dt>{metaLabel(key)}</dt><dd>{format(lead.metadata[key])}</dd></div> : null)}{lead.metadata.rawBatch ? <div><dt>Liste</dt><dd>{String(lead.metadata.rawBatch)}</dd></div> : null}<div><dt>Eingegangen</dt><dd>{stamp(lead.createdAt)}</dd></div><div><dt>Zuletzt geändert</dt><dd>{stamp(lead.updatedAt)}</dd></div></dl></div></section>
      </div>
      <div className="lp-col">
        <section className="lead-page-card"><header><Title icon={<PackageCheck />}>Auslieferung</Title>{latest && <span className={`lp-chip is-${resultTone(latest.result, latest.inWindow)}`}>{latest.inWindow ? "im Reklamationsfenster" : resultLabel[latest.result] ?? latest.result}</span>}</header><div>{!lead.deliveries.length ? <p className="lp-empty">Noch nicht ausgeliefert.{lead.status === "genehmigt" ? " Der Lead ist freigegeben – „Jetzt ausliefern“ schickt ihn an den passenden Käufer." : ""}</p> : <ul className="lp-list">{lead.deliveries.map((delivery) => <li key={delivery.id} className="lp-entry"><i className="lp-entry-avatar" aria-hidden="true">{nameInitials(delivery.buyerName)}</i><div className="lp-entry-main"><div className="lp-entry-head"><strong>{delivery.buyerName}</strong><span className={`lp-chip is-${resultTone(delivery.result, delivery.inWindow)}`}>{delivery.inWindow ? "im Reklamationsfenster" : resultLabel[delivery.result] ?? delivery.result}</span></div><p>{[delivery.chainName ? `Kette ${delivery.chainName}${delivery.stopPosition ? ` · Stop ${delivery.stopPosition}` : ""}` : null, delivery.orderNumber ? `Bestellung ${delivery.orderNumber}` : null, delivery.skipReason ? `Grund: ${delivery.skipReason}` : null, delivery.inWindow && delivery.windowEndsAt ? `angenommen ab ${stamp(delivery.windowEndsAt)}` : null].filter(Boolean).join(" · ") || "direkt ausgeliefert"}</p></div><div className="lp-entry-side"><b>{delivery.result !== "übersprungen" ? money(delivery.unitPrice) : "–"}</b><small>{stamp(delivery.occurredAt)}</small></div></li>)}</ul>}</div></section>
        <section className="lead-page-card"><header><Title icon={<ShieldQuestion />}>Reklamationen</Title><span className="lp-head-note">{lead.claims.length ? `${lead.claims.length}` : "keine"}</span></header><div>{!lead.claims.length ? <p className="lp-empty">Keine Reklamationen.</p> : <ul className="lp-list">{lead.claims.map((claim) => <li key={claim.id} className="lp-entry"><i className={`lp-entry-mark is-${claimTone(claim.status)}`} aria-hidden="true"><AlertTriangle /></i><div className="lp-entry-main"><div className="lp-entry-head"><strong>{claim.reason}</strong><span className={`lp-chip is-${claimTone(claim.status)}`}>{claimStatus[claim.status] ?? claim.status}</span></div>{claim.details && <p>{claim.details}</p>}<p className="lp-entry-foot">{[claim.resolvedAt ? `erledigt ${stamp(claim.resolvedAt)}` : claim.dueAt ? `Frist ${new Date(claim.dueAt).toLocaleDateString("de-DE")}` : null].filter(Boolean).join(" · ")}</p></div><div className="lp-entry-side"><b>{claim.refundAmount ? money(claim.refundAmount) : "–"}</b><small>{stamp(claim.createdAt)}</small></div></li>)}</ul>}</div></section>
        <section className="lead-page-card"><header><Title icon={<Tag />}>Tags</Title></header><div><LeadTagManager publicId={lead.publicId} bare /></div></section>
        <section className="lead-page-card"><header><Title icon={<Clock3 />}>Lead-Log</Title>{onOpenLog && <button type="button" className="lp-link" onClick={onOpenLog}>Als Schublade öffnen</button>}</header><div><LeadLogTimeline publicId={lead.publicId} /></div></section>
      </div>
    </div>
  </div>;
}
