import React from "react";
import { trpc } from "@/lib/trpc";
import { X } from "lucide-react";
import { toast } from "sonner";
import { isListTag } from "../../../shared/list-tags";

export default function LeadTagManager({ publicId, bare = false }: { publicId: string; /** ohne eigene Überschrift – wenn die Karte darum schon „Tags“ heißt */ bare?: boolean }) {
  const utils = trpc.useUtils();
  const assigned = trpc.leadops.listLeadTags.useQuery({ publicId }, { retry: false });
  const available = trpc.leadops.listTags.useQuery(undefined, { retry: false });
  const add = trpc.leadops.assignLeadTag.useMutation({ onSuccess: () => { utils.leadops.listLeadTags.invalidate({ publicId }); toast.success("Tag zugewiesen."); }, onError: (error) => toast.error(error.message) });
  const remove = trpc.leadops.removeLeadTag.useMutation({ onSuccess: () => { utils.leadops.listLeadTags.invalidate({ publicId }); toast.success("Tag entfernt."); }, onError: (error) => toast.error(error.message) });
  const assignedIds = new Set(assigned.data?.map((tag) => tag.id) ?? []);
  // Zur Auswahl stehen nur eigene Tags: Die Marker „Liste: …“ hängt die Software selbst an Kontakte einer hochgeladenen Liste – sie gehören nicht an einen Lead
  const unassigned = available.data?.filter((tag) => !assignedIds.has(tag.id) && !isListTag(tag.name)) ?? [];
  return <div className={bare ? "lead-tags is-bare" : "detail-block lead-tags"}>{!bare && <span>Tags</span>}<div className={`${bare ? "" : "mt-2 "}flex flex-wrap items-center gap-2`}>
    {assigned.data?.map((tag) => <button key={tag.id} type="button" className="lead-tag-chip cat-strong" style={{ ["--cat" as string]: tag.color } as React.CSSProperties} title={`„${tag.name}“ entfernen`} disabled={remove.isPending} onClick={() => remove.mutate({ publicId, tagId: tag.id })}>{tag.name}<X className="h-3 w-3" aria-hidden="true" /></button>)}
    {!assigned.data?.length && <span className="lead-tag-none">Noch kein Tag</span>}
    {unassigned.length > 0 && <select className="filter-select lead-tag-add" aria-label="Tag hinzufügen" value="" disabled={add.isPending} onChange={(event) => { const tagId = Number(event.target.value); if (tagId) add.mutate({ publicId, tagId }); }}><option value="">+ Tag hinzufügen …</option>{unassigned.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select>}
  </div></div>;
}
