import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { confirmAction } from "@/lib/confirm";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import { BarChart3, Plus, Save, Trash2 } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { toast } from "sonner";
import type { AppRouter } from "../../../server/routers";
import { PARTNER_PROVIDERS, providerName } from "../../../shared/partner-report";

type Accounts = inferRouterOutputs<AppRouter>["leadops"]["listPartnerAccounts"];
type PlatformKey = "leadnodes" | "enpal" | "gohighlevel";
const BRAND: Record<string, string> = { aroundhome: "#f97316", wattfox: "#eab308", leadnodes: "#0ea5e9", enpal: "#22c55e", gohighlevel: "#6366f1" };
const MODE_TEXT = { pull: "Wir rufen den Status ab", push: "Der Partner meldet den Status selbst", none: "Rückkanal folgt" } as const;

/**
 * Plattformen für die Statistik „Integrationen“: welches Konto über welchen Käufer beliefert wird – und Konten bei weiteren Plattformen
 * (Leadnodes, Enpal, GoHighLevel). Ein Token ist nur schreibbar: gespeichert erscheint er gekürzt, ein leeres Feld lässt ihn stehen.
 */
export default function PartnerPlatforms({ data, onDone }: { data: Accounts; onDone: () => void }) {
  const members = trpc.leadops.listMembers.useQuery(undefined, { retry: false });
  const buyers = (members.data ?? []).filter((member) => member.status === "aktiv" && (member as { partnerType?: string }).partnerType !== "lieferant");
  const onError = (error: { message: string }) => toast.error(error.message);
  const update = trpc.leadops.updatePartnerAccount.useMutation({ onSuccess: () => { toast.success("Käufer gespeichert."); onDone(); }, onError });
  const save = trpc.leadops.savePlatformAccount.useMutation({ onSuccess: () => { toast.success("Konto gespeichert."); setDraft(null); onDone(); }, onError });
  const remove = trpc.leadops.deletePartnerAccount.useMutation({ onSuccess: () => { toast.success("Konto entfernt."); onDone(); }, onError });
  const [draft, setDraft] = useState<{ id?: number; provider: PlatformKey; label: string; token: string; buyerUserId: number | null } | null>(null);
  const existing = [...data.aroundhome.map((account) => ({ id: account.id, provider: "aroundhome", label: account.label })), ...data.wattfox.map((account) => ({ id: account.id, provider: "wattfox", label: account.label }))];
  const buyerSelect = (value: number | null, onChange: (next: number | null) => void, label: string) => <select aria-label={label} className="filter-select pp-buyer" value={value ?? ""} onChange={(event) => onChange(Number(event.target.value) || null)}><option value="">Käufer wählen …</option>{buyers.map((buyer) => <option key={buyer.userId} value={buyer.userId}>{buyer.name ?? buyer.email ?? `Käufer #${buyer.userId}`}</option>)}</select>;
  return <section className="surface-panel operations-panel fx-scope pp" aria-label="Plattformen für die Statistik">
    <header className="pp-head"><div><span className="eyebrow">PLATTFORMEN · STATISTIK „INTEGRATIONEN“</span><h3>Welches Konto wird über welchen Käufer beliefert?</h3><p>Die Statistik zeigt je Konto, was aus den gelieferten Leads wurde. Dafür muss sie wissen, über welchen Käufer das Konto seine Leads bekommt. Ohne Angabe erkennt die Software es an der Schnittstelle (Vorlage oder Adresse).</p></div><a className="pp-link" href="/?page=Statistik&view=Integrationen"><BarChart3 aria-hidden="true" /> Zur Statistik</a></header>
    {existing.length > 0 && <ul className="pp-list">{existing.map((account) => <li key={account.id} style={{ "--brand": BRAND[account.provider] } as CSSProperties}><span className="pp-mark" aria-hidden="true">{providerName(account.provider).slice(0, 2)}</span><div><b>{providerName(account.provider)}{account.label && account.label.toLowerCase() !== providerName(account.provider).toLowerCase() ? ` (${account.label})` : ""}</b><small>{MODE_TEXT[PARTNER_PROVIDERS.find((item) => item.key === account.provider)?.mode ?? "none"]}</small></div>{buyerSelect(data.buyerOf[account.id] ?? null, (next) => update.mutate({ id: account.id, buyerUserId: next }), `Käufer für ${providerName(account.provider)} ${account.label}`)}</li>)}</ul>}
    <div className="pp-grid">{PARTNER_PROVIDERS.filter((item): item is typeof item & { key: PlatformKey } => ["leadnodes", "enpal", "gohighlevel"].includes(item.key)).map((platform) => { const accounts = data.platforms.filter((account) => account.provider === platform.key); return <article key={platform.key} className="pp-card" style={{ "--brand": BRAND[platform.key] } as CSSProperties}>
      <div className="pp-card-head"><span className="pp-mark" aria-hidden="true">{platform.name.slice(0, 2)}</span><div><b>{platform.name}</b><small>{MODE_TEXT[platform.mode]}</small></div></div>
      <p>{platform.about}</p>
      {accounts.map((account) => <div key={account.id} className="pp-account"><div><b>{account.label || platform.name}</b><small>{account.token ? `Token ${account.token}` : "noch kein Token"} · {buyers.find((buyer) => buyer.userId === account.buyerUserId)?.name ?? "kein Käufer gewählt"}</small></div><span><Button size="sm" variant="ghost" onClick={() => setDraft({ id: account.id, provider: platform.key, label: account.label, token: account.token, buyerUserId: account.buyerUserId })}>Bearbeiten</Button><Button size="icon" variant="ghost" aria-label={`${platform.name}-Konto ${account.label} entfernen`} onClick={async () => { if (await confirmAction(`Konto „${account.label || platform.name}“ entfernen? Es verschwindet auch aus der Statistik.`, { danger: true })) remove.mutate({ id: account.id }); }}><Trash2 className="h-4 w-4" /></Button></span></div>)}
      {draft?.provider === platform.key ? <form className="pp-form" onSubmit={(event) => { event.preventDefault(); save.mutate(draft); }}>
        <label>Bezeichnung<Input value={draft.label} placeholder={`z. B. ${platform.name} Hauptkonto`} onChange={(event) => setDraft({ ...draft, label: event.target.value })} /></label>
        <label>API-Token<Input value={draft.token} autoComplete="off" spellCheck={false} placeholder="Token einfügen" onFocus={() => { if (draft.token.startsWith("••••")) setDraft({ ...draft, token: "" }); }} onChange={(event) => setDraft({ ...draft, token: event.target.value })} /><small>Gespeichert erscheint er gekürzt. Leer lassen = der gespeicherte Token bleibt.</small></label>
        <label>Käufer{buyerSelect(draft.buyerUserId, (next) => setDraft({ ...draft, buyerUserId: next }), `Käufer für ${platform.name}`)}</label>
        <div className="pp-form-foot"><Button type="button" variant="ghost" onClick={() => setDraft(null)}>Abbrechen</Button><Button type="submit" className="flux-button" disabled={save.isPending}><Save /> {save.isPending ? "Speichert …" : "Konto speichern"}</Button></div>
      </form> : <Button variant="outline" size="sm" className="pp-add" onClick={() => setDraft({ provider: platform.key, label: "", token: "", buyerUserId: null })}><Plus /> {accounts.length ? "Weiteres Konto hinzufügen" : "Konto anlegen"}</Button>}
    </article>; })}</div>
  </section>;
}
