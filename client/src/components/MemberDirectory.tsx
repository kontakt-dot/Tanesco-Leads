import { AvatarContent } from "@/components/AvatarUpload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { ChevronRight, Crown, Eye, EyeOff, Headset, LogIn, Plug, Search, ShieldCheck, ShoppingBag, Truck, UserPlus, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { confirmAction } from "@/lib/confirm";

type Member = inferRouterOutputs<AppRouter>["leadops"]["listMembers"][number];

const euro = (value: string | number | null | undefined) => `${Number(value ?? 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const shortId = (id: number) => `#${String(id).padStart(6, "0")}`;
export const roleLabel = (role: string, partnerType: string) => role === "inhaber" ? "Owner" : role === "admin" ? "Admin" : role === "vertrieb" && partnerType === "intern" ? "Vertriebler" : partnerType === "intern" ? "Admin-Team" : "Benutzer";
const paymentLabel = (mode: string | null | undefined) => mode === "auf_rechnung" ? "Auf Rechnung" : mode === "vorkasse" ? "Prepaid" : mode === "karte_pro_lead" ? "Karte je Lead" : mode === "sepa_pro_lead" ? "SEPA je Lead" : mode === "gesperrt" ? "Gesperrt" : "Standard";
const generatePassword = () => { const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!$%"; const bytes = new Uint8Array(14); crypto.getRandomValues(bytes); return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join(""); };
const initialsOf = (text: string | null | undefined) => (text ?? "?").replace(/\b(gmbh|ag|ug|kg|gbr|ohg|e\.?\s?k\.?|mbh)\b/gi, "").trim().split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "?";

export function openMember(membershipId: number) { window.location.assign(`/?page=Benutzer&member=${membershipId}`); }

/** Kunde = Käufer-Konto (bekommt Leads), Lieferant = liefert Leads; alle anderen gehören zum Team. */
const isCustomer = (member: Pick<Member, "partnerType" | "role">) => member.partnerType === "käufer" && member.role !== "inhaber";
const isSupplier = (member: Pick<Member, "partnerType" | "role">) => member.partnerType === "lieferant" && member.role !== "inhaber";
type Group = "alle" | "kunden" | "team" | "lieferanten";
const groupOf = (member: Pick<Member, "partnerType" | "role">): Exclude<Group, "alle"> => isCustomer(member) ? "kunden" : isSupplier(member) ? "lieferanten" : "team";

/** Rolle als Abzeichen: Owner, Admin, Vertriebler, Lieferant, Kunde. */
function rolePill(member: Pick<Member, "role" | "partnerType">): { label: string; tone: string; icon: ReactNode } {
  if (member.role === "inhaber") return { label: "Owner", tone: "owner", icon: <Crown aria-hidden="true" /> };
  if (member.role === "admin") return { label: "Admin", tone: "admin", icon: <ShieldCheck aria-hidden="true" /> };
  if (member.partnerType === "intern") return member.role === "vertrieb" ? { label: "Vertriebler", tone: "sales", icon: <Headset aria-hidden="true" /> } : { label: "Admin-Team", tone: "admin", icon: <ShieldCheck aria-hidden="true" /> };
  if (member.partnerType === "lieferant") return { label: "Lieferant", tone: "supplier", icon: <Truck aria-hidden="true" /> };
  return { label: "Kunde", tone: "customer", icon: <ShoppingBag aria-hidden="true" /> };
}

/** Wann zuletzt angemeldet – in Worten. */
export function lastSeenText(value: Date | string | null | undefined, now = new Date()): { text: string; never: boolean } {
  if (!value) return { text: "noch nie angemeldet", never: true };
  const at = new Date(value); if (Number.isNaN(at.getTime())) return { text: "noch nie angemeldet", never: true };
  const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((day(now) - day(at)) / 86_400_000);
  if (days <= 0) return { text: "heute angemeldet", never: false };
  if (days === 1) return { text: "gestern angemeldet", never: false };
  if (days < 30) return { text: `vor ${days} Tagen angemeldet`, never: false };
  return { text: `zuletzt am ${at.toLocaleDateString("de-DE")}`, never: false };
}

function IconAction({ label, onClick, children, tone }: { label: string; onClick: () => void; children: ReactNode; tone?: "danger" }) {
  return <button type="button" className={`bn-icon${tone ? ` is-${tone}` : ""}`} title={label} aria-label={label} onClick={onClick}>{children}</button>;
}

export default function MemberDirectory() {
  const utils = trpc.useUtils();
  const members = trpc.leadops.listMembers.useQuery(undefined, { retry: false });
  const me = trpc.auth.me.useQuery(undefined, { retry: false });
  const [status, setStatus] = useState<"aktiv" | "inaktiv">("aktiv");
  const [group, setGroup] = useState<Group>("alle");
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const updateMembership = trpc.leadops.updateMembership.useMutation({ onSuccess: (_result, variables) => { utils.leadops.listMembers.invalidate(); toast.success(variables.status === "deaktiviert" ? "Benutzer deaktiviert – er kann sich nicht mehr anmelden." : "Benutzer wieder aktiv."); }, onError: (error) => toast.error(error.message) });
  const impersonate = trpc.auth.impersonate.useMutation({ onSuccess: async (result) => { window.sessionStorage.setItem("tanesco.impersonationReturn", String(result.membershipId)); await utils.invalidate(); window.location.assign("/?page=Dashboard"); }, onError: (error) => toast.error(error.message) });

  const all = members.data ?? [];
  const inStatus = all.filter((member) => status === "aktiv" ? member.status !== "deaktiviert" : member.status === "deaktiviert");
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const visible = inStatus.filter((member) => words.every((word) => [member.name, member.company, member.email, shortId(member.membershipId)].some((value) => String(value ?? "").toLowerCase().includes(word))));
  const customers = visible.filter(isCustomer).sort((a, b) => String(a.company || a.name || "").localeCompare(String(b.company || b.name || ""), "de"));
  const team = visible.filter((member) => groupOf(member) === "team"); const suppliers = visible.filter((member) => groupOf(member) === "lieferanten");
  const activeCount = all.filter((member) => member.status !== "deaktiviert").length; const inactiveCount = all.length - activeCount;
  const counts: Record<Group, number> = { alle: inStatus.length, kunden: inStatus.filter((member) => groupOf(member) === "kunden").length, team: inStatus.filter((member) => groupOf(member) === "team").length, lieferanten: inStatus.filter((member) => groupOf(member) === "lieferanten").length };
  const anySuppliers = all.some((member) => groupOf(member) === "lieferanten");

  const toggle = async (member: Member) => {
    const off = member.status === "deaktiviert";
    if (!off && !(await confirmAction(`${member.company || member.name || member.email} deaktivieren? Der Zugang wird gesperrt; Leads, Bestellungen und Verlauf bleiben.`, { confirmLabel: "Deaktivieren", danger: true }))) return;
    updateMembership.mutate({ id: member.membershipId, status: off ? "aktiv" : "deaktiviert" });
  };
  const loginAs = async (member: Member) => { if (await confirmAction(`Als ${member.name ?? member.email} einloggen? Du siehst die Plattform dann genau wie dieser Benutzer.`)) impersonate.mutate({ membershipId: member.membershipId }); };
  const actionsOf = (member: Member) => { const owner = member.role === "inhaber"; return <>
    {!owner && member.userId !== me.data?.id && member.status !== "deaktiviert" ? <IconAction label="Als Benutzer einloggen" onClick={() => void loginAs(member)}><LogIn /></IconAction> : null}
    {!owner ? <IconAction label={member.status === "deaktiviert" ? "Aktivieren" : "Deaktivieren"} tone={member.status === "deaktiviert" ? undefined : "danger"} onClick={() => void toggle(member)}>{member.status === "deaktiviert" ? <Eye /> : <EyeOff />}</IconAction> : null}
  </>; };

  const rowOf = (member: Member) => {
    const pill = rolePill(member); const seen = lastSeenText((member as { lastSignedIn?: Date | string | null }).lastSignedIn); const off = member.status === "deaktiviert";
    return <li key={member.membershipId} className={`bn-row${off ? " is-off" : ""}`}>
      <button type="button" className="bn-row-main" onClick={() => openMember(member.membershipId)} aria-label={`${member.name ?? member.email ?? "Benutzer"} öffnen`}>
        <span className="member-pic bn-pic" aria-hidden="true"><AvatarContent avatarUrl={member.avatarUrl ?? null} initials={initialsOf(member.name ?? member.email)} /></span>
        <span className="bn-row-name"><b>{member.name ?? member.email ?? "—"}</b><small>{member.company && member.partnerType !== "intern" ? `${member.company} · ` : ""}{member.email ?? "keine E-Mail"}</small></span>
      </button>
      <span className="bn-row-meta"><span className={`bn-role is-${pill.tone}`}>{pill.icon}{pill.label}</span><span className={`bn-row-seen${seen.never ? " bn-quiet" : ""}`}>{seen.text}</span><span className="bn-row-since">dabei seit {new Date(member.createdAt).toLocaleDateString("de-DE")}</span></span>
      <div className="bn-icons">{actionsOf(member)}<IconAction label="Öffnen" onClick={() => openMember(member.membershipId)}><ChevronRight /></IconAction></div>
    </li>;
  };
  const segments: Array<[Group, string]> = [["alle", "Alle"], ["kunden", "Kunden"], ["team", "Team"], ...(anySuppliers ? [["lieferanten", "Lieferanten"] as [Group, string]] : [])];
  return <div className="bn-page">
    <header className="page-intro compact"><div><span className="eyebrow">VERWALTUNG</span><h1>Benutzer</h1><p>Dein Team und deine Kunden – wer Zugang hat und wer Leads bekommt.</p></div><div className="people-header-actions"><Button variant="outline" onClick={() => window.location.assign("/?page=Benutzer&view=Partnerprofile")}>Partnerprofile</Button><Button variant="outline" onClick={() => window.location.assign("/?page=Benutzer&view=Einladungen")}>Einladungen</Button><Button className="flux-button" onClick={() => setDialogOpen(true)}><UserPlus /> Neuer Benutzer</Button></div></header>

    <div className="bn-deck">
      <div className="bn-segments" role="tablist" aria-label="Wer wird gezeigt">{segments.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={group === key} className={group === key ? "is-on" : ""} onClick={() => setGroup(key)}>{label}<span>{counts[key]}</span></button>)}</div>
      <div className="bn-state" role="group" aria-label="Status">{([["aktiv", "Aktiv", activeCount], ["inaktiv", "Deaktiviert", inactiveCount]] as const).map(([key, label, count]) => <button key={key} type="button" aria-pressed={status === key} className={status === key ? "is-on" : ""} onClick={() => setStatus(key)}>{label} <span>{count}</span></button>)}</div>
      <label className="bn-search"><Search aria-hidden="true" /><input type="search" value={query} placeholder="Name, Firma oder E-Mail" aria-label="Benutzer suchen" onChange={(event) => setQuery(event.target.value)} />{query ? <button type="button" aria-label="Suche leeren" onClick={() => setQuery("")}><X /></button> : null}</label>
    </div>

    {members.isLoading ? <p className="bn-empty">Benutzer werden geladen …</p> : null}

    {!members.isLoading && (group === "alle" || group === "kunden") ? <section className="bn-section" aria-label="Kunden">
      <div className="bn-section-head"><h2>Kunden <span>{customers.length}</span></h2><p>Käufer-Konten: Sie bekommen Leads – über ihre Schnittstelle oder im eigenen Bereich.</p></div>
      {customers.length ? <div className="bn-cards">{customers.map((member) => {
        const seen = lastSeenText((member as { lastSignedIn?: Date | string | null }).lastSignedIn); const endpoints = Number((member as { endpoints?: number }).endpoints) || 0; const off = member.status === "deaktiviert";
        const title = member.company || member.name || member.email || "Kunde";
        return <article key={member.membershipId} className={`bn-card${off ? " is-off" : ""}`}>
          <button type="button" className="bn-card-main" onClick={() => openMember(member.membershipId)} aria-label={`${title} öffnen`}>
            <span className="bn-mono" aria-hidden="true">{member.avatarUrl ? <AvatarContent avatarUrl={member.avatarUrl} initials={initialsOf(title)} /> : initialsOf(title)}</span>
            <span className="bn-card-title"><b>{title}</b>{member.company && member.name ? <small>{member.name}</small> : null}<small className="bn-mail">{member.email ?? "keine E-Mail"}</small></span>
            <span className="bn-id">{shortId(member.membershipId)}</span>
          </button>
          <dl className="bn-facts">
            <div><dt>Zahlung</dt><dd><span className={`bn-chip${member.paymentMode === "gesperrt" ? " is-bad" : ""}`}>{paymentLabel(member.paymentMode)}</span><span className="bn-num">{euro(member.prepaidBalance)}</span></dd></div>
            <div><dt>Schnittstelle</dt><dd>{endpoints ? <span className="bn-good"><Plug aria-hidden="true" />{endpoints} {endpoints === 1 ? "Lieferadresse" : "Lieferadressen"}</span> : member.integrationName ? <span className="bn-good"><Plug aria-hidden="true" />{member.integrationName}</span> : <span className="bn-quiet">noch keine</span>}</dd></div>
            <div><dt>Anmeldung</dt><dd className={seen.never ? "bn-quiet" : ""}>{seen.text}</dd></div>
            {member.supplierActive ? <div><dt>Lieferant</dt><dd><span className="bn-good"><Truck aria-hidden="true" />liefert auch Leads</span></dd></div> : null}
          </dl>
          <footer className="bn-card-foot"><button type="button" className="bn-open" onClick={() => openMember(member.membershipId)}>Öffnen<ChevronRight aria-hidden="true" /></button><div className="bn-icons">{actionsOf(member)}</div></footer>
        </article>;
      })}</div> : <p className="bn-empty">{words.length ? "Kein Kunde passt zur Suche." : status === "aktiv" ? "Noch keine Kunden. Lege mit „Neuer Benutzer“ und der Rolle „Benutzer“ einen Käufer an." : "Keine deaktivierten Kunden."}</p>}
    </section> : null}

    {!members.isLoading && (group === "alle" || group === "team") ? <section className="bn-section" aria-label="Team">
      <div className="bn-section-head"><h2>Team <span>{team.length}</span></h2><p>Owner, Admins und Vertriebler mit Zugang zur Plattform.</p></div>
      {team.length ? <ul className="bn-rows">{team.map(rowOf)}</ul> : <p className="bn-empty">{words.length ? "Niemand aus dem Team passt zur Suche." : status === "aktiv" ? "Noch niemand im Team." : "Niemand aus dem Team ist deaktiviert."}</p>}
    </section> : null}

    {!members.isLoading && anySuppliers && (group === "alle" || group === "lieferanten") ? <section className="bn-section" aria-label="Lieferanten">
      <div className="bn-section-head"><h2>Lieferanten <span>{suppliers.length}</span></h2><p>Konten, die Leads liefern.</p></div>
      {suppliers.length ? <ul className="bn-rows">{suppliers.map(rowOf)}</ul> : <p className="bn-empty">{words.length ? "Kein Lieferant passt zur Suche." : status === "aktiv" ? "Kein aktiver Lieferant." : "Kein Lieferant ist deaktiviert."}</p>}
    </section> : null}

    {dialogOpen && <NewMemberDialog onClose={() => setDialogOpen(false)} />}
  </div>;
}

function NewMemberDialog({ onClose }: { onClose: () => void }) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState({ firstName: "", lastName: "", company: "", phone: "", email: "", password: "", kind: "benutzer" as "benutzer" | "admin" | "vertriebler", status: "aktiv" as "aktiv" | "inaktiv", billingStreet: "", billingPostalCode: "", billingCity: "", billingCountry: "DE", welcomeMail: false });
  const [showPassword, setShowPassword] = useState(false);
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const create = trpc.leadops.createMember.useMutation({ onSuccess: (result, variables) => { utils.leadops.listMembers.invalidate(); toast.success(variables.welcomeMail ? "Benutzer angelegt – die Willkommensmail mit den Zugangsdaten ist unterwegs." : "Benutzer angelegt. Es ging keine E-Mail raus – das Passwort gibst du bei Bedarf selbst weiter."); onClose(); openMember(result.membershipId); }, onError: (error) => toast.error(error.message) });
  const field = "h-10 w-full rounded-md border border-white/10 bg-slate-900 px-3 text-sm text-slate-100";
  return <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/60 px-4 py-6" onClick={onClose}><section className="surface-panel w-full max-w-2xl p-6" onClick={(event) => event.stopPropagation()}>
    <span className="eyebrow">BENUTZER</span><h2 className="mt-1 text-lg text-slate-100">Neuen Benutzer anlegen</h2><p className="mt-1 text-sm text-slate-400">Vertriebler, Admin oder Kunde (Käufer) direkt anlegen. Das Passwort setzt du hier – per E-Mail geht es nur raus, wenn du unten „Willkommensmail schicken“ anhakst.</p>
    <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); create.mutate({ ...form, company: form.company || undefined, phone: form.phone || undefined, billingStreet: form.billingStreet || undefined, billingPostalCode: form.billingPostalCode || undefined, billingCity: form.billingCity || undefined, billingCountry: form.billingCountry || undefined }); }}>
      <label className="text-xs text-slate-300">Vorname<Input value={form.firstName} onChange={set("firstName")} required /></label>
      <label className="text-xs text-slate-300">Nachname<Input value={form.lastName} onChange={set("lastName")} required /></label>
      <label className="text-xs text-slate-300">Firma<Input value={form.company} onChange={set("company")} /></label>
      <label className="text-xs text-slate-300">Telefon<Input type="tel" value={form.phone} onChange={set("phone")} /></label>
      <label className="text-xs text-slate-300">E-Mail *<Input type="email" value={form.email} onChange={set("email")} required /><span className="mt-1 block text-[11px] text-slate-500">Kann nach dem Anlegen nicht mehr geändert werden.</span></label>
      <label className="text-xs text-slate-300">Passwort *<div className="flex gap-1"><Input type="password" reveal={showPassword} value={form.password} onChange={set("password")} required /><Button type="button" variant="outline" size="sm" aria-label={showPassword ? "Passwort verbergen" : "Passwort zeigen"} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff /> : <Eye />}</Button><Button type="button" variant="outline" size="sm" onClick={() => { setForm((current) => ({ ...current, password: generatePassword() })); setShowPassword(true); }}>Passwort generieren</Button></div></label>
      <label className="text-xs text-slate-300">Rolle *<select className={field} value={form.kind} onChange={set("kind")}><option value="benutzer">Benutzer (Kunde / Käufer)</option><option value="admin">Admin</option><option value="vertriebler">Vertriebler (Pipeline &amp; Haustür)</option></select>{form.kind === "vertriebler" && <span className="mt-1 block text-[11px] text-amber-200">Vertriebler kauft keine Leads und sieht keinen Shop.</span>}</label>
      <label className="text-xs text-slate-300">Status *<select className={field} value={form.status} onChange={set("status")}><option value="aktiv">Aktiv</option><option value="inaktiv">Inaktiv</option></select></label>
      <label className="bn-welcome md:col-span-2"><input type="checkbox" checked={form.welcomeMail} onChange={(event) => setForm((current) => ({ ...current, welcomeMail: event.target.checked }))} /><span><b>Willkommensmail mit Zugangsdaten schicken</b><small>Mit Adresse, Benutzername und Passwort – dazu Erinnerungen nach 3 und 7 Tagen, solange er sich nicht anmeldet. Aus lassen, wenn sich der Benutzer nicht einloggt, z. B. bei Kunden, die Leads nur über ihre Schnittstelle bekommen.</small></span></label>
      <div className="md:col-span-2"><span className="eyebrow">RECHNUNGSADRESSE</span></div>
      <label className="text-xs text-slate-300 md:col-span-2">Straße + Hausnummer<Input value={form.billingStreet} onChange={set("billingStreet")} placeholder="Musterstraße 12" /></label>
      <label className="text-xs text-slate-300">PLZ<Input value={form.billingPostalCode} onChange={set("billingPostalCode")} placeholder="10115" /></label>
      <label className="text-xs text-slate-300">Stadt<Input value={form.billingCity} onChange={set("billingCity")} placeholder="Berlin" /></label>
      <label className="text-xs text-slate-300">Land<select className={field} value={form.billingCountry} onChange={set("billingCountry")}>{["DE", "AT", "CH", "US", "CA", "AU", "TR"].map((code) => <option key={code} value={code}>{code}</option>)}</select></label>
      <div className="mt-2 flex justify-end gap-2 md:col-span-2"><Button type="button" variant="ghost" onClick={onClose}>Abbrechen</Button><Button className="flux-button" type="submit" disabled={create.isPending}>{form.welcomeMail ? "Anlegen und Mail schicken" : "Anlegen"}</Button></div>
    </form>
  </section></div>;
}
