import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";

export default function LeadTagManager({ publicId }: { publicId: string }) {
  const utils = trpc.useUtils();
  const assigned = trpc.leadops.listLeadTags.useQuery({ publicId }, { retry: false });
  const available = trpc.leadops.listTags.useQuery(undefined, { retry: false });
  const add = trpc.leadops.assignLeadTag.useMutation({ onSuccess: () => { utils.leadops.listLeadTags.invalidate({ publicId }); toast.success("Tag zugewiesen."); }, onError: (error) => toast.error(error.message) });
  const remove = trpc.leadops.removeLeadTag.useMutation({ onSuccess: () => { utils.leadops.listLeadTags.invalidate({ publicId }); toast.success("Tag entfernt."); }, onError: (error) => toast.error(error.message) });
  const assignedIds = new Set(assigned.data?.map((tag) => tag.id) ?? []);
  const unassigned = available.data?.filter((tag) => !assignedIds.has(tag.id)) ?? [];
  return <div className="detail-block"><span>Tags</span><div className="mt-2 flex flex-wrap gap-2">{assigned.data?.map((tag) => <button key={tag.id} className="flex items-center gap-1 rounded-full border border-white/10 px-2 py-1 text-[10px]" style={{ color: tag.color }} onClick={() => remove.mutate({ publicId, tagId: tag.id })}>{tag.name}<X className="h-3 w-3"/></button>)}{unassigned.slice(0, 3).map((tag) => <Button key={tag.id} variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => add.mutate({ publicId, tagId: tag.id })}><Plus className="h-3 w-3"/>{tag.name}</Button>)}</div></div>;
}
