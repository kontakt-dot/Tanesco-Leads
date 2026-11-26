import PartnerReport from "@/components/PartnerReport";

/**
 * Statistik – seit Version 375 nur noch Integrationen: je Partnerkonto, was aus den gelieferten Leads wurde
 * (geliefert, abgelehnt, angenommen – dann die Bewertung des Partners: offen, anerkannt, storniert, ausgezahlt, Provision).
 * Die früheren Reiter Käufer, Lieferanten, Bestellungen und Lieferketten stehen hier nicht mehr; ihre Zahlen liefert das Dashboard
 * (Übersicht) und die jeweilige Seite. Filter (Sparte, Zeitraum, Zeitbasis) bringt die Auswertung selbst mit – sie stehen in der Adresse.
 * `embedded`: im Dashboard-Reiter „Statistik“ steht die Überschrift schon darüber.
 */
export default function StatisticsWorkspace({ embedded = false }: { embedded?: boolean } = {}) {
  return <>
    {!embedded && <header className="page-intro compact"><div><h1>Statistik</h1><p>Integrationen: was aus den gelieferten Leads bei deinen Partnern wurde – geliefert, angenommen, anerkannt, storniert, ausgezahlt.</p></div></header>}
    <PartnerReport />
  </>;
}
