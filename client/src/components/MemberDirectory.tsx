import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { Eye, EyeOff, LogIn, Pencil, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { confirmAction } from "@/lib/confirm";

const euro = (value: string | number | null | undefined) => `${Number(value ?? 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const shortId = (id: number) => `#${String(id).padStart(6, "0")}`;
export const roleLabel = (role: string, partnerType: string) => role === "inhaber" ? "Owner" : role === "admin" ? "Admin" : role === "vertrieb" && partnerType === "intern" ? "Vertriebler" : partnerType === "intern" ? "Admin-Team" : "Benutzer";
const paymentLabel = (mode: string | null | undefined) => mode === "auf_rechnung" ? "RECHNUNG" : mode === "vorkasse" ? "PREPAID" : mode === "karte_pro_lead" ? "KARTE" : mode === "sepa_pro_lead" ? "SEPA" : mode === "gesperrt" ? "GESPERRT" : "STANDARD";
const generatePassword = () => { const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!$%"; const bytes = new Uint8Array(14); crypto.getRandomValues(bytes); return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join(""); };

export function openMember(membershipId: number) { window.location.assign(`/?page=Benutzer&member=${membershipId}`); }

export default function MemberDirectory() {
  const utils = trpc.useUtils();
  const members = trpc.leadops.listMembers.useQuery(undefined, { retry: false });
  const me = trpc.auth.me.useQuery(undefined, { retry: false });
  const [tab, setTab] = useState<"aktiv" | "inaktiv">("aktiv");
  const [dialogOpen, setDialogOpen] = useState(false);
  const updateMembership = trpc.leadops.updateMembership.useMutation({ onSuccess: () => { utils.leadops.listMembers.invalidate(); toast.success("Status geändert."); }, onError: (error) => toast.error(error.message) });
  const impersonate = trpc.auth.impersonate.useMutation({ onSuccess: async (result) => { window.sessionStorage.setItem("tanesco.impersonationReturn", String(result.membershipId)); await utils.invalidate(); window.location.assign("/?page=Dashboard"); }, onError: (error) => toast.error(error.message) });
  const rows = (members.data ?? []).filter((member) => tab === "aktiv" ? member.status !== "deaktiviert" : member.status === "deaktiviert");
  const activeCount = (members.data ?? []).filter((member) => member.status !== "deaktiviert").length; const inactiveCount = (members.data?.length ?? 0) - activeCount;

  return <>
    <header className="page-intro compact"><div><span className="eyebrow">VERWALTUNG</span><h1>Benutzer</h1><p>Benutzer deines Mandanten verwalten — Vertriebler, Buyer und Admins.</p></div><div className="people-header-actions"><Button variant="outline" onClick={() => window.location.assign("/?page=Benutzer&view=Partnerprofile")}>Partnerprofile</Button><Button variant="outline" onClick={() => window.location.assign("/?page=Benutzer&view=Einladungen")}>Einladungen</Button><Button className="flux-button" onClick={() => setDialogOpen(true)}><UserPlus /> Neuer Benutzer</Button></div></header>
    <div className="mb-3 flex gap-2 text-sm">{([["aktiv", `Aktiv (${activeCount})`], ["inaktiv", `Inaktiv (${inactiveCount})`]] as const).map(([key, label]) => <button key={key} type="button" className={`rounded-md px-3 py-1.5 ${tab === key ? "bg-white/10 text-white" : "text-slate-400"}`} onClick={() => setTab(key)}>{label}</button>)}</div>
    <section className="surface-panel operations-panel overflow-hidden"><div className="table-wrap wrap-cells"><table className="flux-table"><thead><tr><th>ID</th><th>Benutzer</th><th>Rolle</th><th>Zahlungsart</th><th>Guthaben & Zahlung</th><th>Rechnung offen</th><th>Registriert am</th><th>Aktionen</th></tr></thead><tbody>
      {rows.map((member) => { const owner = member.role === "inhaber"; return <tr key={member.membershipId}>
        <td><button type="button" className="font-mono text-xs text-violet-200 hover:underline" onClick={() => openMember(member.membershipId)}>{shortId(member.membershipId)}</button></td>
        <td><button type="button" className="text-left text-slate-100 hover:underline" onClick={() => openMember(member.membershipId)}>{member.name ?? "—"}</button>{member.company && <div className="text-xs text-slate-400">{member.company}</div>}<div className="text-xs text-slate-500">{member.email ?? "—"}</div></td>
        <td><Badge variant="outline" className="border-white/15 text-slate-200">{roleLabel(member.role, member.partnerType)}</Badge>{member.supplierActive && <Badge variant="outline" className="ml-1 border-amber-400/25 bg-amber-500/10 text-amber-200">Lieferant</Badge>}</td>
        <td>{owner ? "—" : <Badge variant="outline" className="border-cyan-400/25 bg-cyan-500/10 text-cyan-200">{paymentLabel(member.paymentMode)}</Badge>}</td>
        <td>{owner ? "—" : euro(member.prepaidBalance)}</td>
        <td>—</td>
        <td>{new Date(member.createdAt).toLocaleDateString("de-DE")}</td>
        <td style={{ whiteSpace: "nowrap", width: "1%" }}><div className="flex flex-col items-start gap-1">{!owner && <Button size="sm" variant="ghost" title={member.status === "deaktiviert" ? "Aktivieren" : "Deaktivieren"} onClick={() => updateMembership.mutate({ id: member.membershipId, status: member.status === "deaktiviert" ? "aktiv" : "deaktiviert" })}>{member.status === "deaktiviert" ? <><Eye /> Aktivieren</> : <><EyeOff /> Deaktivieren</>}</Button>}{!owner && member.userId !== me.data?.id && <Button size="sm" variant="ghost" title="Als Benutzer einloggen" onClick={async () => { if (await confirmAction(`Als ${member.name ?? member.email} einloggen? Du siehst die Plattform dann genau wie dieser Benutzer.`)) impersonate.mutate({ membershipId: member.membershipId }); }}><LogIn /> Als Benutzer einloggen</Button>}<Button size="sm" variant="ghost" onClick={() => openMember(member.membershipId)}><Pencil /> Bearbeiten</Button></div></td>
      </tr>; })}
    </tbody></table></div>{!rows.length && <p className="p-7 text-center text-sm text-slate-500">Keine Benutzer in dieser Ansicht.</p>}</section>
    {dialogOpen && <NewMemberDialog onClose={() => setDialogOpen(false)} />}
  </>;
}

function NewMemberDialog({ onClose }: { onClose: () => void }) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState({ firstName: "", lastName: "", company: "", phone: "", email: "", password: "", kind: "benutzer" as "benutzer" | "admin" | "vertriebler", status: "aktiv" as "aktiv" | "inaktiv", billingStreet: "", billingPostalCode: "", billingCity: "", billingCountry: "DE" });
  const [showPassword, setShowPassword] = useState(false);
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const create = trpc.leadops.createMember.useMutation({ onSuccess: (result) => { utils.leadops.listMembers.invalidate(); toast.success("Benutzer angelegt. Bitte Passwort auf einem sicheren Weg weitergeben."); onClose(); openMember(result.membershipId); }, onError: (error) => toast.error(error.message) });
  const field = "h-10 w-full rounded-md border border-white/10 bg-slate-900 px-3 text-sm text-slate-100";
  return <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/60 px-4 py-6" onClick={onClose}><section className="surface-panel w-full max-w-2xl p-6" onClick={(event) => event.stopPropagation()}>
    <span className="eyebrow">BENUTZER</span><h2 className="mt-1 text-lg text-slate-100">Neuen Benutzer anlegen</h2><p className="mt-1 text-sm text-slate-400">Vertriebler oder Buyer direkt anlegen — Passwort wird hier gesetzt und manuell an den Benutzer weitergegeben.</p>
    <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); create.mutate({ ...form, company: form.company || undefined, phone: form.phone || undefined, billingStreet: form.billingStreet || undefined, billingPostalCode: form.billingPostalCode || undefined, billingCity: form.billingCity || undefined, billingCountry: form.billingCountry || undefined }); }}>
      <label className="text-xs text-slate-300">Vorname<Input value={form.firstName} onChange={set("firstName")} required /></label>
      <label className="text-xs text-slate-300">Nachname<Input value={form.lastName} onChange={set("lastName")} required /></label>
      <label className="text-xs text-slate-300">Firma<Input value={form.company} onChange={set("company")} /></label>
      <label className="text-xs text-slate-300">Telefon<Input type="tel" value={form.phone} onChange={set("phone")} /></label>
      <label className="text-xs text-slate-300">E-Mail *<Input type="email" value={form.email} onChange={set("email")} required /><span className="mt-1 block text-[11px] text-slate-500">Kann nach dem Anlegen nicht mehr geändert werden.</span></label>
      <label className="text-xs text-slate-300">Passwort *<div className="flex gap-1"><Input type={showPassword ? "text" : "password"} value={form.password} onChange={set("password")} required autoComplete="new-password" /><Button type="button" variant="outline" size="sm" onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff /> : <Eye />}</Button><Button type="button" variant="outline" size="sm" onClick={() => { setForm((current) => ({ ...current, password: generatePassword() })); setShowPassword(true); }}>Passwort generieren</Button></div></label>
      <label className="text-xs text-slate-300">Rolle *<select className={field} value={form.kind} onChange={set("kind")}><option value="benutzer">Benutzer</option><option value="admin">Admin</option><option value="vertriebler">Vertriebler (Pipeline &amp; Haustür)</option></select>{form.kind === "vertriebler" && <span className="mt-1 block text-[11px] text-amber-200">Vertriebler kauft keine Leads und sieht keinen Shop — er pitcht Angebote an die ihm zugewiesenen Buyer. Ein Account ist entweder Buyer ODER Vertriebler, nie beides.</span>}</label>
      <label className="text-xs text-slate-300">Status *<select className={field} value={form.status} onChange={set("status")}><option value="aktiv">Aktiv</option><option value="inaktiv">Inaktiv</option></select></label>
      <div className="md:col-span-2"><span className="eyebrow">RECHNUNGSADRESSE</span></div>
      <label className="text-xs text-slate-300 md:col-span-2">Straße + Hausnummer<Input value={form.billingStreet} onChange={set("billingStreet")} placeholder="Musterstraße 12" /></label>
      <label className="text-xs text-slate-300">PLZ<Input value={form.billingPostalCode} onChange={set("billingPostalCode")} placeholder="10115" /></label>
      <label className="text-xs text-slate-300">Stadt<Input value={form.billingCity} onChange={set("billingCity")} placeholder="Berlin" /></label>
      <label className="text-xs text-slate-300">Land<select className={field} value={form.billingCountry} onChange={set("billingCountry")}>{["DE", "AT", "CH", "US", "CA", "AU", "TR"].map((code) => <option key={code} value={code}>{code}</option>)}</select></label>
      <div className="mt-2 flex justify-end gap-2 md:col-span-2"><Button type="button" variant="ghost" onClick={onClose}>Abbrechen</Button><Button className="flux-button" type="submit" disabled={create.isPending}>Anlegen</Button></div>
    </form>
  </section></div>;
}
