import CustomerWorkspace from "@/components/CustomerWorkspace";
import FluxoraWorkspace from "@/components/FluxoraWorkspace";
import { trpc } from "@/lib/trpc";
import { Loader2 } from "lucide-react";

/**
 * Weiche zwischen Admin-Layout („VERWALTUNG“) und Kunden-Layout („MEIN BEREICH“):
 * Käufer- und Lieferanten-Zugänge – auch per „Als Benutzer einloggen“ übernommene – sehen den Kundenbereich.
 */
export default function Home() {
  const access = trpc.leadops.customerAccess.useQuery(undefined, { retry: false, staleTime: 30_000 });
  if (access.isLoading) return <main className="grid min-h-screen place-items-center bg-[#121322] text-white"><Loader2 className="animate-spin text-violet-300" /></main>;
  if (access.data && (access.data.partnerType === "käufer" || access.data.partnerType === "lieferant")) return <CustomerWorkspace access={access.data} />;
  return <FluxoraWorkspace />;
}
