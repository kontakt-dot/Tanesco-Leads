import AvatarUpload from "@/components/AvatarUpload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { Activity, ArrowLeft, Ban, Bell, Building2, CalendarClock, CreditCard, Euro, Eye, EyeOff, Inbox, KeyRound, LayoutPanelLeft, ListFilter, LogIn, Percent, Plug, ShieldAlert, ShieldCheck, ShoppingCart, Shuffle, Truck, UserRound, Wallet, type LucideIcon } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { roleLabel } from "@/components/MemberDirectory";
import IntegrationTab from "@/components/IntegrationTab";
import { confirmAction } from "@/lib/confirm";
import { categoryColor } from "@/lib/colors";
import { orderStatusLabel } from "../../../shared/order-status";
import { CHOOSABLE_AREAS, CUSTOMER_AREAS } from "../../../shared/customer-areas";
import { activityTone, lastDeliveryText, shortMoney } from "../../../shared/buyer-stats";

type Tab = "stammdaten" | "passwort" | "bestellungen" | "lieferant" | "reklamation" | "zahlung" | "benachrichtigungen" | "aktivitaet" | "ansicht" | "tools";
const TABS: Array<{ key: Tab; label: string; hint: string; icon: LucideIcon }> = [
  { key: "stammdaten", label: "Stammdaten", hint: "Persönliche Daten, Adresse, Verhalten", icon: UserRound },
  { key: "passwort", label: "Passwort", hint: "Passwort zurücksetzen: ein neues Passwort festlegen", icon: KeyRound },
  { key: "bestellungen", label: "Bestellungen", hint: "Aktive, pausierte und beendete Bestellungen", icon: ShoppingCart },
  { key: "lieferant", label: "Lieferant", hint: "Provisionen für gelieferte Leads und Auszahlung", icon: Truck },
  { key: "reklamation", label: "Reklamation", hint: "Frist, Sperren und ausgeschlossene Gründe", icon: ShieldAlert },
  { key: "zahlung", label: "Zahlung", hint: "Abrechnungsart, Intervall und Steuer", icon: CreditCard },
  { key: "benachrichtigungen", label: "Benachrichtigungen", hint: "Welche E-Mails dieser Benutzer bekommt", icon: Bell },
  { key: "aktivitaet", label: "Aktivität", hint: "Was mit diesem Benutzer und seinen Leads passiert ist", icon: Activity },
  { key: "ansicht", label: "Ansicht", hint: "Welche Menüpunkte dieser Kunde sieht", icon: LayoutPanelLeft },
  { key: "tools", label: "Integration", hint: "Schnittstelle, Rückmeldung und Benachrichtigung – alles, was Leads mit diesem Käufer verbindet", icon: Plug },
];
/** Reiter aus der Adresse – unbekannte Angaben (z. B. das frühere „integration“) landen beim passenden oder beim ersten Reiter. */
const tabFromAddress = (): Tab => { const value = new URLSearchParams(window.location.search).get("tab"); return TABS.some((item) => item.key === value) ? (value as Tab) : value === "integration" ? "tools" : "stammdaten"; };
const euro = (value: string | number | null | undefined) => `${Number(value ?? 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const num = (value: number) => value.toLocaleString("de-DE");
const field = "h-10 w-full rounded-md border border-white/10 bg-slate-900 px-3 text-sm text-slate-100";
const generatePassword = () => { const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!$%"; const bytes = new Uint8Array(14); crypto.getRandomValues(bytes); return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join(""); };
/** Kürzel aus Firma oder Name – Rechtsformen zählen nicht mit (wie auf den Karten der Benutzerliste). */
const initialsOf = (text: string | null | undefined) => (text ?? "?").replace(/\b(gmbh|ag|ug|kg|gbr|ohg|e\.?\s?k\.?|mbh)\b/gi, "").trim().split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "?";
/** Schalter als Zeile (v389): links der Schalter, rechts Bezeichnung und ein Satz dazu. */
const Toggle = ({ checked, onChange, label, hint }: { checked: boolean; onChange: (value: boolean) => void; label: string; hint?: string }) => <label className="md-toggle"><input type="checkbox" role="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span><b>{label}</b>{hint && <small>{hint}</small>}</span></label>;
/** Kopf eines Abschnitts (v389): Symbol, Überschrift und ein Satz – statt der Schilder in Großbuchstaben. */
const SectionHead = ({ icon: Icon, title, text, children }: { icon: LucideIcon; title: string; text?: React.ReactNode; children?: React.ReactNode }) => <header className="md-sec"><span className="md-sec-icon" aria-hidden="true"><Icon /></span><div className="md-sec-text"><h2>{title}</h2>{text ? <p>{text}</p> : null}</div>{children ? <div className="md-sec-side">{children}</div> : null}</header>;

export default function MemberDetail({ membershipId, onBack }: { membershipId: number; onBack: () => void }) {
  const utils = trpc.useUtils();
  const detail = trpc.leadops.getMemberDetail.useQuery({ membershipId }, { retry: false });
  const me = trpc.auth.me.useQuery(undefined, { retry: false });
  const [tab, setTab] = useState<Tab>(tabFromAddress);
  /** Reiter wählen – steht auch in der Adresse, damit Neuladen und Links beim selben Reiter landen */
  const selectTab = (key: Tab) => { setTab(key); const params = new URLSearchParams(window.location.search); params.set("tab", key); window.history.replaceState(null, "", `/?${params.toString()}`); };
  const impersonate = trpc.auth.impersonate.useMutation({ onSuccess: async (result) => { window.sessionStorage.setItem("tanesco.impersonationReturn", String(result.membershipId)); await utils.invalidate(); window.location.assign("/?page=Dashboard"); }, onError: (error) => toast.error(error.message) });
  const refresh = () => { utils.leadops.getMemberDetail.invalidate({ membershipId }); utils.leadops.listMembers.invalidate(); };
  const setAvatar = trpc.leadops.setMemberAvatar.useMutation({ onSuccess: (result) => { toast.success(result.avatarUrl ? "Profilbild gespeichert." : "Profilbild entfernt."); refresh(); utils.auth.me.invalidate(); utils.leadops.avatarDirectory.invalidate(); utils.leadops.pipelineOwners.invalidate(); }, onError: (error) => toast.error(error.message) });
  if (detail.error) return <section className="surface-panel p-6 text-sm text-red-200">{detail.error.message} <Button variant="ghost" size="sm" onClick={onBack}>Zurück</Button></section>;
  if (!detail.data) return <section className="surface-panel p-6 text-sm text-slate-400">Benutzer wird geladen…</section>;
  const data = detail.data; const { user, membership, settings } = data;
  const isBuyer = membership.partnerType === "käufer";
  const buyer = data.buyer ?? null;
  // Käufer: die Firma ist der Name, unter dem ihr ihn kennt (wie auf den Karten der Benutzerliste) – Person und E-Mail stehen darunter
  const title = (isBuyer ? user.company || user.name : user.name) ?? user.email ?? "Benutzer";
  const subtitle = (isBuyer ? [user.company && user.name ? user.name : null, user.email] : [user.company, user.email]).filter(Boolean).join(" · ");
  const kind = isBuyer ? "Käufer" : membership.partnerType === "lieferant" ? "Lieferant" : roleLabel(membership.role, membership.partnerType);
  const initials = initialsOf(isBuyer ? title : user.name ?? user.email);
  const active = TABS.find((item) => item.key === tab) ?? TABS[0];
  const last = lastDeliveryText(buyer?.lastDeliveryAt ?? null);
  return <div className="fx-scope md">
    <button type="button" className="md-back" onClick={onBack}><ArrowLeft aria-hidden="true" />Zurück zur Liste</button>
    <section className={`md-hero${isBuyer ? " is-buyer" : ""}`} aria-label={isBuyer ? "Käufer" : "Benutzer"}>
      <span className="md-hero-mark" aria-hidden="true">{initials}</span>
      <div className="md-hero-top">
        <AvatarUpload compact size={88} initials={initials} avatarUrl={(user as { avatarUrl?: string | null }).avatarUrl ?? null} busy={setAvatar.isPending} onPick={(dataUrl) => setAvatar.mutate({ membershipId, dataUrl })} onRemove={() => setAvatar.mutate({ membershipId, dataUrl: null })} />
        <div className="md-hero-who">
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
          <div className="md-chips">
            <span className={`md-state ${membership.status === "aktiv" ? "is-on" : ""}`}>{membership.status === "aktiv" ? "Aktiv" : membership.status === "eingeladen" ? "Eingeladen" : "Inaktiv"}</span>
            <span className="md-chip">{kind}</span>
            {buyer ? <button type="button" className={`md-chip md-chip-plug${buyer.endpoints ? " is-on" : ""}`} title="Reiter „Integration“ öffnen" onClick={() => selectTab("tools")}><Plug aria-hidden="true" />{buyer.endpoints ? `${num(buyer.endpoints)} ${buyer.endpoints === 1 ? "Schnittstelle" : "Schnittstellen"} an` : "Keine Schnittstelle"}</button> : null}
          </div>
        </div>
        {membership.role !== "inhaber" && user.id !== me.data?.id && <div className="md-hero-side"><Button variant="outline" size="sm" onClick={() => impersonate.mutate({ membershipId })}><LogIn /> Als Benutzer einloggen</Button><small>Du siehst die Plattform dann genau wie dieser Benutzer. Zurück geht es über die Leiste am oberen Rand.</small></div>}
      </div>
      {buyer ? <dl className="md-kpis" aria-label="Zahlen des Käufers">
        <Kpi icon={Inbox} label="Leads bekommen" value={num(buyer.delivered)} sub={`${num(buyer.thisMonth)} diesen Monat`} />
        <Kpi icon={Euro} label="Wert geliefert" value={shortMoney(buyer.value)} sub={buyer.delivered ? `Ø ${euro(buyer.averagePrice)} je Lead` : "noch nichts geliefert"} />
        <Kpi icon={ShoppingCart} label="Bestellungen" value={num(buyer.ordersActive)} unit="aktiv" sub={buyer.ordersTotal ? `von ${num(buyer.ordersTotal)}` : "noch keine Bestellung"} />
        <Kpi icon={ShieldAlert} label="Reklamiert" value={num(buyer.claimed)} sub={`${buyer.claimRate} % der Leads`} />
        <Kpi icon={Ban} label="Abgelehnt" value={num(buyer.rejected)} sub="von seiner Schnittstelle" />
      </dl> : null}
      <dl className="md-rail">
        <Fact label="Zahlungsart" value={paymentLabel(settings.paymentMode)} />
        <BalanceCard membershipId={membershipId} balance={settings.prepaidBalance} onDone={refresh} />
        {isBuyer ? <Fact label="Letzte Lieferung" value={last.value} hint={last.hint} /> : <Fact label="Webhook" value={settings.webhookUrl ? "Gesetzt" : "Nicht gesetzt"} hint={settings.webhookUrl ?? "Keine Adresse hinterlegt"} />}
        <Fact label="Reklamationsfrist" value={`${settings.reclamationPeriodHours} Std.`} hint="So lange darf reklamiert werden" />
        <Fact label={isBuyer ? "Kunde seit" : "Registriert am"} value={new Date(membership.createdAt).toLocaleDateString("de-DE")} hint="Konto angelegt" />
      </dl>
    </section>
    <nav className="md-tabs" role="tablist" aria-label="Bereiche des Benutzers">{TABS.map((item) => { const Icon = item.icon; const on = tab === item.key; return <button key={item.key} type="button" role="tab" aria-selected={on} title={item.hint} className={on ? "is-on" : ""} onClick={() => selectTab(item.key)}><Icon aria-hidden="true" /><span>{item.label}</span>{item.key === "bestellungen" && data.orders.length > 0 && <em>{data.orders.length}</em>}</button>; })}</nav>
    <p className="md-tab-hint">{active.hint}</p>
    {tab === "stammdaten" && <ProfileTab data={data} onDone={refresh} />}
    {tab === "passwort" && <PasswordTab membershipId={membershipId} />}
    {tab === "bestellungen" && <OrdersTab orders={data.orders} categories={data.categories} />}
    {tab === "lieferant" && <SupplierTab data={data} onDone={refresh} />}
    {tab === "reklamation" && <ClaimTab data={data} onDone={refresh} />}
    {tab === "zahlung" && <BillingTab data={data} onDone={refresh} />}
    {tab === "benachrichtigungen" && <NotificationTab data={data} onDone={refresh} />}
    {tab === "aktivitaet" && <ActivityTab membershipId={membershipId} />}
    {tab === "ansicht" && <VisibilityTab data={data} onDone={refresh} />}
    {tab === "tools" && <IntegrationTab membershipId={membershipId} webhookUrl={settings.webhookUrl} />}
  </div>;
}

type Detail = inferRouterOutputs<AppRouter>["leadops"]["getMemberDetail"];
const paymentLabel = (mode: string) => ({ standard: "Standard", vorkasse: "Guthaben (Vorkasse)", auf_rechnung: "Auf Rechnung", gesperrt: "Gesperrt", karte_pro_lead: "Kreditkarte pro Lead", sepa_pro_lead: "SEPA-Lastschrift pro Lead" } as Record<string, string>)[mode] ?? mode;
/** Eine Angabe in der Leiste unter dem Kopf: Bezeichnung, Wert, darunter leise der Zusatz. */
const Fact = ({ label, value, hint }: { label: string; value: string; hint?: string }) => <div><dt>{label}</dt><dd title={hint ?? value}>{value}</dd>{hint && <small title={hint}>{hint}</small>}</div>;
/** Eine Zahl im Kopf des Käufers (v389): Bezeichnung mit Symbol, große Zahl, darunter ein kurzer Zusatz. */
const Kpi = ({ icon: Icon, label, value, unit, sub }: { icon: LucideIcon; label: string; value: string; unit?: string; sub: string }) => <div><dt><Icon aria-hidden="true" />{label}</dt><dd><b>{value}</b>{unit ? <small>{unit}</small> : null}<em>{sub}</em></dd></div>;

function BalanceCard({ membershipId, balance, onDone }: { membershipId: number; balance: string; onDone: () => void }) {
  const [mode, setMode] = useState<"aufladung" | "abbuchung" | null>(null); const [amount, setAmount] = useState(""); const [description, setDescription] = useState("");
  const adjust = trpc.leadops.adjustMemberBalance.useMutation({ onSuccess: () => { toast.success("Guthaben angepasst."); setMode(null); setAmount(""); setDescription(""); onDone(); }, onError: (error) => toast.error(error.message) });
  return <div><dt>Guthaben</dt><dd>{euro(balance)}</dd><span className="md-rail-links"><button type="button" onClick={() => setMode("aufladung")}>Aufladen</button><button type="button" onClick={() => setMode("abbuchung")}>Abbuchen</button></span>
    {mode && <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4" onClick={() => setMode(null)}><section className="surface-panel w-full max-w-sm p-6" onClick={(event) => event.stopPropagation()}><span className="eyebrow">GUTHABEN</span><h2 className="mt-1 text-lg text-slate-100">{mode === "aufladung" ? "Aufladen" : "Abbuchen"} — Guthaben anpassen</h2><form className="mt-4 grid gap-3" onSubmit={(event) => { event.preventDefault(); adjust.mutate({ membershipId, kind: mode, amount: Number(amount.replace(",", ".")), description }); }}><label className="text-xs text-slate-300">Betrag<Input value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0,00" required /></label><label className="text-xs text-slate-300">Verwendungszweck<Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="z.B. „Überweisung 26.05.2026, Kundenref. ABC-123“" /></label><div className="flex justify-end gap-2"><Button type="button" variant="ghost" size="sm" onClick={() => setMode(null)}>Schließen</Button><Button className="flux-button" size="sm" type="submit" disabled={adjust.isPending}>{mode === "aufladung" ? "Aufladen" : "Abbuchen"}</Button></div></form></section></div>}
  </div>;
}

/** Stammdaten (v389): drei Karten – Person, Rechnungsadresse, Zugang & Schutz – und unten eine Leiste zum Speichern. */
function ProfileTab({ data, onDone }: { data: Detail; onDone: () => void }) {
  const { user, membership, settings } = data;
  const kind = membership.role === "admin" || membership.role === "inhaber" ? "admin" : membership.role === "vertrieb" && membership.partnerType === "intern" ? "vertriebler" : "benutzer";
  const [form, setForm] = useState({ salutation: user.salutation ?? "", firstName: user.firstName ?? (user.name ?? "").split(" ")[0] ?? "", lastName: user.lastName ?? (user.name ?? "").split(" ").slice(1).join(" "), company: user.company ?? "", phone: user.phone ?? "", billingStreet: user.billingStreet ?? "", billingPostalCode: user.billingPostalCode ?? "", billingCity: user.billingCity ?? "", billingCountry: user.billingCountry ?? "DE", kind: kind as "benutzer" | "admin" | "vertriebler", active: membership.status === "aktiv", duplicateProtection: settings.duplicateProtection, inboundPrePing: settings.inboundPrePing });
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const save = trpc.leadops.updateMemberProfile.useMutation({ onSuccess: () => { toast.success("Stammdaten gespeichert."); onDone(); }, onError: (error) => toast.error(error.message) });
  const [passwordOpen, setPasswordOpen] = useState(false);
  // „Eingehendes PrePing“ betrifft nur Konten, die Leads liefern – bei reinen Käufern bleibt der Wert, wie er ist
  const supplies = membership.partnerType === "lieferant" || settings.supplierActive;
  return <div className="md-stack">
    <section className="surface-panel operations-panel md-card" aria-label="Person">
      <SectionHead icon={UserRound} title="Person" text="Name, Firma und wie ihr ihn erreicht." />
      <div className="md-grid">
        <label className="text-xs text-slate-300">Anrede<select className={field} value={form.salutation} onChange={set("salutation")}><option value="">— Keine —</option><option>Herr</option><option>Frau</option><option>Divers</option></select></label>
        <label className="text-xs text-slate-300">E-Mail<Input value={user.email ?? ""} readOnly className="opacity-70" /><span className="mt-1 block text-[11px] text-slate-500">Die E-Mail-Adresse kann nach der Anlage nicht mehr geändert werden.</span></label>
        <label className="text-xs text-slate-300">Vorname<Input value={form.firstName} onChange={set("firstName")} /></label>
        <label className="text-xs text-slate-300">Nachname<Input value={form.lastName} onChange={set("lastName")} /></label>
        <label className="text-xs text-slate-300">Firma<Input value={form.company} onChange={set("company")} /></label>
        <label className="text-xs text-slate-300">Telefon<Input type="tel" value={form.phone} onChange={set("phone")} /></label>
      </div>
    </section>
    <section className="surface-panel operations-panel md-card" aria-label="Rechnungsadresse">
      <SectionHead icon={Building2} title="Rechnungsadresse" text="Steht auf seinen Rechnungen." />
      <div className="md-grid">
        <label className="text-xs text-slate-300 md-wide">Straße + Hausnummer<Input value={form.billingStreet} onChange={set("billingStreet")} /></label>
        <label className="text-xs text-slate-300">PLZ<Input value={form.billingPostalCode} onChange={set("billingPostalCode")} /></label>
        <label className="text-xs text-slate-300">Stadt<Input value={form.billingCity} onChange={set("billingCity")} /></label>
        <label className="text-xs text-slate-300">Land<select className={field} value={form.billingCountry} onChange={set("billingCountry")}>{["DE", "AT", "CH", "US", "CA", "AU", "TR"].map((code) => <option key={code} value={code}>{code}</option>)}</select></label>
      </div>
    </section>
    <section className="surface-panel operations-panel md-card" aria-label="Zugang und Schutz">
      <SectionHead icon={ShieldCheck} title="Zugang & Schutz" text="Rolle, Anmeldung und Schutz vor doppelten Leads." />
      <div className="md-grid">
        <label className="text-xs text-slate-300">Rolle<select className={field} value={form.kind} onChange={set("kind")} disabled={membership.role === "inhaber"}><option value="benutzer">Benutzer</option><option value="admin">Admin</option><option value="vertriebler">Vertriebler (Pipeline &amp; Haustür)</option></select></label>
      </div>
      <div className="md-switches">
        <Toggle checked={form.active} onChange={(value) => setForm((current) => ({ ...current, active: value }))} label="Aktiv" hint="Inaktive Benutzer können sich nicht einloggen." />
        <Toggle checked={form.duplicateProtection} onChange={(value) => setForm((current) => ({ ...current, duplicateProtection: value }))} label="Duplikat-Schutz" hint="Verhindert, dass derselbe Kontakt (Name + Telefon/E-Mail) zweimal zugewiesen wird." />
        {supplies ? <Toggle checked={form.inboundPrePing} onChange={(value) => setForm((current) => ({ ...current, inboundPrePing: value }))} label="Eingehendes PrePing" hint="Wenn aus, ist dieser Lieferant vom eingehenden PrePing ausgenommen — seine doppelten Importe werden NICHT mit 409 abgelehnt. Standard: an." /> : null}
      </div>
    </section>
    <div className="md-savebar"><Button variant="outline" size="sm" onClick={() => setPasswordOpen(true)}>Passwort neu setzen</Button><Button className="flux-button" onClick={() => save.mutate({ membershipId: membership.id, ...form, salutation: form.salutation || null, company: form.company || null, phone: form.phone || null, billingStreet: form.billingStreet || null, billingPostalCode: form.billingPostalCode || null, billingCity: form.billingCity || null, billingCountry: form.billingCountry || null })} disabled={save.isPending}>Speichern</Button></div>
    {passwordOpen && <PasswordDialogInline membershipId={membership.id} onClose={() => setPasswordOpen(false)} />}
  </div>;
}

function PasswordDialogInline({ membershipId, onClose }: { membershipId: number; onClose: () => void }) {
  const [password, setPassword] = useState(""); const [show, setShow] = useState(false);
  const set = trpc.leadops.setMemberPassword.useMutation({ onSuccess: () => { toast.success("Passwort gesetzt."); onClose(); }, onError: (error) => toast.error(error.message) });
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4" onClick={onClose}><section className="surface-panel w-full max-w-sm p-6" onClick={(event) => event.stopPropagation()}><h2 className="text-lg text-slate-100">Passwort neu setzen</h2><p className="mt-1 text-xs text-slate-400">Lege ein neues Passwort fest. Gib es dem Benutzer auf einem sicheren Kanal weiter.</p><div className="mt-4 flex gap-1"><Input type="password" reveal={show} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Neues Passwort" /><Button variant="outline" size="sm" onClick={() => setShow((value) => !value)}>{show ? <EyeOff /> : <Eye />}</Button></div><div className="mt-2 flex flex-wrap justify-between gap-2"><Button variant="outline" size="sm" onClick={() => { setPassword(generatePassword()); setShow(true); }}>Passwort generieren</Button><div className="flex gap-2"><Button variant="ghost" size="sm" onClick={onClose}>Abbrechen</Button><Button className="flux-button" size="sm" onClick={() => set.mutate({ membershipId, password })} disabled={set.isPending}>Passwort setzen</Button></div></div></section></div>;
}

function PasswordTab({ membershipId }: { membershipId: number }) {
  const [password, setPassword] = useState(""); const [show, setShow] = useState(false);
  const set = trpc.leadops.setMemberPassword.useMutation({ onSuccess: () => { toast.success("Passwort gesetzt."); setPassword(""); }, onError: (error) => toast.error(error.message) });
  return <section className="surface-panel operations-panel md-card max-w-xl"><SectionHead icon={KeyRound} title="Neues Passwort" text="Neues Passwort für diesen Benutzer festlegen (min. 10 Zeichen, Buchstaben und eine Ziffer)." /><div className="flex gap-1"><Input type="password" reveal={show} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Neues Passwort" /><Button variant="outline" size="sm" onClick={() => setShow((value) => !value)}>{show ? <EyeOff /> : <Eye />}</Button><Button variant="outline" size="sm" onClick={() => { setPassword(generatePassword()); setShow(true); }}>Passwort generieren</Button></div><p className="mt-3 text-xs text-slate-500">Ein E-Mail-Versand der Zugangsdaten ist noch nicht angebunden — Passwort bitte auf einem sicheren Kanal weitergeben.</p><div className="mt-4 flex justify-end"><Button className="flux-button" size="sm" onClick={() => set.mutate({ membershipId, password })} disabled={set.isPending || !password}>Passwort setzen</Button></div></section>;
}

/** Bestellungen des Käufers (v389) als Karten: Kategorie, Name, Status, Lieferfortschritt, Preis und Wert – ein Klick öffnet die Bestellung. */
function OrdersTab({ orders, categories }: { orders: Detail["orders"]; categories: Detail["categories"] }) {
  if (!orders.length) return <section className="surface-panel operations-panel md-card md-empty"><ShoppingCart aria-hidden="true" /><strong>Keine Bestellungen</strong><span>Für diesen Käufer wurde noch keine Bestellung angelegt.</span></section>;
  return <section className="md-orders" aria-label="Bestellungen">{orders.map((order) => {
    const category = categories.find((item) => item.id === order.categoryId); const label = orderStatusLabel(order.status, order.active);
    const tone = label === "Aktiv" ? "aktiv" : label === "Erfüllt" ? "erfuellt" : label === "Storniert" ? "storniert" : "inaktiv";
    const delivered = Number(order.deliveredCount) || 0; const quantity = Number(order.quantity) || 0; const share = quantity ? Math.min(100, Math.round((delivered * 100) / quantity)) : null;
    return <a key={order.id} className={`md-order is-${tone}`} href={`/?page=Bestellungen&orderId=${order.id}`} aria-label={`Bestellung ${order.name || order.orderNumber} öffnen`}>
      <header><span className="md-order-cat" style={{ ["--cat" as string]: categoryColor(category ? { id: category.id, color: (category as { color?: string | null }).color ?? null } : null) } as React.CSSProperties}>{category?.shortcode ?? `#${order.categoryId}`}</span><span className="md-order-name"><b>{order.name || order.orderNumber}</b><small>{order.orderNumber}</small></span><span className={`md-order-state is-${tone}`}>{label}</span></header>
      <div className="md-order-progress"><div><b>{num(delivered)}</b><span>{quantity ? ` / ${num(quantity)} geliefert` : " geliefert · ohne Obergrenze"}</span>{share !== null ? <em>{share} %</em> : null}</div>{share !== null ? <span className="md-order-bar" aria-hidden="true"><i style={{ width: `${share}%` }} /></span> : null}</div>
      <dl><div><dt>Preis</dt><dd>{euro(order.unitPrice)} je Lead</dd></div><div><dt>Wert</dt><dd>{euro(delivered * Number(order.unitPrice ?? 0))}</dd></div><div><dt>Auslieferung</dt><dd>in Echtzeit</dd></div><div><dt>Angelegt</dt><dd>{new Date(order.createdAt).toLocaleDateString("de-DE")}</dd></div></dl>
    </a>; })}</section>;
}

function SupplierTab({ data, onDone }: { data: Detail; onDone: () => void }) {
  const utils = trpc.useUtils(); const membershipId = data.membership.id; const { settings } = data;
  const rates = (settings.commissionRates ?? {}) as Record<string, { type: "keine" | "fix" | "prozent"; value: number }>;
  const [form, setForm] = useState({ supplierActive: settings.supplierActive, commissionOnEverySale: settings.commissionOnEverySale, rates: Object.fromEntries(data.categories.map((category) => [String(category.id), rates[String(category.id)] ?? { type: "keine", value: 0 }])) as Record<string, { type: "keine" | "fix" | "prozent"; value: number }> });
  const save = trpc.leadops.updateSupplierSettings.useMutation({ onSuccess: () => { toast.success("Lieferanten-Einstellungen gespeichert."); onDone(); }, onError: (error) => toast.error(error.message) });
  const [token, setToken] = useState<string | null>(null);
  const reveal = async () => { try { const result = await utils.leadops.revealSupplierToken.fetch({ membershipId }); setToken(result.token ?? ""); if (!result.token) toast.error("Noch kein Token vorhanden — bitte erst erzeugen."); } catch (error) { toast.error(error instanceof Error ? error.message : "Fehler"); } };
  const issue = trpc.leadops.issueSupplierToken.useMutation({ onSuccess: (result) => { setToken(result.token); toast.success("Neuer Token erzeugt. Der alte ist ungültig."); onDone(); }, onError: (error) => toast.error(error.message) });
  const copy = async (value: string) => { try { await navigator.clipboard.writeText(value); toast.success("Kopiert."); } catch { toast.error("Kopieren nicht möglich."); } };
  const [payout, setPayout] = useState(""); const [payoutNote, setPayoutNote] = useState("");
  const adjust = trpc.leadops.adjustMemberBalance.useMutation({ onSuccess: () => { toast.success("Auszahlung verbucht."); setPayout(""); onDone(); }, onError: (error) => toast.error(error.message) });
  const [range, setRange] = useState(() => { const to = new Date(); const from = new Date(to.getFullYear(), to.getMonth(), 1); return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }; });
  const [applied, setApplied] = useState(range);
  const commissions = trpc.leadops.listSupplierCommissions.useQuery({ membershipId, from: new Date(`${applied.from}T00:00:00`).toISOString(), to: new Date(`${applied.to}T23:59:59`).toISOString() }, { retry: false, enabled: Boolean(data.supplier) });
  const quick = (label: string) => { const to = new Date(); let from = new Date(); if (label === "Dieser Monat") from = new Date(to.getFullYear(), to.getMonth(), 1); else if (label === "Letzter Monat") { from = new Date(to.getFullYear(), to.getMonth() - 1, 1); to.setDate(0); } else if (label === "Letzte 7 Tage") from.setDate(to.getDate() - 7); else if (label === "Letzte 14 Tage") from.setDate(to.getDate() - 14); else from = new Date("2020-01-01"); const next = { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }; setRange(next); setApplied(next); };
  const endpoint = `${window.location.origin}/api/v1/leads`;
  const mappingsOf = (kind: "kategorie" | "feld" | "wert", categoryId?: number) => data.mappings.filter((row) => row.kind === kind && (kind !== "wert" || row.categoryId === categoryId));
  return <div className="md-stack">
    <section className="surface-panel operations-panel md-card"><SectionHead icon={Percent} title="Provision je Lead" text="Lege pro Kategorie fest, was dieser Lieferant je Lead bekommt. Der Lieferant sieht die Sätze nur lesend." />
      <div className="md-switches"><Toggle checked={form.supplierActive} onChange={(value) => setForm((current) => ({ ...current, supplierActive: value }))} label="Als Lieferant aktiv" hint="Macht diesen Nutzer kategorieübergreifend als Lieferant auswählbar, z. B. um ihn aus einer Kette auszuschließen — schon vor seinem ersten Import." /><Toggle checked={form.commissionOnEverySale} onChange={(value) => setForm((current) => ({ ...current, commissionOnEverySale: value }))} label="Provision bei jedem Verkauf" hint="Aus: nur beim Erstverkauf eines Mehrfach-Leads. An: bei jedem Verkauf." /></div>
      <div className="mt-3 grid gap-2">{data.categories.map((category) => { const rate = form.rates[String(category.id)]; return <div key={category.id} className="md-rate"><span className="text-sm text-slate-200">{category.name} <span className="text-xs text-slate-500">{category.shortcode}</span></span><select className={field} value={rate.type} onChange={(event) => setForm((current) => ({ ...current, rates: { ...current.rates, [category.id]: { ...rate, type: event.target.value as typeof rate.type } } }))}><option value="keine">Keine</option><option value="fix">Fixbetrag</option><option value="prozent">Prozent</option></select><Input type="number" step="0.01" value={rate.value} onChange={(event) => setForm((current) => ({ ...current, rates: { ...current.rates, [category.id]: { ...rate, value: Number(event.target.value) } } }))} disabled={rate.type === "keine"} /></div>; })}</div>
      <div className="mt-4 flex justify-end"><Button className="flux-button" size="sm" onClick={() => save.mutate({ membershipId, supplierActive: form.supplierActive, commissionOnEverySale: form.commissionOnEverySale, commissionRates: form.rates })} disabled={save.isPending}>Speichern</Button></div>
      {data.supplier && <p className="mt-2 text-xs text-slate-500">Verknüpfter Lieferant: {data.supplier.name} ({data.supplier.status})</p>}
    </section>
    <section className="surface-panel operations-panel md-card"><div className="grid gap-6 md:grid-cols-2"><div><SectionHead icon={Wallet} title="Guthaben & Auszahlung" text="Aktuelles Lieferanten-Guthaben. Auszahlung per Rechnung manuell verbuchen." /><div className="md-big">{euro(settings.supplierBalance)}</div><div className="mt-2 flex gap-1"><Input value={payout} onChange={(event) => setPayout(event.target.value)} placeholder="Betrag" className="max-w-[140px]" /><Input value={payoutNote} onChange={(event) => setPayoutNote(event.target.value)} placeholder="Verwendungszweck" /><Button size="sm" variant="outline" disabled={Number(settings.supplierBalance) <= 0 || adjust.isPending} onClick={() => adjust.mutate({ membershipId, kind: "auszahlung", amount: Number(payout.replace(",", ".")), description: payoutNote })}>Auszahlung verbuchen</Button></div></div>
      <div><SectionHead icon={KeyRound} title="Zugang zum Einliefern" text="Adresse und API-Token für seine Importe. Max. 120 Importe pro Minute. Bei Verdacht auf Leak: Token rotieren." /><div className="flex items-center gap-2 text-sm text-slate-100"><code className="rounded bg-black/30 px-2 py-1 text-xs">POST {endpoint}</code><Button size="sm" variant="ghost" onClick={() => copy(endpoint)}>Kopieren</Button></div><div className="mt-3 flex flex-wrap items-center gap-2"><code className="rounded bg-black/30 px-2 py-1 text-xs">{token ?? (data.token ? "fx_••••••••••••••••••••••••" : "Noch kein Token")}</code><Button size="sm" variant="ghost" onClick={reveal} disabled={!data.token}>Anzeigen</Button><Button size="sm" variant="ghost" onClick={() => token && copy(token)} disabled={!token}>Kopieren</Button><Button size="sm" variant="outline" onClick={async () => { if (await confirmAction(data.token ? "Token rotieren? Der bisherige Token wird sofort ungültig." : "Token erzeugen?")) issue.mutate({ membershipId }); }}>{data.token ? "Rotieren" : "Token erzeugen"}</Button></div></div></div></section>
    <section className="surface-panel operations-panel md-card"><SectionHead icon={Euro} title="Provisionen pro Kontakt" text="Welche importierten Kontakte welche Provision ausgelöst haben — pro Zeitraum." /><div className="flex flex-wrap items-center gap-2">{["Dieser Monat", "Letzter Monat", "Letzte 7 Tage", "Letzte 14 Tage", "Gesamt"].map((label) => <Button key={label} size="sm" variant="ghost" onClick={() => quick(label)}>{label}</Button>)}<Input type="date" value={range.from} onChange={(event) => setRange((current) => ({ ...current, from: event.target.value }))} className="max-w-[160px]" /><Input type="date" value={range.to} onChange={(event) => setRange((current) => ({ ...current, to: event.target.value }))} className="max-w-[160px]" /><Button size="sm" variant="outline" onClick={() => setApplied(range)}>Anwenden</Button></div>
      {commissions.data?.rows.length ? <div className="table-wrap mt-3"><table className="flux-table"><thead><tr><th>Lead</th><th>Käufer</th><th>Verkaufspreis</th><th>Provision</th><th>Datum</th></tr></thead><tbody>{commissions.data.rows.map((row) => <tr key={`${row.leadId}-${row.occurredAt}`}><td className="font-mono text-xs text-violet-200">{row.publicId}</td><td>{row.buyerName}</td><td>{euro(row.unitPrice)}</td><td>{euro(row.commission)}</td><td>{new Date(row.occurredAt).toLocaleString("de-DE")}</td></tr>)}<tr><td colSpan={3} className="text-right text-slate-300">Gesamt</td><td className="text-slate-100">{euro(commissions.data.total)}</td><td /></tr></tbody></table></div> : <p className="mt-3 text-sm text-slate-500">Keine Provisionen in diesem Zeitraum.</p>}
    </section>
    <MappingEditor icon={ListFilter} title="Lead-Kategorien des Lieferanten" intro="Wenn der Lieferant eine eigene Kategorien-Bezeichnung sendet (z. B. „PV-WP“), ordne sie hier einer deiner Lead-Kategorien zu. Ohne Zuordnung wird der Lead mit „Lead type not found“ abgelehnt." empty="Noch keine Zuordnung — der Lieferant muss unser Kürzel senden." sourceLabel="Sendet der Lieferant (lead_type_id)" sourcePlaceholder="z. B. PV-WP" targetLabel="Unsere Lead-Kategorie" targetOptions={data.categories.map((category) => ({ value: String(category.id), label: `${category.name} (${category.shortcode})` }))} rows={mappingsOf("kategorie")} onSave={(rows) => utils.client.leadops.saveSupplierInboundMappings.mutate({ membershipId, kind: "kategorie", rows: rows.map((row) => ({ kind: "kategorie", sourceValue: row.sourceValue, targetValue: row.targetValue })) }).then(() => { toast.success("Kategorie-Mapping gespeichert."); onDone(); }).catch((error: Error) => toast.error(error.message))} />
    <MappingEditor icon={Shuffle} title="Feldnamen des Lieferanten" intro="Wenn der Lieferant ein Feld unter einem anderen Namen sendet (z. B. „Lead-ID“ statt „lead_id“), ordne den Namen hier einem deiner Zusatzfelder zu. Das Zusatzfeld muss in der Kategorie angelegt sein, sonst bleibt der Wert unbeachtet." empty="Noch keine Zuordnung — Feldnamen müssen exakt so ankommen, wie das Zusatzfeld heißt." sourceLabel="Sendet der Lieferant (Feldname)" sourcePlaceholder="z. B. Lead-ID" targetLabel="Unser Zusatzfeld (Schlüssel)" targetPlaceholder="z. B. lead_id" rows={mappingsOf("feld")} onSave={(rows) => utils.client.leadops.saveSupplierInboundMappings.mutate({ membershipId, kind: "feld", rows: rows.map((row) => ({ kind: "feld", sourceValue: row.sourceValue, targetValue: row.targetValue })) }).then(() => { toast.success("Feld-Mapping gespeichert."); onDone(); }).catch((error: Error) => toast.error(error.message))} />
    <ValueMappingEditor data={data} onDone={onDone} />
  </div>;
}

function MappingEditor({ icon, title, intro, empty, sourceLabel, sourcePlaceholder, targetLabel, targetOptions, targetPlaceholder, rows, onSave }: { icon: LucideIcon; title: string; intro: string; empty: string; sourceLabel: string; sourcePlaceholder: string; targetLabel: string; targetOptions?: Array<{ value: string; label: string }>; targetPlaceholder?: string; rows: Array<{ sourceValue: string; targetValue: string }>; onSave: (rows: Array<{ sourceValue: string; targetValue: string }>) => void }) {
  const [draft, setDraft] = useState(rows.map((row) => ({ sourceValue: row.sourceValue, targetValue: row.targetValue })));
  useEffect(() => { setDraft(rows.map((row) => ({ sourceValue: row.sourceValue, targetValue: row.targetValue }))); }, [rows]);
  return <section className="surface-panel operations-panel md-card"><SectionHead icon={icon} title={title} text={intro} />
    {draft.length ? <div className="grid gap-2">{draft.map((row, index) => <div key={index} className="grid items-center gap-2 md:grid-cols-[1fr_24px_1fr_auto]"><Input value={row.sourceValue} placeholder={sourcePlaceholder} aria-label={sourceLabel} onChange={(event) => setDraft((current) => current.map((item, i) => i === index ? { ...item, sourceValue: event.target.value } : item))} /><span className="text-center text-slate-500">→</span>{targetOptions ? <select className={field} value={row.targetValue} onChange={(event) => setDraft((current) => current.map((item, i) => i === index ? { ...item, targetValue: event.target.value } : item))}><option value="">{targetLabel} wählen …</option>{targetOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <Input value={row.targetValue} placeholder={targetPlaceholder} aria-label={targetLabel} onChange={(event) => setDraft((current) => current.map((item, i) => i === index ? { ...item, targetValue: event.target.value } : item))} />}<Button size="sm" variant="ghost" onClick={() => setDraft((current) => current.filter((_, i) => i !== index))}>Entfernen</Button></div>)}</div> : <p className="text-sm text-slate-500">{empty}</p>}
    <div className="mt-3 flex justify-between"><Button size="sm" variant="outline" onClick={() => setDraft((current) => [...current, { sourceValue: "", targetValue: "" }])}>Zuordnung hinzufügen</Button><Button className="flux-button" size="sm" onClick={() => onSave(draft)}>Speichern</Button></div>
  </section>;
}

function ValueMappingEditor({ data, onDone }: { data: Detail; onDone: () => void }) {
  const utils = trpc.useUtils(); const membershipId = data.membership.id;
  const [categoryId, setCategoryId] = useState<number>(data.categories[0]?.id ?? 0);
  const fields = trpc.leadops.listCategoryFields.useQuery({ categoryId }, { retry: false, enabled: categoryId > 0 });
  const existing = data.mappings.filter((row) => row.kind === "wert" && row.categoryId === categoryId);
  const [draft, setDraft] = useState<Array<{ fieldKey: string; sourceValue: string; targetValue: string; strict: boolean }>>([]);
  useEffect(() => { setDraft(existing.map((row) => ({ fieldKey: row.fieldKey ?? "", sourceValue: row.sourceValue, targetValue: row.targetValue, strict: row.strict }))); }, [categoryId, data.mappings.length]);
  const strictOf = (fieldKey: string) => draft.some((row) => row.fieldKey === fieldKey && row.strict);
  const save = () => utils.client.leadops.saveSupplierInboundMappings.mutate({ membershipId, kind: "wert", categoryId, rows: draft.filter((row) => row.fieldKey).map((row) => ({ kind: "wert", categoryId, fieldKey: row.fieldKey, sourceValue: row.sourceValue, targetValue: row.targetValue, strict: row.strict })) }).then(() => { toast.success("Wert-Mapping gespeichert."); onDone(); }).catch((error: Error) => toast.error(error.message));
  return <section className="surface-panel operations-panel md-card"><SectionHead icon={Shuffle} title="Werte des Lieferanten übersetzen" text="Eingangswerte dieses Lieferanten in einheitliche Werte übersetzen (z. B. Meta-Schreibweise → kanonischer Wert). „Strikt“ lehnt unbekannte Werte ab (Verlaufseintrag „Verworfen beim Import“)." />
    <select className={`${field} max-w-md`} value={categoryId} onChange={(event) => setCategoryId(Number(event.target.value))}>{data.categories.map((category) => <option key={category.id} value={category.id}>{category.name} ({category.shortcode})</option>)}</select>
    <div className="mt-3 grid gap-3">{(fields.data ?? []).map((fieldDef) => { const rows = draft.map((row, index) => ({ row, index })).filter(({ row }) => row.fieldKey === fieldDef.fieldKey); return <div key={fieldDef.id} className="md-box"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm text-slate-200">{fieldDef.label} <span className="text-xs text-slate-500">{fieldDef.fieldKey}</span></span><div className="flex items-center gap-2"><label className="flex items-center gap-1 text-xs text-slate-300"><input type="checkbox" checked={strictOf(fieldDef.fieldKey)} onChange={(event) => setDraft((current) => { const next = current.map((row) => row.fieldKey === fieldDef.fieldKey ? { ...row, strict: event.target.checked } : row); return next.some((row) => row.fieldKey === fieldDef.fieldKey) ? next : [...next, { fieldKey: fieldDef.fieldKey, sourceValue: "", targetValue: "", strict: event.target.checked }]; })} /> Strikt (ablehnen)</label><Button size="sm" variant="ghost" onClick={() => setDraft((current) => [...current, { fieldKey: fieldDef.fieldKey, sourceValue: "", targetValue: "", strict: strictOf(fieldDef.fieldKey) }])}>+ Mapping</Button></div></div>{rows.map(({ row, index }) => <div key={index} className="mt-2 grid items-center gap-2 md:grid-cols-[1fr_24px_1fr_auto]"><Input value={row.sourceValue} placeholder="Eingangswert" onChange={(event) => setDraft((current) => current.map((item, i) => i === index ? { ...item, sourceValue: event.target.value } : item))} /><span className="text-center text-slate-500">→</span>{Array.isArray(fieldDef.options) && (fieldDef.options as unknown[]).length ? <select className={field} value={row.targetValue} onChange={(event) => setDraft((current) => current.map((item, i) => i === index ? { ...item, targetValue: event.target.value } : item))}><option value="">Kanonisch wählen …</option>{(fieldDef.options as unknown[]).map((option) => <option key={String(option)} value={String(option)}>{String(option)}</option>)}</select> : <Input value={row.targetValue} placeholder="Kanonisch" onChange={(event) => setDraft((current) => current.map((item, i) => i === index ? { ...item, targetValue: event.target.value } : item))} />}<Button size="sm" variant="ghost" onClick={() => setDraft((current) => current.filter((_, i) => i !== index))}>Entfernen</Button></div>)}</div>; })}</div>
    {!fields.data?.length && <p className="mt-3 text-sm text-slate-500">Diese Kategorie hat keine Zusatzfelder.</p>}
    <div className="mt-3 flex justify-end"><Button className="flux-button" size="sm" onClick={save}>Speichern</Button></div>
  </section>;
}

function ClaimTab({ data, onDone }: { data: Detail; onDone: () => void }) {
  const { settings, membership } = data;
  const [hours, setHours] = useState(settings.reclamationPeriodHours); const [autoAccept, setAutoAccept] = useState(settings.autoAcceptApiClaims);
  const [blocked, setBlocked] = useState<number[]>(Array.isArray(settings.blockedClaimCategoryIds) ? (settings.blockedClaimCategoryIds as number[]) : []);
  const [excluded, setExcluded] = useState<number[]>(Array.isArray(settings.excludedClaimReasonIds) ? (settings.excludedClaimReasonIds as number[]) : []);
  const save = trpc.leadops.updateMemberClaimSettings.useMutation({ onSuccess: () => { toast.success("Reklamations-Einstellungen gespeichert."); onDone(); }, onError: (error) => toast.error(error.message) });
  const submit = () => save.mutate({ membershipId: membership.id, reclamationPeriodHours: hours, autoAcceptApiClaims: autoAccept, blockedClaimCategoryIds: blocked, excludedClaimReasonIds: excluded });
  const toggle = (list: number[], set: (value: number[]) => void, id: number) => set(list.includes(id) ? list.filter((item) => item !== id) : [...list, id]);
  return <div className="md-stack">
    <section className="surface-panel operations-panel md-card"><SectionHead icon={CalendarClock} title="Reklamationsfrist" text="Wie lange dieser Käufer einen Lead nach Zuweisung reklamieren darf." /><div className="grid gap-3 md:grid-cols-2"><label className="text-xs text-slate-300">Reklamations-Fenster (Stunden)<Input type="number" min={0} max={720} value={hours} onChange={(event) => setHours(Number(event.target.value))} /><span className="mt-1 block text-[11px] text-slate-500">Wie viele Stunden nach Lead-Zuweisung darf der Benutzer reklamieren? 0 = sofort gesperrt, 720 = 30 Tage.</span></label><Toggle checked={autoAccept} onChange={setAutoAccept} label="API-Reklamationen automatisch annehmen" hint="Wenn an, werden per API gemeldete Reklamationen (Order-Leads) sofort genehmigt + erstattet, statt offen auf deine Prüfung zu warten." /></div><div className="mt-3 flex justify-end"><Button className="flux-button" size="sm" onClick={submit} disabled={save.isPending}>Frist speichern</Button></div></section>
    <section className="surface-panel operations-panel md-card"><SectionHead icon={Ban} title="Kategorien ohne Reklamation" text="Lead-Kategorien, die dieser Benutzer NICHT reklamieren darf." /><div className="md-checks">{data.categories.map((category) => <label key={category.id} className={blocked.includes(category.id) ? "is-on" : ""}><input type="checkbox" checked={blocked.includes(category.id)} onChange={() => toggle(blocked, setBlocked, category.id)} /> <span>{category.shortcode} · {category.name}</span></label>)}</div><div className="mt-3 flex justify-end"><Button className="flux-button" size="sm" onClick={submit} disabled={save.isPending}>Sperren speichern</Button></div></section>
    <section className="surface-panel operations-panel md-card"><SectionHead icon={ListFilter} title="Gründe, die er nicht wählen kann" text="Gründe, die diesem Käufer im Reklamations-Dialog NICHT angeboten werden." /><div className="md-checks">{data.reasons.map((reason) => <label key={reason.id} className={excluded.includes(reason.id) ? "is-on" : ""}><input type="checkbox" checked={excluded.includes(reason.id)} onChange={() => toggle(excluded, setExcluded, reason.id)} /> <span>{reason.name}</span></label>)}{!data.reasons.length && <p className="text-sm text-slate-500">Noch keine Reklamationsgründe angelegt (Einstellungen → Reklamationen).</p>}</div><div className="mt-3 flex justify-end"><Button className="flux-button" size="sm" onClick={submit} disabled={save.isPending}>Auswahl speichern</Button></div></section>
  </div>;
}

function BillingTab({ data, onDone }: { data: Detail; onDone: () => void }) {
  const { settings, membership } = data;
  const [form, setForm] = useState({ paymentMode: settings.paymentMode, billingInterval: settings.billingInterval, paymentTermsDays: settings.paymentTermsDays, taxRatePercent: settings.taxRatePercent === null ? "" : String(settings.taxRatePercent) });
  const save = trpc.leadops.updateMemberBillingSettings.useMutation({ onSuccess: () => { toast.success("Zahlungsart gespeichert."); onDone(); }, onError: (error) => toast.error(error.message) });
  return <section className="surface-panel operations-panel md-card"><SectionHead icon={CreditCard} title="Zahlungsart" text="Lege fest, wie dieser Käufer für gelieferte Leads zahlt. Das Guthaben-System bleibt davon unberührt." /><div className="md-grid">
    <label className="text-xs text-slate-300">Abrechnungsart<select className={field} value={form.paymentMode} onChange={(event) => setForm((current) => ({ ...current, paymentMode: event.target.value as typeof form.paymentMode }))}><option value="vorkasse">Guthaben (Vorkasse)</option><option value="auf_rechnung">Auf Rechnung</option><option value="karte_pro_lead">Kreditkarte pro Lead</option><option value="sepa_pro_lead">SEPA-Lastschrift pro Lead</option><option value="standard">Standard</option><option value="gesperrt">Gesperrt</option></select></label>
    <label className="text-xs text-slate-300">Abrechnungsintervall<select className={field} value={form.billingInterval} onChange={(event) => setForm((current) => ({ ...current, billingInterval: event.target.value as typeof form.billingInterval }))}><option value="7_tage">Alle 7 Tage</option><option value="14_tage">Alle 14 Tage</option><option value="30_tage">Alle 30 Tage</option><option value="woechentlich_freitag">Wöchentlich, freitags 15:00 Uhr</option></select></label>
    <label className="text-xs text-slate-300">Zahlungsziel (Tage)<Input type="number" min={0} max={365} value={form.paymentTermsDays} onChange={(event) => setForm((current) => ({ ...current, paymentTermsDays: Number(event.target.value) }))} /><span className="mt-1 block text-[11px] text-slate-500">Frist auf der Rechnung bis zur Zahlung.</span></label>
    <label className="text-xs text-slate-300">Steuersatz % (US/CA)<Input type="number" step="0.01" min={0} max={100} value={form.taxRatePercent} onChange={(event) => setForm((current) => ({ ...current, taxRatePercent: event.target.value }))} /><span className="mt-1 block text-[11px] text-slate-500">USA/Kanada: Pflichtangabe (Sales Tax des Käufers, auch 0). Schweiz, Türkei, Australien: optional — ein eingetragener Satz ersetzt auf Rechnungen die Steuer des Mandanten. Für alle anderen Länder leer lassen.</span></label>
  </div><div className="mt-4 flex justify-end"><Button className="flux-button" size="sm" onClick={() => save.mutate({ membershipId: membership.id, paymentMode: form.paymentMode, billingInterval: form.billingInterval, paymentTermsDays: form.paymentTermsDays, taxRatePercent: form.taxRatePercent === "" ? null : Number(form.taxRatePercent) })} disabled={save.isPending}>Speichern</Button></div></section>;
}

function NotificationTab({ data, onDone }: { data: Detail; onDone: () => void }) {
  const { settings, membership } = data;
  const [form, setForm] = useState({ notifyLeads: settings.notifyLeads, notifyLeadsEmail: settings.notifyLeadsEmail ?? "", notifyInvoices: settings.notifyInvoices, notifyInvoicesEmail: settings.notifyInvoicesEmail ?? "", notifySystem: settings.notifySystem, notifySystemEmail: settings.notifySystemEmail ?? "" });
  const save = trpc.leadops.updateMemberNotificationSettings.useMutation({ onSuccess: () => { toast.success("Benachrichtigungen gespeichert."); onDone(); }, onError: (error) => toast.error(error.message) });
  const block = (key: "notifyLeads" | "notifyInvoices" | "notifySystem", emailKey: "notifyLeadsEmail" | "notifyInvoicesEmail" | "notifySystemEmail", title: string, hint: string) => <div className="md-box"><Toggle checked={form[key]} onChange={(value) => setForm((current) => ({ ...current, [key]: value }))} label={title} hint={hint} /><label className="mt-3 block text-xs text-slate-300">Ziel-E-Mail (optional — sonst Konto-E-Mail)<Input type="email" value={form[emailKey]} onChange={(event) => setForm((current) => ({ ...current, [emailKey]: event.target.value }))} /></label></div>;
  return <section className="surface-panel operations-panel md-card"><SectionHead icon={Bell} title="E-Mails an diesen Benutzer" text="Lege fest, welche E-Mail-Benachrichtigungen dieser Käufer erhält. Standardmäßig sind alle aktiv." /><div className="grid gap-3 md:grid-cols-3">{block("notifyLeads", "notifyLeadsEmail", "Gelieferte Leads", "E-Mail bei jedem neu zugewiesenen Lead.")}{block("notifyInvoices", "notifyInvoicesEmail", "Rechnungen", "E-Mail mit PDF, sobald eine Rechnung erstellt wird.")}{block("notifySystem", "notifySystemEmail", "Systemnachrichten", "Ankündigungen und allgemeine Hinweise.")}</div><div className="mt-4 flex justify-end"><Button className="flux-button" size="sm" onClick={() => save.mutate({ membershipId: membership.id, notifyLeads: form.notifyLeads, notifyLeadsEmail: form.notifyLeadsEmail || null, notifyInvoices: form.notifyInvoices, notifyInvoicesEmail: form.notifyInvoicesEmail || null, notifySystem: form.notifySystem, notifySystemEmail: form.notifySystemEmail || null })} disabled={save.isPending}>Speichern</Button></div></section>;
}

const stamp = (value: Date | string) => new Date(value).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Aktivität (v389) als Zeitleiste: Zeitpunkt, was passiert ist, und der Lead dazu. */
function ActivityTab({ membershipId }: { membershipId: number }) {
  const activity = trpc.leadops.listMemberActivity.useQuery({ membershipId }, { retry: false });
  const [search, setSearch] = useState(""); const [page, setPage] = useState(0); const pageSize = 25;
  const rows = useMemo(() => (activity.data ?? []).filter((event) => !search || `${event.title} ${event.detail ?? ""} ${event.leadPublicId ?? ""}`.toLowerCase().includes(search.toLowerCase())), [activity.data, search]);
  const visible = rows.slice(page * pageSize, page * pageSize + pageSize);
  return <section className="surface-panel operations-panel md-card"><SectionHead icon={Activity} title="Was passiert ist" text="Letzte Admin-Aktionen + Lead-Ereignisse für diesen Benutzer." /><div className="flex flex-wrap items-center gap-2"><Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Aktivität durchsuchen …" className="max-w-md" /><Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage((current) => current - 1)}>Zurück</Button><Button size="sm" variant="ghost" disabled={(page + 1) * pageSize >= rows.length} onClick={() => setPage((current) => current + 1)}>Weiter</Button></div>
    {visible.length ? <ol className="md-timeline">{visible.map((event, index) => <li key={index} className={`is-${activityTone(event.title)}`}><time dateTime={new Date(event.at).toISOString()}>{stamp(event.at)}</time><div><b>{event.title}</b>{event.detail && <small>{event.detail}</small>}</div><span>{event.leadPublicId ? `Lead ${event.leadPublicId}` : event.kind}</span></li>)}</ol> : <p className="mt-3 text-sm text-slate-500">Noch keine Aktivität.</p>}</section>;
}

/**
 * Reiter „Ansicht“ (v388): welche Seiten der Kunde in seinem Bereich sieht – genau die Seiten, die es im Kundenbereich gibt
 * (shared/customer-areas.ts). Bis v387 standen hier 14 Bereiche aus der alten Vorlage, von denen nur fünf wirkten.
 */
function VisibilityTab({ data, onDone }: { data: Detail; onDone: () => void }) {
  const { settings, membership } = data;
  const supplier = membership.partnerType === "lieferant";
  const [areas, setAreas] = useState<string[] | null>(Array.isArray(settings.visibleAreas) ? (settings.visibleAreas as string[]).filter((area) => CHOOSABLE_AREAS.includes(area)) : null);
  const [categoryIds, setCategoryIds] = useState<number[] | null>(Array.isArray(settings.visibleCategoryIds) ? (settings.visibleCategoryIds as number[]) : null);
  const save = trpc.leadops.updateMemberVisibility.useMutation({ onSuccess: () => { toast.success("Ansicht gespeichert."); onDone(); }, onError: (error) => toast.error(error.message) });
  const areaOn = (area: string) => areas === null || areas.includes(area);
  const toggleArea = (area: string) => setAreas((current) => { const base = current ?? [...CHOOSABLE_AREAS]; return base.includes(area) ? base.filter((item) => item !== area) : [...base, area]; });
  const categoryOn = (id: number) => categoryIds === null || categoryIds.includes(id);
  const toggleCategory = (id: number) => setCategoryIds((current) => { const base = current ?? data.categories.map((category) => category.id); return base.includes(id) ? base.filter((item) => item !== id) : [...base, id]; });
  const shown = CUSTOMER_AREAS.filter((area) => !area.onlySupplier || supplier);
  return <div className="md-stack fx-scope va">
    <section className="surface-panel operations-panel md-card" aria-label="Sichtbare Bereiche"><SectionHead icon={LayoutPanelLeft} title="Sichtbare Bereiche" text="Lege fest, welche Seiten dieser Kunde in seinem Bereich sieht. Dashboard, Leads und Einstellungen sieht er immer – ohne eigene Auswahl sieht er alles." />
      <ul className="va-areas">{shown.map((area) => { const on = area.always || areaOn(area.key);
        return <li key={area.key} className={area.always ? "is-always" : on ? "is-on" : "is-off"}><label><input type="checkbox" checked={on} disabled={area.always} onChange={() => toggleArea(area.key)} /><span><b>{area.label}</b><small>{area.hint}</small></span>{area.always ? <em>immer sichtbar</em> : null}</label></li>; })}</ul>
      {!supplier && <p className="va-note">„Lead-Import“ (Leads hochladen) gibt es nur bei Lieferanten-Zugängen – deshalb steht er hier nicht.</p>}
    </section>
    <section className="surface-panel operations-panel md-card" aria-label="Sichtbare Lead-Kategorien"><SectionHead icon={Eye} title="Sichtbare Lead-Kategorien" text="Welche Lead-Kategorien dieser Kunde auf seiner Seite „Integrationen“ sieht. Ausgeblendete Kategorien betreffen nur die Anzeige – an der Lieferung ändert sich nichts." />
      <div className="md-checks">{data.categories.map((category) => <label key={category.id} className={categoryOn(category.id) ? "is-on" : ""}><input type="checkbox" checked={categoryOn(category.id)} onChange={() => toggleCategory(category.id)} /> <span>{category.name} <small>{category.shortcode}</small></span></label>)}</div>
      <div className="mt-4 flex justify-between"><Button size="sm" variant="ghost" onClick={() => { setAreas(null); setCategoryIds(null); }}>Auf Standard zurücksetzen</Button><Button className="flux-button" size="sm" onClick={() => save.mutate({ membershipId: membership.id, visibleAreas: areas, visibleCategoryIds: categoryIds })} disabled={save.isPending}>Speichern</Button></div>
    </section>
  </div>;
}
