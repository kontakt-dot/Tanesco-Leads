import { Button } from "@/components/ui/button";
import { Download, FileSpreadsheet, ListPlus, Settings2, WandSparkles } from "lucide-react";
import React from "react";
import { categoryWorkspaceTabLabels, type CategoryWorkspaceTab } from "./lead-category-contract";

type WorkspaceContract = { tenantId: number; categoryId: number; directLink: string; tabs: readonly CategoryWorkspaceTab[]; tools: readonly [string, string] };

export default function PVWorkspaceControls({ contract, activeTab, fieldCount, mappingCount, onTabChange, onCsv, onParameters }: { contract: WorkspaceContract; activeTab: CategoryWorkspaceTab; fieldCount: number; mappingCount: number; onTabChange: (tab: CategoryWorkspaceTab) => void; onCsv: () => void; onParameters: () => void }) {
  const tabMeta = { settings: { icon: Settings2, label: categoryWorkspaceTabLabels.settings }, fields: { icon: ListPlus, label: `${categoryWorkspaceTabLabels.fields} (${fieldCount})` }, mapping: { icon: WandSparkles, label: `${categoryWorkspaceTabLabels.mapping} (${mappingCount})` } } satisfies Record<CategoryWorkspaceTab, { icon: typeof Settings2; label: string }>;
  return <><div className="flex flex-wrap justify-end gap-2 border-b border-white/10 px-5 py-3"><Button size="sm" variant="outline" onClick={onCsv}><Download /> {contract.tools[0]}</Button><Button size="sm" variant="outline" onClick={onParameters}><FileSpreadsheet /> {contract.tools[1]}</Button></div><nav className="flex gap-1 overflow-x-auto border-b border-white/10 px-4 pt-3" aria-label="Kategoriearbeitsbereich">{contract.tabs.map((tab) => { const meta = tabMeta[tab]; const Icon = meta.icon; return <button key={tab} type="button" onClick={() => onTabChange(tab)} className={`flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm transition ${activeTab === tab ? "border-violet-400 text-violet-100" : "border-transparent text-slate-500 hover:text-slate-200"}`}><Icon className="h-4 w-4" />{meta.label}</button>; })}</nav></>;
}
