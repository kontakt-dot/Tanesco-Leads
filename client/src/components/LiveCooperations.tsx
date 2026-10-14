import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { Plus, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

export default function LiveCooperations() {
  const utils = trpc.useUtils();
  const cooperations = trpc.leadops.listCooperations.useQuery(undefined, { retry: false });
  const categories = trpc.leadops.listCategories.useQuery(undefined, { retry: false });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [categoryId, setCategoryId] = useState("");
  const [partnerCategoryName, setPartnerCategoryName] = useState("");
  const [sourceField, setSourceField] = useState("");
  const [partnerField, setPartnerField] = useState("");
  const [partnerName, setPartnerName] = useState("");
  const [direction, setDirection] = useState<"eingehend" | "ausgehend" | "beidseitig">("ausgehend");
  const [partnerTenantId, setPartnerTenantId] = useState("");
  const selected = useMemo(() => cooperations.data?.find((item) => item.id === selectedId) ?? null, [cooperations.data, selectedId]);
  useEffect(() => { if (!selectedId && cooperations.data?.[0]) setSelectedId(cooperations.data[0].id); }, [cooperations.data, selectedId]);
  useEffect(() => { if (selected) { setPartnerName(selected.partnerTenantName); setDirection(selected.direction); setPartnerTenantId(selected.partnerTenantId ? String(selected.partnerTenantId) : ""); } }, [selected]);
  const create = trpc.leadops.createCooperation.useMutation({ onSuccess: () => { utils.leadops.listCooperations.invalidate(); toast.success("Kooperationsanfrage angelegt."); }, onError: (error) => toast.error(error.message) });
  const update = trpc.leadops.updateCooperationStatus.useMutation({ onSuccess: () => utils.leadops.listCooperations.invalidate(), onError: (error) => toast.error(error.message) });
  const updateDetails = trpc.leadops.updateCooperation.useMutation({ onSuccess: () => { utils.leadops.listCooperations.invalidate(); toast.success("Partnerstammdaten gespeichert."); }, onError: (error) => toast.error(error.message) });
  const setCategoryMapping = trpc.leadops.setCooperationCategoryMapping.useMutation({ onSuccess: () => { utils.leadops.listCooperations.invalidate(); setPartnerCategoryName(""); toast.success("Kategorie-Mapping gespeichert."); }, onError: (error) => toast.error(error.message) });
  const setFieldMapping = trpc.leadops.setCooperationFieldMapping.useMutation({ onSuccess: () => { utils.leadops.listCooperations.invalidate(); setSourceField(""); setPartnerField(""); toast.success("Feldmapping gespeichert."); }, onError: (error) => toast.error(error.message) });
  const saveCategory = () => {
    const sourceCategoryId = Number(categoryId);
    if (!selected || !Number.isInteger(sourceCategoryId) || !partnerCategoryName.trim()) return toast.error("Wählen Sie eine Kategorie und geben Sie die Partnerkategorie ein.");
    setCategoryMapping.mutate({ cooperationId: selected.id, sourceCategoryId, partnerCategoryName: partnerCategoryName.trim() });
  };
  const saveField = () => {
    if (!selected || !sourceField.trim() || !partnerField.trim()) return toast.error("Geben Sie ein Quell- und ein Partnerfeld ein.");
    setFieldMapping.mutate({ cooperationId: selected.id, sourceField: sourceField.trim(), partnerField: partnerField.trim(), transfer: true });
  };
  const saveDetails = () => {
    if (!selected || partnerName.trim().length < 2) return toast.error("Geben Sie einen Partnernamen mit mindestens zwei Zeichen ein.");
    const parsedTenantId = partnerTenantId.trim() ? Number(partnerTenantId) : null;
    if (parsedTenantId !== null && (!Number.isInteger(parsedTenantId) || parsedTenantId <= 0)) return toast.error("Die Partner-Organisations-ID muss eine positive ganze Zahl sein.");
    updateDetails.mutate({ id: selected.id, partnerTenantName: partnerName.trim(), direction, partnerTenantId: parsedTenantId });
  };
  return <>
    <header className="page-intro compact"><div><span className="eyebrow">PARTNER NETWORK</span><h1>Kooperationen</h1><p>Steuern Sie Partnerbeziehungen, Übergaberichtung sowie Kategorie- und Feldmapping.</p></div><Button className="flux-button" onClick={() => create.mutate({ partnerTenantName: "Neue Kooperation", direction: "ausgehend" })} disabled={create.isPending}><Plus/> Kooperation anlegen</Button></header>
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,.85fr)]"><section className="surface-panel lead-panel"><div className="table-wrap"><table><thead><tr><th>Partner</th><th>Richtung</th><th>Kategorien</th><th>Feldmapping</th><th>Status</th><th>Aktion</th></tr></thead><tbody>{cooperations.data?.map((item) => <tr key={item.id} className={item.id === selectedId ? "bg-violet-500/[.06]" : ""} onClick={() => setSelectedId(item.id)}><td><strong className="text-slate-100">{item.partnerTenantName}</strong></td><td>{item.direction}</td><td>{item.categories.length}</td><td>{item.fields.length}</td><td><Badge variant="outline" className={item.status === "aktiv" ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200" : "border-red-400/25 bg-red-500/10 text-red-200"}>{item.status}</Badge></td><td><Button variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); update.mutate({ id: item.id, status: item.status === "aktiv" ? "inaktiv" : "aktiv" }); }}>{item.status === "aktiv" ? "Pausieren" : "Aktivieren"}</Button></td></tr>)}</tbody></table></div>{!cooperations.data?.length && <p className="p-6 text-center text-xs text-slate-500">Legen Sie eine Kooperation an, um Partner-Mappings zu konfigurieren.</p>}</section>
      <aside className="surface-panel lead-panel p-5"><div className="panel-title"><div><span className="eyebrow">DETAIL-EDITOR</span><h2>{selected?.partnerTenantName ?? "Kooperation auswählen"}</h2><p>{selected ? `Richtung: ${selected.direction} · Status: ${selected.status}` : "Wählen Sie eine Kooperation aus der Liste."}</p></div><SlidersHorizontal className="h-5 w-5 text-violet-300"/></div>{selected && <div className="mt-5 space-y-5"><div className="rounded-xl border border-white/7 bg-white/[.02] p-4"><h3 className="text-sm font-semibold">Partnerstammdaten</h3><div className="mt-3 grid gap-2"><Input value={partnerName} onChange={(event) => setPartnerName(event.target.value)} placeholder="Partnername"/><select className="h-9 rounded-md border border-white/10 bg-slate-900/60 px-3 text-xs text-slate-100" value={direction} onChange={(event) => setDirection(event.target.value as typeof direction)}><option value="ausgehend">Ausgehend</option><option value="eingehend">Eingehend</option><option value="beidseitig">Beidseitig</option></select><Input value={partnerTenantId} onChange={(event) => setPartnerTenantId(event.target.value)} inputMode="numeric" placeholder="Partner-Organisations-ID (optional)"/><Button variant="outline" size="sm" onClick={saveDetails} disabled={updateDetails.isPending}>Stammdaten speichern</Button></div></div><div className="rounded-xl border border-white/7 bg-white/[.02] p-4"><h3 className="text-sm font-semibold">Kategorie-Mapping</h3><div className="mt-3 grid gap-2"><select className="h-9 rounded-md border border-white/10 bg-slate-900/60 px-3 text-xs text-slate-100" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Quellkategorie wählen</option>{categories.data?.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select><Input value={partnerCategoryName} onChange={(event) => setPartnerCategoryName(event.target.value)} placeholder="Kategorie beim Partner"/><Button variant="outline" size="sm" onClick={saveCategory} disabled={setCategoryMapping.isPending}>Kategorie zuordnen</Button></div>{selected.categories.length > 0 && <div className="mt-3 space-y-1 text-xs text-slate-400">{selected.categories.map((mapping) => <p key={mapping.id}>Kategorie #{mapping.sourceCategoryId} → <strong className="text-slate-200">{mapping.partnerCategoryName}</strong></p>)}</div>}</div><div className="rounded-xl border border-white/7 bg-white/[.02] p-4"><h3 className="text-sm font-semibold">Feldmapping</h3><div className="mt-3 grid gap-2"><Input value={sourceField} onChange={(event) => setSourceField(event.target.value)} placeholder="Quellfeld, z. B. phone"/><Input value={partnerField} onChange={(event) => setPartnerField(event.target.value)} placeholder="Partnerfeld, z. B. telefonnummer"/><Button variant="outline" size="sm" onClick={saveField} disabled={setFieldMapping.isPending}>Feld zuordnen</Button></div>{selected.fields.length > 0 && <div className="mt-3 space-y-1 text-xs text-slate-400">{selected.fields.map((mapping) => <p key={mapping.id}>{mapping.sourceField} → <strong className="text-slate-200">{mapping.partnerField ?? "nicht übertragen"}</strong></p>)}</div>}</div></div>}</aside>
    </section>
  </>;
}
