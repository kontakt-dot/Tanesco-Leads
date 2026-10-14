import { Button } from "@/components/ui/button";
import DeliveryMetricsPanel from "@/components/DeliveryMetricsPanel";
import LiveRouting from "@/components/LiveRouting";
import OrderWorkspace from "@/components/OrderWorkspace";
import { Boxes, Workflow } from "lucide-react";
import { useEffect, useState } from "react";

type OperationsTab = "lieferketten" | "bestellungen";

export default function OperationsWorkspace({ initialTab = "lieferketten" }: { initialTab?: OperationsTab }) {
  const [tab, setTab] = useState<OperationsTab>(initialTab);
  useEffect(() => setTab(initialTab), [initialTab]);
  if (tab === "bestellungen") return <OrderWorkspace />;

  return <>
    <header className="page-intro compact">
      <div><span className="eyebrow">OPERATIONS / AUSLIEFERUNG</span><h1>Operations</h1><p>Steuern Sie Lieferketten und Bestellungen als zusammenhängenden Ablauf für die operative Lead-Auslieferung.</p></div>
      <div className="flex gap-2"><Button variant="default"><Workflow /> Lieferketten</Button><Button variant="outline" onClick={() => window.location.assign("/?page=Bestellungen")}><Boxes /> Bestellungen</Button></div>
    </header>
    <><DeliveryMetricsPanel /><LiveRouting page="Lieferkette" /></>
  </>;
}
