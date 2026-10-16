import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { Pause, Play, Plus, UserRoundPlus, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

/**
 * Vertriebler verwalten: wer gehört zum Vertrieb, wer hat einen eigenen Zugang, wer ist pausiert – neue anlegen (mit
 * oder ohne Login), umbenennen, pausieren. Fehlen noch alle, legt ein Knopf Taner und Francesco an.
 */
export default function SalesRepsPanel({ compact = false }: { compact?: boolean }) {
  const reps = trpc.leadops.listSalesReps.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const refresh = () => { utils.leadops.listSalesReps.invalidate(); utils.leadops.pipelineOwners.invalidate(); utils.leadops.pipelineTeamOverview.invalidate(); };
  const create = trpc.leadops.createSalesRep.useMutation({ onSuccess: (result) => { toast.success(result.created ? `Vertriebler angelegt${result.hasLogin ? " – mit eigenem Zugang" : " – ohne Login, Karten lassen sich trotzdem zuteilen"}.` : "Benutzer ist jetzt Vertriebler."); setForm({ name: "", email: "", password: "" }); setAdding(false); refresh(); }, onError: (error) => toast.error(error.message) });
  const updateRep = trpc.leadops.updateSalesRep.useMutation({ onSuccess: () => { setRenaming(null); refresh(); }, onError: (error) => toast.error(error.message) });
  const ensure = trpc.leadops.ensureDefaultSalesReps.useMutation({ onSuccess: (result) => { toast.success(result.created.length ? `${result.created.join(" und ")} angelegt.` : "Taner und Francesco gibt es schon."); refresh(); }, onError: (error) => toast.error(error.message) });
  const [adding, setAdding] = useState(false); const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [renaming, setRenaming] = useState<{ userId: number; name: string } | null>(null);
  const list = reps.data ?? []; const missingDefaults = ["Taner", "Francesco"].filter((name) => !list.some((rep) => rep.firstName.toLowerCase() === name.toLowerCase()));
  return <section className={`surface-panel operations-panel sales-reps ${compact ? "is-compact" : "p-5"}`}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><span className="eyebrow">VERTRIEBLER</span><h2 className="mt-1 text-lg text-slate-100"><Users className="inline h-4 w-4" aria-hidden="true" /> Wer telefoniert und bekommt Karten</h2><p className="text-xs text-slate-500">Vertriebler bekommen Kontakte aus Listen, Karten in der Pipeline, Termine und Tagesziele. Ohne E-Mail und Passwort hat ein Vertriebler keinen eigenen Login – zuteilen und auswerten geht trotzdem. Mit E-Mail und Passwort meldet er sich selbst an (Rolle „Vertriebler“).</p></div>
      <div className="flex flex-wrap gap-2">{missingDefaults.length > 0 && <Button variant="outline" size="sm" disabled={ensure.isPending} onClick={() => ensure.mutate()}><UserRoundPlus className="h-4 w-4" /> {missingDefaults.join(" und ")} anlegen</Button>}<Button className="flux-button" size="sm" onClick={() => setAdding((value) => !value)}><Plus className="h-4 w-4" /> Neuer Vertriebler</Button></div></div>
    {adding && <div className="sales-rep-form"><Input placeholder="Name *" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /><Input type="email" placeholder="E-Mail (optional – für eigenen Zugang)" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /><Input type="password" placeholder="Passwort (optional, mind. 8 Zeichen)" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /><div className="flex gap-2"><Button className="flux-button" size="sm" disabled={create.isPending || form.name.trim().length < 2} onClick={() => create.mutate({ name: form.name.trim(), email: form.email.trim() || null, password: form.password || null })}>{create.isPending ? "Legt an …" : "Anlegen"}</Button><Button variant="ghost" size="sm" onClick={() => setAdding(false)}>Abbrechen</Button></div></div>}
    {reps.isLoading ? <p className="mt-4 text-sm text-slate-500">Lädt …</p> : !list.length ? <div className="owners-missing mt-4"><strong>Noch keine Vertriebler angelegt</strong><p>Mit „{missingDefaults.join(" und ")} anlegen“ sind die beiden sofort da – oder lege über „Neuer Vertriebler“ jemand anderen an. Danach kannst du hochgeladene Listen prozentual oder nach Anzahl verteilen.</p></div> : <ul className="sales-rep-list mt-4">
      {list.map((rep) => <li key={rep.userId} className={`sales-rep ${rep.active ? "" : "is-paused"}`}>
        <span className="sales-rep-avatar" aria-hidden="true">{rep.initials}</span>
        <span className="sales-rep-main">{renaming?.userId === rep.userId ? <span className="flex flex-wrap items-center gap-2"><Input className="h-8 w-48" value={renaming.name} autoFocus onChange={(event) => setRenaming({ userId: rep.userId, name: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter") updateRep.mutate({ userId: rep.userId, name: renaming.name }); if (event.key === "Escape") setRenaming(null); }} /><Button size="sm" variant="outline" disabled={updateRep.isPending} onClick={() => updateRep.mutate({ userId: rep.userId, name: renaming.name })}>Speichern</Button><Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>Abbrechen</Button></span> : <><strong>{rep.name}</strong><small>{rep.email ? rep.email : "ohne eigenen Zugang"}{rep.hasLogin ? " · kann sich anmelden" : ""}{!rep.active ? " · pausiert" : ""}</small></>}</span>
        <span className="sales-rep-stats" title="Offene Karten · gewonnene Karten"><b>{rep.openCards}</b> offen · <b>{rep.wonCards}</b> gewonnen</span>
        <span className="sales-rep-actions">{renaming?.userId !== rep.userId && <Button size="sm" variant="ghost" onClick={() => setRenaming({ userId: rep.userId, name: rep.name })}>Umbenennen</Button>}<Button size="sm" variant="ghost" title={rep.active ? "Pausieren – bekommt keine neuen Karten, behält seine" : "Wieder aktivieren"} disabled={updateRep.isPending} onClick={() => updateRep.mutate({ userId: rep.userId, active: !rep.active })}>{rep.active ? <><Pause className="h-3.5 w-3.5" /> Pausieren</> : <><Play className="h-3.5 w-3.5" /> Aktivieren</>}</Button></span>
      </li>)}
    </ul>}
  </section>;
}
