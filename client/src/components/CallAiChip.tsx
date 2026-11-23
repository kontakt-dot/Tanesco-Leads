import AiUsageDialog from "@/components/AiUsageDialog";
import { trpc } from "@/lib/trpc";
import { Sparkles } from "lucide-react";
import { useState } from "react";

/**
 * „KI heute“ auf der Seite Gespräche: was Mitschreiben und Bewerten heute gekostet haben – und die Obergrenze je Tag.
 * Ein Klick öffnet den KI-Verbrauch (je Tag und wofür). Ist die Obergrenze erreicht, steht das am Knopf – mit der Zahl der wartenden Gespräche.
 */
const euro = (cents: number) => `${(cents / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
export default function CallAiChip() {
  const usage = trpc.leadops.callAiToday.useQuery(undefined, { retry: false, refetchInterval: 60_000 }).data;
  const [open, setOpen] = useState(false);
  if (!usage) return null;
  const title = `KI bei Gesprächen heute (ca.): ${euro(usage.spentCents)} – Mitschreiben ${euro(usage.transcriptCents)}, Bewerten ${euro(usage.ratingCents)}.${usage.capCents ? `\nObergrenze am Tag: ${euro(usage.capCents)}${usage.reached ? " – erreicht" : ""}.` : "\nKeine Obergrenze eingestellt."}${usage.waiting ? `\n${usage.waiting} ${usage.waiting === 1 ? "Gespräch wartet" : "Gespräche warten"} auf die Bewertung.` : ""}\nKlick: zeigt, an welchem Tag wie viel wofür verbraucht wurde.`;
  return <>
    <button type="button" className={`cq-tool cq-ai ${usage.reached ? "is-full" : ""}`} title={title} aria-haspopup="dialog" onClick={() => setOpen(true)}>
      <Sparkles aria-hidden="true" /><span>KI heute <b>{euro(usage.spentCents)}</b>{usage.capCents ? <> / {euro(usage.capCents)}</> : null}{usage.reached ? <em> · Grenze erreicht{usage.waiting ? `, ${usage.waiting} ${usage.waiting === 1 ? "wartet" : "warten"}` : ""}</em> : null}</span>
    </button>
    {open && <AiUsageDialog onClose={() => setOpen(false)} />}
  </>;
}
