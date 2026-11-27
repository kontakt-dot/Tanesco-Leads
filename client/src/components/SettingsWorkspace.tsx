import AvatarUpload, { useOwnAvatar } from "@/components/AvatarUpload";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ArrowDown, ArrowUp, Cable, ChevronLeft, ChevronRight, Code2, FileText, KeyRound, Palette, Plus, Receipt, Save, Send, Settings2, ShieldQuestion, Upload, UserRound, Users } from "lucide-react";
import { useEffect, useMemo, useReducer, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { openInApp } from "@/lib/navigate";
import AppearanceSettings from "@/components/AppearanceSettings";
import MailSettingsPanel from "@/components/MailSettingsPanel";
import ApiTokenPanel from "@/components/ApiTokenPanel";
import IntegrationPanel from "@/components/IntegrationPanel";
import PartnerAccountsPanel from "@/components/PartnerAccountsPanel";
import ApiDocsPanel from "@/components/ApiDocsPanel";
import LegalSettingsPanel from "@/components/LegalSettingsPanel";
import TermsPanel from "@/components/TermsPanel";
import { COMPANY_FOOTER, COMPANY_WEBSITE } from "../../../shared/email-design";
import { movedReasons, passwordIssue, SETTING_GROUPS, SETTING_INFO, settingFromAddress, SYSTEM_SWITCHES, systemSwitchGroups, type Setting, type SystemSwitchKey } from "../../../shared/settings-view";

const SETTINGS_ICONS: Record<Setting, typeof Settings2> = { Profil: UserRound, Passwort: KeyRound, Branding: Palette, "Rechnung & Rechtliches": Receipt, Nutzungsbedingungen: FileText, System: Settings2, Reklamationen: ShieldQuestion, "E-Mail-Versand": Send, Integrationen: Cable, "API-Dokumentation": Code2 };
/** Breite Bereiche bringen ihren eigenen Seitenkopf mit – sie stehen über die ganze Breite, darüber die Zurück-Leiste. */
const WIDE: ReadonlySet<Setting> = new Set<Setting>(["API-Dokumentation", "Integrationen", "Rechnung & Rechtliches", "Nutzungsbedingungen", "Reklamationen"]);

const isPhone = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 760px)").matches;
const requestedSetting = (): Setting | null => settingFromAddress(new URLSearchParams(window.location.search).get("setting"));

/** Leiste über jedem geöffneten Bereich: zurück zur Liste, Brotkrumen und ein Direktwechsel in einen anderen Bereich – ohne Umweg über die Seitenleiste oder den Browser. */
function SettingsBackBar({ active, onBack, onSwitch }: { active: Setting; onBack: () => void; onSwitch: (next: Setting) => void }) {
  return <nav className="settings-backbar" aria-label="Einstellungen">
    <button type="button" className="settings-back" onClick={onBack}><ChevronLeft className="h-4 w-4" /> Zurück zu den Einstellungen</button>
    <span className="settings-crumb"><span>Einstellungen</span><ChevronRight className="h-3.5 w-3.5" /><strong>{active}</strong></span>
    <label className="settings-jump">Bereich wechseln<select aria-label="Anderen Bereich öffnen" value={active} onChange={(event) => onSwitch(event.target.value as Setting)}>{SETTING_GROUPS.map((group) => <optgroup key={group.label} label={group.label}>{group.items.map((item) => <option key={item} value={item}>{item}</option>)}</optgroup>)}</select></label>
  </nav>;
}

/** Ein Kasten innerhalb eines Bereichs: Überschrift, eine Zeile dazu, Inhalt. */
function Card({ title, hint, className = "", children }: { title: string; hint?: ReactNode; className?: string; children: ReactNode }) {
  return <section className={`st-card ${className}`.trim()}><h3 className="fx-h is-sub">{title}</h3>{hint ? <p className="st-hint">{hint}</p> : null}{children}</section>;
}

/** Einstellungen → Profil: eigenes Profilbild hochladen oder entfernen. */
function OwnAvatarSettings() {
  const me = trpc.auth.me.useQuery(undefined, { retry: false }); const own = useOwnAvatar();
  const user = me.data as ({ name?: string | null; email?: string | null; avatarUrl?: string | null } | null | undefined);
  const initials = (user?.name ?? user?.email ?? "?").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return <Card title="Profilbild" hint="Dein Bild erscheint oben rechts, in der Benutzerliste und bei deinen Karten in der Vertriebspipeline." className="settings-avatar"><AvatarUpload initials={initials} avatarUrl={user?.avatarUrl ?? null} onPick={own.set} onRemove={own.remove} busy={own.busy} /></Card>;
}

function ProfileSection() {
  const me = trpc.auth.me.useQuery(undefined, { retry: false }); const user = me.data as ({ name?: string | null; email?: string | null } | null | undefined);
  return <div className="st-stack">
    <OwnAvatarSettings />
    <AppearanceSettings />
    <Card title="Name und E-Mail-Adresse" hint="Beides steht bei deinem Eintrag unter „Benutzer“ – dort im Reiter „Stammdaten“.">
      <div className="st-facts"><span><small>Name</small><b>{user?.name || "–"}</b></span><span><small>E-Mail-Adresse</small><b>{user?.email || "–"}</b></span><Button type="button" variant="outline" size="sm" onClick={() => openInApp("/?page=Benutzer")}><Users aria-hidden="true" /> Benutzer öffnen</Button></div>
    </Card>
  </div>;
}

/** Einstellungen → Passwort: ändert wirklich das Passwort des eigenen Zugangs (derselbe Weg wie „Passwort ändern“ im Profil-Menü). */
function PasswordSection() {
  const [current, setCurrent] = useState(""); const [next, setNext] = useState(""); const [repeat, setRepeat] = useState(""); const [tried, setTried] = useState(false);
  const change = trpc.auth.changePassword.useMutation({ onSuccess: () => { toast.success("Passwort geändert."); setCurrent(""); setNext(""); setRepeat(""); setTried(false); }, onError: (error) => toast.error(error.message) });
  const issue = passwordIssue(current, next, repeat);
  const submit = (event: FormEvent) => { event.preventDefault(); setTried(true); if (issue) return; change.mutate({ currentPassword: current, newPassword: next }); };
  return <form className="st-form st-password" onSubmit={submit} aria-label="Passwort ändern">
    <label className="rd-field"><span>Aktuelles Passwort</span><input className="fx-field" type="password" value={current} onChange={(event) => setCurrent(event.target.value)} autoComplete="current-password" /></label>
    <label className="rd-field"><span>Neues Passwort</span><input className="fx-field" type="password" value={next} onChange={(event) => setNext(event.target.value)} autoComplete="new-password" /></label>
    <label className="rd-field"><span>Neues Passwort wiederholen</span><input className="fx-field" type="password" value={repeat} onChange={(event) => setRepeat(event.target.value)} autoComplete="new-password" /></label>
    <p className="st-hint">Mindestens 10 Zeichen, mit Buchstaben und mindestens einer Ziffer.</p>
    {tried && issue && <p className="st-issue" role="alert">{issue}</p>}
    <div className="st-foot"><span /><Button type="submit" className="flux-button" disabled={change.isPending}><KeyRound aria-hidden="true" /> {change.isPending ? "Wird geändert …" : "Passwort ändern"}</Button></div>
  </form>;
}

type SystemState = Record<SystemSwitchKey, boolean>;
const systemOf = (saved: Record<string, unknown> | null | undefined): SystemState => ({ fifo: saved?.distributionOrder !== "lifo", preping: Boolean(saved?.incomingPrePing ?? false), skipEmpty: Boolean(saved?.skipEmptyApiFields ?? false), duplicate: Boolean(saved?.outgoingDuplicateProtection ?? true), uploadUpdate: saved?.uploadDuplicateMode !== "ueberspringen" });

/** Einstellungen → System: wie Leads verteilt und übergeben werden und was mit doppelten Kontakten passiert. */
function SystemSection() {
  const utils = trpc.useUtils();
  const { data } = trpc.leadops.getTenantSettings.useQuery();
  const saved = useMemo(() => systemOf(data?.settings as Record<string, unknown> | null | undefined), [data]);
  const [state, setState] = useState<SystemState>(saved);
  useEffect(() => { setState(saved); }, [saved]);
  const update = trpc.leadops.updateTenantSettings.useMutation({ onSuccess: () => { toast.success("System wurde gespeichert."); void utils.leadops.getTenantSettings.invalidate(); }, onError: (error) => toast.error(error.message) });
  const dirty = SYSTEM_SWITCHES.some((item) => state[item.key] !== saved[item.key]);
  const save = () => update.mutate({ distributionOrder: state.fifo ? "fifo" : "lifo", incomingPrePing: state.preping, skipEmptyApiFields: state.skipEmpty, outgoingDuplicateProtection: state.duplicate, uploadDuplicateMode: state.uploadUpdate ? "aktualisieren" : "ueberspringen" });
  return <>
    {systemSwitchGroups().map((group) => <Card key={group.group} title={group.group}>
      <ul className="st-switches">{group.items.map((item) => <li key={item.key}><label htmlFor={`st-switch-${item.key}`}><b>{item.title}</b><small>{item.text}</small></label><Switch id={`st-switch-${item.key}`} checked={state[item.key]} onCheckedChange={(checked) => setState((value) => ({ ...value, [item.key]: checked }))} aria-label={item.title} /></li>)}</ul>
    </Card>)}
    <div className="st-foot"><span>{dirty ? "Es gibt ungespeicherte Änderungen." : "Alles gespeichert."}</span><Button className="flux-button" onClick={save} disabled={!dirty || update.isPending}><Save aria-hidden="true" /> {update.isPending ? "Speichert …" : "Änderungen speichern"}</Button></div>
  </>;
}

type Branding = { name: string; primaryColor: string; supportEmail: string; senderName: string; logoUrl: string | null; companyFooter: string; websiteUrl: string; appointmentUrl: string };
const BRAND_COLORS = ["#8178ff", "#5b53d8", "#2563eb", "#0ea5e9", "#0f9d7a", "#22c55e", "#f59e0b", "#f97316", "#ba160e", "#ec4899", "#111318", "#64748b"];

/** Einstellungen → Branding: Logo, Name, Farbe und die Fußzeile der E-Mails. */
function BrandingSection() {
  const utils = trpc.useUtils();
  const { data } = trpc.leadops.getTenantSettings.useQuery();
  const saved = useMemo<Branding>(() => { const tenant = data?.tenant; const own = data?.settings as { supportEmail?: string | null; senderName?: string | null; companyFooter?: string | null; websiteUrl?: string | null; appointmentUrl?: string | null } | null | undefined; return { name: tenant?.name || "Tanesco Leads", primaryColor: tenant?.primaryColor || "#8178ff", supportEmail: own?.supportEmail || "support@tanesco-leads.example", senderName: own?.senderName || tenant?.name || "Tanesco Leads", logoUrl: (tenant as { logoUrl?: string | null } | undefined)?.logoUrl ?? null, companyFooter: own?.companyFooter || COMPANY_FOOTER, websiteUrl: own?.websiteUrl || COMPANY_WEBSITE, appointmentUrl: own?.appointmentUrl || "" }; }, [data]);
  const [branding, setBranding] = useState<Branding>(saved);
  useEffect(() => { setBranding(saved); }, [saved]);
  const set = <K extends keyof Branding>(key: K, value: Branding[K]) => setBranding((current) => ({ ...current, [key]: value }));
  const refresh = () => void utils.leadops.getTenantSettings.invalidate();
  const updateSettings = trpc.leadops.updateTenantSettings.useMutation({ onError: (error) => toast.error(error.message) });
  const updateBranding = trpc.leadops.updateTenantBranding.useMutation({ onSuccess: () => { toast.success("Branding wurde gespeichert."); refresh(); }, onError: (error) => toast.error(error.message) });
  const applyFooter = trpc.leadops.applyFooterToCampaigns.useMutation({ onSuccess: (result) => toast.success(result.updated ? `Fußzeile in ${result.updated} ${result.updated === 1 ? "Kampagne" : "Kampagnen"} übernommen.` : "Alle Kampagnen hatten die Fußzeile schon."), onError: (error) => toast.error(error.message) });
  const dirty = (Object.keys(saved) as Array<keyof Branding>).some((key) => (branding[key] ?? "") !== (saved[key] ?? ""));
  const save = () => { updateSettings.mutate({ companyFooter: branding.companyFooter.trim() || null, websiteUrl: branding.websiteUrl.trim() || null, appointmentUrl: branding.appointmentUrl.trim() || null }); updateBranding.mutate({ name: branding.name, primaryColor: branding.primaryColor, supportEmail: branding.supportEmail, senderName: branding.senderName, logoUrl: branding.logoUrl }); };
  const pickLogo = (file: File | undefined) => { if (!file) return; if (file.size > 300 * 1024) { toast.error("Das Logo ist größer als 300 KB. Bitte verkleinern."); return; } const reader = new FileReader(); reader.onload = () => set("logoUrl", String(reader.result)); reader.readAsDataURL(file); };
  return <>
    <Card title="Logo" hint="PNG, JPG, SVG oder WebP, am besten quer und mit durchsichtigem Hintergrund (bis 300 KB). Erscheint in der Seitenleiste und in E-Mails.">
      <div className="st-logo"><div className="st-logo-box">{branding.logoUrl ? <img src={branding.logoUrl} alt="Logo" /> : <span>Kein Logo</span>}</div>
        <label className="st-upload"><span><Upload aria-hidden="true" /> Logo hochladen</span><input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="sr-only" onChange={(event) => { pickLogo(event.target.files?.[0]); event.target.value = ""; }} /></label>
        {branding.logoUrl && <Button type="button" variant="ghost" size="sm" onClick={() => set("logoUrl", null)}>Logo entfernen</Button>}</div>
    </Card>
    <Card title="Name und Farbe">
      <div className="st-fields">
        <label className="rd-field"><span>Name der Software</span><input className="fx-field" value={branding.name} onChange={(event) => set("name", event.target.value)} /></label>
        <div className="rd-field"><span>Farbe</span><div className="st-colors">{BRAND_COLORS.map((color) => <button key={color} type="button" aria-label={`Farbe ${color}`} aria-pressed={branding.primaryColor.toLowerCase() === color} className={branding.primaryColor.toLowerCase() === color ? "swatch-selected" : ""} style={{ backgroundColor: color }} onClick={() => set("primaryColor", color)} />)}<label className="st-color-own" title="Eigene Farbe"><Palette aria-hidden="true" /><input type="color" className="sr-only" value={/^#[0-9A-Fa-f]{6}$/.test(branding.primaryColor) ? branding.primaryColor : "#8178ff"} onChange={(event) => set("primaryColor", event.target.value)} /></label><input className="fx-field st-color-code" value={branding.primaryColor} onChange={(event) => set("primaryColor", event.target.value)} aria-label="Farbwert" /></div></div>
        <label className="rd-field"><span>E-Mail-Adresse für Rückfragen (Support)</span><input className="fx-field" type="email" value={branding.supportEmail} onChange={(event) => set("supportEmail", event.target.value)} /></label>
        <label className="rd-field"><span>Absendername</span><input className="fx-field" value={branding.senderName} onChange={(event) => set("senderName", event.target.value)} /></label>
      </div>
    </Card>
    <Card title="Fußzeile der E-Mails" hint="Steht unter jeder E-Mail – in Kampagnen, Einzel-E-Mails und Systemmails. Webseite und Terminlink werden automatisch anklickbar.">
      <div className="st-fields is-three">
        <label className="rd-field"><span>Anschrift</span><input className="fx-field" value={branding.companyFooter} placeholder={COMPANY_FOOTER} onChange={(event) => set("companyFooter", event.target.value)} /></label>
        <label className="rd-field"><span>Webseite</span><input className="fx-field" value={branding.websiteUrl} placeholder={COMPANY_WEBSITE} onChange={(event) => set("websiteUrl", event.target.value)} /></label>
        <label className="rd-field"><span>Terminlink</span><input className="fx-field" value={branding.appointmentUrl} placeholder="z. B. cal.com/tanesco" onChange={(event) => set("appointmentUrl", event.target.value)} /></label>
      </div>
      <div className="st-apply"><Button type="button" size="sm" variant="outline" disabled={applyFooter.isPending || dirty} onClick={() => applyFooter.mutate({})}>{applyFooter.isPending ? "Wird übernommen …" : "Auf bestehende Kampagnen übernehmen"}</Button><small>{dirty ? "Erst speichern – der Knopf nutzt den gespeicherten Stand." : "Neue Kampagnen übernehmen die Fußzeile von selbst. Der Knopf setzt sie auch in allen Kampagnen, die es schon gibt – eigene Fußzeilen werden dabei ersetzt."}</small></div>
    </Card>
    <div className="st-foot"><span>{dirty ? "Es gibt ungespeicherte Änderungen." : "Alles gespeichert."}</span><Button className="flux-button" onClick={save} disabled={!dirty || updateSettings.isPending || updateBranding.isPending}><Save aria-hidden="true" /> {updateBranding.isPending ? "Speichert …" : "Änderungen speichern"}</Button></div>
  </>;
}

/** Einstellungen → Reklamationen: die Gründe, aus denen ein Käufer reklamieren kann – Name, Reihenfolge, was danach mit dem Lead passiert. */
function ReasonsSection() {
  const reasons = trpc.leadops.listReclamationReasons.useQuery(undefined, { retry: false });
  const [name, setName] = useState("");
  const refetch = () => void reasons.refetch();
  const create = trpc.leadops.createReclamationReason.useMutation({ onSuccess: () => { refetch(); setName(""); toast.success("Reklamationsgrund angelegt."); }, onError: (error) => toast.error(error.message) });
  const update = trpc.leadops.updateReclamationReason.useMutation({ onSuccess: refetch, onError: (error) => toast.error(error.message) });
  const rows = reasons.data ?? [];
  const add = (event: FormEvent) => { event.preventDefault(); const clean = name.trim(); if (clean.length < 2) return void toast.error("Bitte einen Grund eintragen (mindestens zwei Zeichen)."); if (rows.some((row) => row.name.trim().toLowerCase() === clean.toLowerCase())) return void toast.error("Diesen Grund gibt es schon."); create.mutate({ name: clean, forwardToSupplier: false, sortOrder: rows.reduce((max, row) => Math.max(max, row.sortOrder + 1), 0) }); };
  const move = (id: number, step: -1 | 1) => { for (const change of movedReasons(rows, id, step)) update.mutate(change); };
  const active = rows.filter((row) => row.active).length;
  return <div className="fx-scope tg st-reasons">
    <header className="page-intro compact"><div><span className="eyebrow">EINSTELLUNGEN</span><h1>Reklamationsgründe</h1><p>Aus diesen Gründen kann ein Käufer einen Lead reklamieren. Du legst fest, wie sie heißen, in welcher Reihenfolge sie zur Auswahl stehen – und ob der Lead danach an die nächste Station der Lieferkette geht.</p></div></header>
    <section className="tg-list" aria-label="Reklamationsgründe">
      <div className="tg-list-head"><div><h2>Gründe</h2><p>{reasons.data ? `${active} von ${rows.length} stehen zur Auswahl.` : "Wird geladen …"}</p></div></div>
      <form className="st-reason-add" onSubmit={add}><input className="fx-field" value={name} onChange={(event) => setName(event.target.value)} placeholder="Neuer Grund, z. B. Falsche Telefonnummer" maxLength={160} aria-label="Neuer Reklamationsgrund" /><Button type="submit" className="flux-button" disabled={create.isPending}><Plus aria-hidden="true" /> Grund anlegen</Button></form>
      {reasons.isLoading ? <p className="tg-note">Gründe werden geladen …</p> : !rows.length ? <p className="tg-note">Noch kein Grund angelegt. Die Standard-Gründe kommen dazu, sobald du die erste Lieferkette einrichtest – oder du legst hier eigene an.</p> : <>
        <div className="st-reason-head" aria-hidden="true"><span>Reihenfolge</span><span>Grund</span><span>Lead geht an die nächste Station</span><span>Zur Auswahl</span></div>
        <ul className="st-reason-rows">{rows.map((reason, index) => <li key={reason.id} className={reason.active ? "" : "is-off"}>
          <span className="st-reason-move"><button type="button" aria-label={`${reason.name} nach oben`} title="Nach oben" disabled={index === 0 || update.isPending} onClick={() => move(reason.id, -1)}><ArrowUp aria-hidden="true" /></button><button type="button" aria-label={`${reason.name} nach unten`} title="Nach unten" disabled={index === rows.length - 1 || update.isPending} onClick={() => move(reason.id, 1)}><ArrowDown aria-hidden="true" /></button></span>
          <span className="st-reason-name"><input className="fx-field" defaultValue={reason.name} key={`${reason.id}:${reason.name}`} maxLength={160} onBlur={(event) => { const next = event.target.value.trim(); if (next.length >= 2 && next !== reason.name) update.mutate({ id: reason.id, name: next }); else event.target.value = reason.name; }} onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }} aria-label={`Bezeichnung ${reason.name}`} /><small>{reason.systemReason ? "Standard-Grund" : "Eigener Grund"}{reason.description ? ` · ${reason.description}` : ""}</small></span>
          <label className="st-reason-switch" title="An: Wird eine Reklamation mit diesem Grund genehmigt, bekommt die nächste Station der Lieferkette den Lead. Aus: Der Lead endet hier. Eine Station kann das für sich anders regeln."><Switch checked={reason.forwardToNextStop ?? true} onCheckedChange={(forwardToNextStop) => update.mutate({ id: reason.id, forwardToNextStop })} aria-label={`${reason.name}: Lead geht an die nächste Station`} /><small>{(reason.forwardToNextStop ?? true) ? "geht weiter" : "endet hier"}</small></label>
          <label className="st-reason-switch" title="Aus: Der Grund steht nicht mehr zur Auswahl – bestehende Reklamationen behalten ihn."><Switch checked={reason.active} onCheckedChange={(next) => update.mutate({ id: reason.id, active: next })} aria-label={`${reason.name}: zur Auswahl`} /><small>{reason.active ? "wählbar" : "ausgeblendet"}</small></label>
        </li>)}</ul>
      </>}
    </section>
    <p className="ko-good"><b>Gut zu wissen:</b> Was hier steht, gilt als Voreinstellung. In der Lieferkette kannst du bei jeder Station unter „Wenn der Kunde reklamiert“ für einzelne Gründe etwas anderes festlegen.</p>
  </div>;
}

export default function SettingsWorkspace() {
  const [active, setActive] = useState<Setting>(() => requestedSetting() ?? "Profil");
  // Handy: zuerst nur die Liste, nach dem Antippen der Bereich (mit „Zurück“); am Computer stehen Liste und Bereich nebeneinander.
  const [showList, setShowList] = useState<boolean>(() => !(requestedSetting() && isPhone()));
  const open = (next: Setting) => { setActive(next); setShowList(false); const params = new URLSearchParams(window.location.search); params.set("page", "Einstellungen"); params.set("setting", next); window.history.pushState(null, "", `/?${params.toString()}`); };
  // Zurück = Liste der Einstellungen: am Handy nur die Liste, am Computer Liste + erster Bereich („Profil“) – die Adresse wird mitgeführt, damit auch der Browser-Zurück-Pfeil stimmt.
  const backToList = () => { setShowList(true); setActive("Profil"); const params = new URLSearchParams(window.location.search); params.set("page", "Einstellungen"); params.delete("setting"); window.history.pushState(null, "", `/?${params.toString()}`); window.scrollTo({ top: 0 }); };
  useEffect(() => { const onPop = () => { const next = requestedSetting(); if (next) { setActive(next); setShowList(false); } else { setActive("Profil"); setShowList(true); } }; window.addEventListener("popstate", onPop); return () => window.removeEventListener("popstate", onPop); }, []);
  // Beim Drehen des Handys oder Verkleinern des Fensters neu zeichnen, damit Liste und Zurück-Leiste zur Breite passen.
  const [, relayout] = useReducer((count: number) => count + 1, 0);
  useEffect(() => { window.addEventListener("resize", relayout); return () => window.removeEventListener("resize", relayout); }, []);
  const phoneList = showList && isPhone(); // Handy, Liste sichtbar → der Bereich bleibt ausgeblendet

  const backBar = <SettingsBackBar active={active} onBack={backToList} onSwitch={open} />;
  // Breite Bereiche (eigene Seitenköpfe, Karten, Tabellen): Zurück-Leiste + Inhalt über die ganze Breite, die Liste links
  // ist dabei ausgeblendet – ohne die Leiste käme man nicht mehr zur Liste zurück. Am Handy erst nach dem Antippen in der Liste.
  if (!phoneList && WIDE.has(active)) return <div className="fx-scope st is-wide">{backBar}{active === "API-Dokumentation" ? <><ApiTokenPanel /><ApiDocsPanel /></> : active === "Integrationen" ? <><IntegrationPanel /><PartnerAccountsPanel /></> : active === "Rechnung & Rechtliches" ? <LegalSettingsPanel /> : active === "Nutzungsbedingungen" ? <TermsPanel /> : <ReasonsSection />}</div>;

  // Liste + Bereich nebeneinander (Computer) – die Zurück-Leiste braucht es nur am Handy, wo der Bereich die Liste verdeckt.
  return <div className="fx-scope st">{phoneList ? <header className="page-intro compact"><div><span className="eyebrow block">ORGANISATION</span><h1>Einstellungen</h1><p>Tippe einen Bereich an – oben links geht es jeweils zurück zur Liste.</p></div></header> : isPhone() ? backBar : null}
    <section className={`settings-layout st-layout ${phoneList ? "is-list" : "is-detail"}`}>
      <aside className="st-menu settings-list" aria-label="Bereiche der Einstellungen">{SETTING_GROUPS.map((group) => <div key={group.label} className="st-group"><span className="st-group-label">{group.label}</span>{group.items.map((item) => { const Icon = SETTINGS_ICONS[item]; return <button key={item} type="button" onClick={() => open(item)} aria-current={active === item && !phoneList ? "page" : undefined} className={`settings-tab ${active === item && !phoneList ? "active" : ""}`}><Icon className="settings-tab-icon" aria-hidden="true" /><span>{item}</span><ChevronRight className="settings-tab-arrow" aria-hidden="true" /></button>; })}</div>)}</aside>
      {!phoneList && <section className="st-panel settings-detail" aria-label={active}>
        <header className="st-panel-head"><h2>{active}</h2><p>{SETTING_INFO[active]}</p></header>
        {active === "Profil" ? <ProfileSection /> : active === "Passwort" ? <PasswordSection /> : active === "System" ? <SystemSection /> : active === "Branding" ? <BrandingSection /> : <MailSettingsPanel />}
      </section>}
    </section>
  </div>;
}
