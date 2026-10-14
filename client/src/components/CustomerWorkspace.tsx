/**
 * Kunden-Layout „MEIN BEREICH“: was ein Käufer- oder Lieferanten-Zugang sieht – und was ein Admin sieht, der sich per
 * „Als Benutzer einloggen“ als dieser Kunde anmeldet (gelbes Banner mit „← Zurück zum Admin“).
 */
import { useAuth } from "@/_core/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import LeadClaimForm from "@/components/LeadClaimForm";
import PasswordDialog from "@/components/PasswordDialog";
import { TanescoLogo } from "@/components/TanescoLogo";
import AppearanceMenu from "@/components/AppearanceMenu";
import AssistantLauncher from "@/components/AssistantLauncher";
import HelpButton from "@/components/HelpButton";
import { trpc } from "@/lib/trpc";
import { MobileTabBar, useEyebrowIcons, useMobileTables } from "@/components/MobileAppShell";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { Cable, ClipboardList, Eye, EyeOff, FileUp, LayoutDashboard, LifeBuoy, Menu, PackageCheck, Settings, ShieldQuestion, UserRoundCog, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type Access = inferRouterOutputs<AppRouter>["leadops"]["customerAccess"];
type CustomerPage = Access["pages"][number];
const ICONS: Record<CustomerPage, typeof LayoutDashboard> = { Dashboard: LayoutDashboard, Leads: ClipboardList, Bestellungen: PackageCheck, Reklamationen: ShieldQuestion, "Lead-Import": FileUp, Integrationen: Cable, Support: LifeBuoy, Einstellungen: Settings };
const money = (value: string | number | null | undefined) => value === null || value === undefined ? "–" : `${Number(value).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const stamp = (value: Date | string) => new Date(value).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
const field = "h-10 w-full rounded-md border border-white/10 bg-slate-900 px-3 text-sm text-slate-100";
const leadStatusLabel: Record<string, string> = { neu: "Neu", genehmigt: "Freigegeben", zugewiesen: "Zugestellt", reklamiert: "Reklamiert", fehlerhaft: "Fehlerhaft", deaktiviert: "Deaktiviert", hängend: "Hängend", dublette: "Dublette" };
const claimStatusLabel: Record<string, string> = { offen: "Offen", in_prüfung: "In Prüfung", genehmigt: "Genehmigt", abgelehnt: "Abgelehnt" };
const badgeClass = (status: string) => status === "genehmigt" || status === "zugewiesen" || status === "gelöst" ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200" : status === "reklamiert" || status === "abgelehnt" || status === "fehlerhaft" ? "border-red-400/25 bg-red-500/10 text-red-200" : status === "offen" || status === "in_prüfung" || status === "in_bearbeitung" ? "border-amber-400/25 bg-amber-500/10 text-amber-200" : "border-white/15 text-slate-300";
export const IMPERSONATION_RETURN_KEY = "tanesco.impersonationReturn";

export default function CustomerWorkspace({ access }: { access: Access }) {
  const { user, logout } = useAuth();
  const utils = trpc.useUtils();
  const pages = access.pages;
  const [page, setPage] = useState<CustomerPage>(() => { const requested = new URLSearchParams(window.location.search).get("page"); return pages.includes(requested as CustomerPage) ? requested as CustomerPage : "Dashboard"; });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showNumbers, setShowNumbers] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const stopImpersonation = trpc.auth.stopImpersonation.useMutation({ onSuccess: (result) => { const stored = window.sessionStorage.getItem(IMPERSONATION_RETURN_KEY); window.sessionStorage.removeItem(IMPERSONATION_RETURN_KEY); const membershipId = result.membershipId ?? (stored ? Number(stored) : null); window.location.assign(membershipId ? `/?page=Benutzer&member=${membershipId}` : "/?page=Benutzer"); utils.invalidate(); }, onError: (error) => toast.error(error.message) });
  useEffect(() => { document.querySelector<HTMLElement>(".flux-sidebar nav .nav-item.active")?.scrollIntoView({ block: "nearest" }); }, [page]);
  useMobileTables();
  useEyebrowIcons();
  const navigate = (next: CustomerPage) => { setPage(next); setSidebarOpen(false); window.history.replaceState(null, "", `/?page=${encodeURIComponent(next)}`); };
  const initials = (access.name || access.company).split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return <div className="flux-shell customer-shell">
    {passwordDialogOpen && <PasswordDialog onClose={() => setPasswordDialogOpen(false)} />}
    <aside className={`flux-sidebar ${sidebarOpen ? "mobile-open" : ""}`}>
      <div className="brand"><span className="brand-logo-full"><TanescoLogo /></span><button className="mobile-close" onClick={() => setSidebarOpen(false)}><X /></button></div>
      <div className="tenant-chip"><span className="tenant-avatar">{access.company.slice(0, 2).toUpperCase()}</span><div className="tenant-copy"><strong>{access.company}</strong><small>{access.partnerType === "lieferant" ? "Lieferanten-Zugang" : "Kunden-Zugang"} · {access.tenantName}</small></div></div>
      <nav><section className="nav-group"><span className="nav-group-label">MEIN BEREICH</span>{pages.filter((item) => item !== "Einstellungen").map((item) => { const Icon = ICONS[item]; return <button key={item} className={page === item ? "nav-item active" : "nav-item"} onClick={() => navigate(item)}><Icon /><span>{item}</span></button>; })}</section></nav>
      <div className="sidebar-bottom">
        <button className={page === "Einstellungen" ? "nav-item active" : "nav-item"} onClick={() => navigate("Einstellungen")}><Settings /><span>Einstellungen</span></button>
        <button className="nav-item" title="Sprache"><span aria-hidden="true">🇩🇪</span><span>Deutsch</span></button>
        <button className="nav-item" onClick={() => logout()}><X /><span>Abmelden</span></button>
      </div>
    </aside>
    <main className="workspace">
      {user?.impersonatedBy && <div className="impersonation-banner" role="status"><span className="flex items-center gap-2"><UserRoundCog className="h-4 w-4" /><span>Du siehst die Plattform als <strong>{access.company}</strong>.</span></span><button type="button" onClick={() => stopImpersonation.mutate()} disabled={stopImpersonation.isPending}>← Zurück zum Admin</button></div>}
      <header className="workspace-top"><button className="menu-button" onClick={() => setSidebarOpen((open) => !open)}><Menu /></button><div className="flex-1" /><div className="top-actions"><AppearanceMenu /><HelpButton /><button type="button" aria-label={showNumbers ? "Zahlen ausblenden" : "Zahlen anzeigen"} title={showNumbers ? "Zahlen ausblenden" : "Zahlen anzeigen"} aria-pressed={showNumbers} onClick={() => setShowNumbers((value) => !value)}>{showNumbers ? <Eye /> : <EyeOff />}</button><span className="top-divider" /><div className="profile-orb" role="button" onClick={() => navigate("Einstellungen")}><div className="text-right"><strong>{access.company}</strong><small>{access.name}{access.email ? ` · ${access.email}` : ""}</small></div><span>{initials}</span></div></div></header>
      <div className="content-area">
        {page === "Dashboard" && <DashboardPage access={access} showNumbers={showNumbers} onOpenLeads={() => navigate("Leads")} />}
        {page === "Leads" && <LeadsPage access={access} showNumbers={showNumbers} />}
        {page === "Bestellungen" && <OrdersPage showNumbers={showNumbers} />}
        {page === "Reklamationen" && <ClaimsPage showNumbers={showNumbers} />}
        {page === "Lead-Import" && <ImportPage />}
        {page === "Integrationen" && <IntegrationsPage />}
        {page === "Support" && <SupportPage access={access} />}
        {page === "Einstellungen" && <SettingsPage access={access} onPassword={() => setPasswordDialogOpen(true)} />}
      </div>
      <AssistantLauncher /><MobileTabBar items={[{ page: "Dashboard" as CustomerPage, label: "Start", icon: LayoutDashboard }, { page: "Leads" as CustomerPage, label: "Leads", icon: ClipboardList }, ...(pages.includes("Bestellungen") ? [{ page: "Bestellungen" as CustomerPage, label: "Bestellungen", icon: PackageCheck }] : []), ...(pages.includes("Support") ? [{ page: "Support" as CustomerPage, label: "Support", icon: LifeBuoy }] : [])]} active={page} onSelect={(next) => navigate(next)} onMenu={() => setSidebarOpen(true)} />
    </main>
  </div>;
}


function Kpi({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-xl border border-white/10 bg-white/[.02] p-4"><span className="text-xs uppercase tracking-[.14em] text-slate-500">{label}</span><strong className="mt-2 block text-3xl text-slate-100">{value}</strong></div>;
}

/* ------------------------------------------------------------------ Dashboard */
function DashboardPage({ access, showNumbers, onOpenLeads }: { access: Access; showNumbers: boolean; onOpenLeads: () => void }) {
  const dashboard = trpc.leadops.customerDashboard.useQuery(undefined, { retry: false });
  const kpis = dashboard.data?.kpis;
  const hidden = "•••";
  return <>
    <header className="page-intro compact"><div><span className="eyebrow">MEIN BEREICH</span><h1>Hallo {access.company}</h1><p>Übersicht deiner Leads und Bestellungen.</p></div></header>
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><Kpi label="Leads diesen Monat" value={kpis ? (showNumbers ? kpis.leadsThisMonth : hidden) : "…"} /><Kpi label="Leads gesamt" value={kpis ? (showNumbers ? kpis.leadsTotal : hidden) : "…"} /><Kpi label="Offene Reklamationen" value={kpis ? (showNumbers ? kpis.openClaims : hidden) : "…"} /><Kpi label="Aktive Bestellungen" value={kpis ? (showNumbers ? kpis.activeOrders : hidden) : "…"} /></div>
    {!showNumbers && <p className="mt-2 text-xs text-slate-500">Zahlen sind ausgeblendet – über das Auge oben rechts einblenden.</p>}
    <section className="surface-panel mt-4 p-5"><div className="flex items-center justify-between"><span className="eyebrow">LETZTE LEADS</span><Button size="sm" variant="outline" onClick={onOpenLeads}>Alle Leads</Button></div>
      {dashboard.isLoading ? <p className="mt-3 text-sm text-slate-400">Wird geladen …</p> : dashboard.error ? <p className="mt-3 text-sm text-red-200">{dashboard.error.message}</p> : !dashboard.data?.recent.length ? <p className="mt-3 text-sm text-slate-400">Noch keine Leads zugewiesen.</p> :
        <ul className="mt-3 divide-y divide-white/6">{dashboard.data.recent.map((lead) => <li key={lead.id} className="flex flex-wrap items-center gap-3 py-2 text-sm"><span className="font-medium text-slate-100">{lead.name}</span><span className="text-xs text-slate-500">{lead.city}</span><Badge variant="outline" className="border-white/15 text-slate-300">{lead.categoryName}</Badge><Badge variant="outline" className={badgeClass(lead.status)}>{leadStatusLabel[lead.status] ?? lead.status}</Badge><span className="ml-auto text-xs text-slate-500">{showNumbers && lead.unitPrice ? `${money(lead.unitPrice)} · ` : ""}{stamp(lead.deliveredAt)}</span></li>)}</ul>}
    </section>
  </>;
}

/* ------------------------------------------------------------------ Leads */
function LeadsPage({ access, showNumbers }: { access: Access; showNumbers: boolean }) {
  const [query, setQuery] = useState("");
  const [claimFor, setClaimFor] = useState<{ id: number; publicId: string } | null>(null);
  const utils = trpc.useUtils();
  const leads = trpc.leadops.customerLeads.useQuery({ query: query || undefined }, { retry: false });
  return <>
    <header className="page-intro compact"><div><span className="eyebrow">MEIN BEREICH</span><h1>Leads</h1><p>{access.partnerType === "lieferant" ? "Alle Leads, die du geliefert hast." : `Alle Leads, die dir zugestellt wurden. Reklamationen sind ${access.reclamationPeriodHours} Stunden nach Zustellung möglich.`}</p></div><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, Ort, E-Mail, Telefon …" className="max-w-xs" /></header>
    {claimFor && <LeadClaimForm leadId={claimFor.id} publicId={claimFor.publicId} onClose={() => setClaimFor(null)} onCreated={() => { setClaimFor(null); utils.leadops.customerLeads.invalidate(); utils.leadops.customerClaims.invalidate(); utils.leadops.customerDashboard.invalidate(); toast.success("Reklamation eingereicht."); }} />}
    <section className="surface-panel lead-panel overflow-hidden">{leads.isLoading ? <p className="p-6 text-sm text-slate-400">Wird geladen …</p> : leads.error ? <p className="p-6 text-sm text-red-200">{leads.error.message}</p> : !leads.data?.length ? <p className="p-6 text-sm text-slate-400">Noch keine Leads zugewiesen.</p> :
      <div className="overflow-x-auto"><table className="flux-table"><thead><tr><th>Lead</th><th>Kontakt</th><th>Kategorie</th><th>Status</th><th>Zugestellt</th>{showNumbers && <th>Preis</th>}<th>Reklamation</th></tr></thead><tbody>{leads.data.map((lead) => <tr key={lead.id}><td><span className="block font-medium text-slate-100">{lead.name}</span><span className="text-xs text-slate-500">{[lead.postcode, lead.city].filter(Boolean).join(" ")} · {lead.publicId}</span></td><td className="text-xs text-slate-300"><span className="block">{lead.phone || "–"}</span><span className="block text-slate-500">{lead.email || "–"}</span></td><td>{lead.categoryName}</td><td><Badge variant="outline" className={badgeClass(lead.status)}>{leadStatusLabel[lead.status] ?? lead.status}</Badge></td><td className="whitespace-nowrap text-xs text-slate-400">{stamp(lead.deliveredAt)}</td>{showNumbers && <td className="whitespace-nowrap">{money(lead.unitPrice)}</td>}<td>{lead.claim ? <Badge variant="outline" className={badgeClass(lead.claim.status)}>{claimStatusLabel[lead.claim.status] ?? lead.claim.status} · {lead.claim.reason}</Badge> : lead.role === "käufer" && !access.uiRestricted ? <Button size="sm" variant="outline" onClick={() => setClaimFor({ id: lead.id, publicId: lead.publicId })}>Reklamieren</Button> : <span className="text-xs text-slate-500">–</span>}</td></tr>)}</tbody></table></div>}</section>
  </>;
}

/* ------------------------------------------------------------------ Bestellungen */
function OrdersPage({ showNumbers }: { showNumbers: boolean }) {
  const orders = trpc.leadops.customerOrders.useQuery(undefined, { retry: false });
  return <>
    <header className="page-intro compact"><div><span className="eyebrow">MEIN BEREICH</span><h1>Bestellungen</h1><p>Deine laufenden und abgeschlossenen Bestellungen mit Lieferfortschritt.</p></div></header>
    <section className="surface-panel lead-panel overflow-hidden">{orders.isLoading ? <p className="p-6 text-sm text-slate-400">Wird geladen …</p> : orders.error ? <p className="p-6 text-sm text-red-200">{orders.error.message}</p> : !orders.data?.length ? <p className="p-6 text-sm text-slate-400">Noch keine Bestellungen.</p> :
      <div className="overflow-x-auto"><table className="flux-table"><thead><tr><th>Bestellung</th><th>Kategorie</th><th>Fortschritt</th>{showNumbers && <th>Preis je Lead</th>}<th>Status</th><th>Angelegt</th></tr></thead><tbody>{orders.data.map((order) => <tr key={order.id}><td><span className="block font-medium text-slate-100">{order.name || order.orderNumber}</span><span className="text-xs text-slate-500">{order.orderNumber}</span></td><td>{order.categoryName}</td><td><span className="font-mono text-sm">{showNumbers ? `${order.deliveredCount} / ${order.quantity}` : "•••"}</span><div className="mt-1 h-1.5 w-32 overflow-hidden rounded-full bg-slate-950/70"><div className="h-full rounded-full bg-violet-400" style={{ width: `${Math.min(100, Math.round((order.deliveredCount / Math.max(1, order.quantity)) * 100))}%` }} /></div></td>{showNumbers && <td>{money(order.unitPrice)}</td>}<td><Badge variant="outline" className={order.status === "aktiv" || order.status === "offen" ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200" : "border-white/15 text-slate-300"}>{order.status}</Badge></td><td className="whitespace-nowrap text-xs text-slate-400">{new Date(order.createdAt).toLocaleDateString("de-DE")}</td></tr>)}</tbody></table></div>}</section>
  </>;
}

/* ------------------------------------------------------------------ Reklamationen */
function ClaimsPage({ showNumbers }: { showNumbers: boolean }) {
  const claims = trpc.leadops.customerClaims.useQuery(undefined, { retry: false });
  return <>
    <header className="page-intro compact"><div><span className="eyebrow">MEIN BEREICH</span><h1>Reklamationen</h1><p>Alle Reklamationen zu deinen Leads und ihr Bearbeitungsstand.</p></div></header>
    <section className="surface-panel lead-panel overflow-hidden">{claims.isLoading ? <p className="p-6 text-sm text-slate-400">Wird geladen …</p> : claims.error ? <p className="p-6 text-sm text-red-200">{claims.error.message}</p> : !claims.data?.length ? <p className="p-6 text-sm text-slate-400">Keine Reklamationen.</p> :
      <div className="overflow-x-auto"><table className="flux-table"><thead><tr><th>Lead</th><th>Grund</th><th>Status</th>{showNumbers && <th>Erstattung</th>}<th>Eingereicht</th><th>Frist</th></tr></thead><tbody>{claims.data.map((claim) => <tr key={claim.id}><td><span className="block font-medium text-slate-100">{claim.leadName}</span><span className="text-xs text-slate-500">{claim.leadPublicId}</span></td><td><span className="block">{claim.reason}</span>{claim.details && <span className="block max-w-md truncate text-xs text-slate-500" title={claim.details}>{claim.details}</span>}</td><td><Badge variant="outline" className={badgeClass(claim.status)}>{claimStatusLabel[claim.status] ?? claim.status}</Badge></td>{showNumbers && <td>{money(claim.refundAmount)}</td>}<td className="whitespace-nowrap text-xs text-slate-400">{stamp(claim.createdAt)}</td><td className="whitespace-nowrap text-xs text-slate-400">{claim.resolvedAt ? `erledigt ${new Date(claim.resolvedAt).toLocaleDateString("de-DE")}` : claim.dueAt ? new Date(claim.dueAt).toLocaleDateString("de-DE") : "–"}</td></tr>)}</tbody></table></div>}</section>
  </>;
}

/* ------------------------------------------------------------------ Lead-Import (Lieferanten) */
function ImportPage() {
  const categories = trpc.leadops.listCategories.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const [form, setForm] = useState({ categoryId: "", firstName: "", lastName: "", phone: "", email: "", postcode: "", city: "" });
  const importLead = trpc.leadops.importLead.useMutation({ onSuccess: (result) => { toast.success(`Lead ${result.publicId} angelegt.`); setForm({ ...form, firstName: "", lastName: "", phone: "", email: "", postcode: "", city: "" }); utils.leadops.customerLeads.invalidate(); utils.leadops.customerDashboard.invalidate(); }, onError: (error) => toast.error(error.message) });
  const categoryId = form.categoryId || String(categories.data?.[0]?.id ?? "");
  return <>
    <header className="page-intro compact"><div><span className="eyebrow">MEIN BEREICH</span><h1>Lead-Import</h1><p>Einzelnen Lead erfassen. Für Massenimporte nutze bitte die API (Zugang über deinen Ansprechpartner).</p></div></header>
    <section className="surface-panel max-w-3xl p-5"><div className="grid gap-3 md:grid-cols-2">
      <label className="grid gap-1 text-xs text-slate-400 md:col-span-2">Lead-Kategorie<select className={field} value={categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}>{(categories.data ?? []).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
      <label className="grid gap-1 text-xs text-slate-400">Vorname<Input value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} /></label>
      <label className="grid gap-1 text-xs text-slate-400">Nachname<Input value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} /></label>
      <label className="grid gap-1 text-xs text-slate-400">Telefon<Input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
      <label className="grid gap-1 text-xs text-slate-400">E-Mail<Input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
      <label className="grid gap-1 text-xs text-slate-400">PLZ<Input value={form.postcode} onChange={(event) => setForm({ ...form, postcode: event.target.value })} /></label>
      <label className="grid gap-1 text-xs text-slate-400">Ort<Input value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} /></label></div>
      <div className="mt-4"><Button className="flux-button" disabled={importLead.isPending || !categoryId || (!form.firstName.trim() && !form.lastName.trim())} onClick={() => importLead.mutate({ categoryId: Number(categoryId), firstName: form.firstName.trim() || undefined, lastName: form.lastName.trim() || undefined, phone: form.phone.trim() || undefined, email: form.email.trim() || undefined, postcode: form.postcode.trim() || undefined, city: form.city.trim() || undefined })}>Lead anlegen</Button></div></section>
  </>;
}

/* ------------------------------------------------------------------ Integrationen */
function IntegrationsPage() {
  const data = trpc.leadops.customerEndpoints.useQuery(undefined, { retry: false });
  return <>
    <header className="page-intro compact"><div><span className="eyebrow">MEIN BEREICH</span><h1>Integrationen</h1><p>So kommen deine Leads bei dir an. Änderungen an Adressen oder Zugangsdaten nimmt dein Ansprechpartner für dich vor.</p></div></header>
    <section className="surface-panel p-5">{data.isLoading ? <p className="text-sm text-slate-400">Wird geladen …</p> : data.error ? <p className="text-sm text-red-200">{data.error.message}</p> : <>
      <span className="eyebrow">AUSGEHENDE API-CALLS</span>
      {!data.data?.endpoints.length ? <p className="mt-2 text-sm text-slate-400">Noch keine Schnittstelle hinterlegt – Leads werden per E-Mail bzw. im Portal bereitgestellt.</p> : <ul className="mt-2 divide-y divide-white/6">{data.data.endpoints.map((endpoint) => <li key={endpoint.id} className="flex flex-wrap items-center gap-3 py-2 text-sm"><Badge variant="outline" className="border-white/15 text-slate-300">{endpoint.categoryName}</Badge><code className="text-xs text-violet-200">{endpoint.method} {endpoint.url}</code><Badge variant="outline" className={endpoint.enabled ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200" : "border-white/15 text-slate-400"}>{endpoint.enabled ? "Aktiv" : "Aus"}</Badge></li>)}</ul>}
      <span className="eyebrow mt-5 block">WEBHOOK</span><p className="mt-1 text-sm text-slate-300">{data.data?.webhookUrl ? <code className="text-xs text-violet-200">{data.data.webhookUrl}</code> : "Keine Webhook-URL hinterlegt."}</p></>}</section>
  </>;
}

/* ------------------------------------------------------------------ Support */
function SupportPage({ access }: { access: Access }) {
  const utils = trpc.useUtils();
  const tickets = trpc.leadops.customerTickets.useQuery(undefined, { retry: false });
  const [subject, setSubject] = useState(""); const [priority, setPriority] = useState<"niedrig" | "normal" | "hoch" | "dringend">("normal");
  const create = trpc.leadops.createTicket.useMutation({ onSuccess: () => { toast.success("Anfrage gesendet."); setSubject(""); utils.leadops.customerTickets.invalidate(); }, onError: (error) => toast.error(error.message) });
  return <>
    <header className="page-intro compact"><div><span className="eyebrow">MEIN BEREICH</span><h1>Support</h1><p>Stell uns eine Frage – wir melden uns so schnell wie möglich.</p></div></header>
    <section className="surface-panel mb-4 max-w-3xl p-5"><div className="grid gap-3 md:grid-cols-[1fr_180px_auto]"><Input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Worum geht es?" /><select className={field} value={priority} onChange={(event) => setPriority(event.target.value as typeof priority)}><option value="niedrig">Niedrig</option><option value="normal">Normal</option><option value="hoch">Hoch</option><option value="dringend">Dringend</option></select><Button className="flux-button" disabled={create.isPending || subject.trim().length < 2} onClick={() => create.mutate({ subject: subject.trim(), requesterName: access.name || access.company, priority })}>Anfrage senden</Button></div></section>
    <section className="surface-panel lead-panel overflow-hidden">{tickets.isLoading ? <p className="p-6 text-sm text-slate-400">Wird geladen …</p> : !tickets.data?.length ? <p className="p-6 text-sm text-slate-400">Noch keine Anfragen.</p> : <div className="overflow-x-auto"><table className="flux-table"><thead><tr><th>Nummer</th><th>Betreff</th><th>Priorität</th><th>Status</th><th>Erstellt</th></tr></thead><tbody>{tickets.data.map((ticket) => <tr key={ticket.id}><td className="font-mono text-xs">{ticket.ticketNumber}</td><td className="text-slate-100">{ticket.subject}</td><td>{ticket.priority}</td><td><Badge variant="outline" className={badgeClass(ticket.status)}>{ticket.status}</Badge></td><td className="whitespace-nowrap text-xs text-slate-400">{stamp(ticket.createdAt)}</td></tr>)}</tbody></table></div>}</section>
  </>;
}

/* ------------------------------------------------------------------ Einstellungen */
function SettingsPage({ access, onPassword }: { access: Access; onPassword: () => void }) {
  return <>
    <header className="page-intro compact"><div><span className="eyebrow">MEIN BEREICH</span><h1>Einstellungen</h1><p>Dein Zugang und deine Stammdaten.</p></div></header>
    <section className="surface-panel max-w-3xl p-5"><span className="eyebrow">KONTO</span><dl className="mt-3 grid gap-3 text-sm md:grid-cols-2"><div><dt className="text-xs text-slate-500">Firma</dt><dd className="text-slate-100">{access.company}</dd></div><div><dt className="text-xs text-slate-500">Name</dt><dd className="text-slate-100">{access.name || "–"}</dd></div><div><dt className="text-xs text-slate-500">E-Mail</dt><dd className="text-slate-100">{access.email || "–"}</dd></div><div><dt className="text-xs text-slate-500">Zugang</dt><dd className="text-slate-100">{access.partnerType === "lieferant" ? "Lieferant" : "Käufer"} · {access.status}</dd></div></dl>
      <p className="mt-4 text-xs text-slate-500">Änderungen an Firma, Rechnungsadresse oder Ansprechpartner nimmt dein Betreuer für dich vor.</p>
      <div className="mt-4"><Button variant="outline" onClick={onPassword}>Passwort ändern</Button></div></section>
  </>;
}
