/**
 * Wählliste einer Anrufkampagne (Telefonie): welche Kontakte hinein sollen.
 * Das Fenster „Kampagne“ zeigt nur einen Teil davon. Drei Angaben setzt die Software selbst, wenn eine Kampagne an anderer Stelle
 * gestartet wird – sie stehen in keinem Feld des Fensters und müssen ein Speichern dort überstehen:
 *  - `kind`: „vertrieb“ bei der Anrufkampagne einer hochgeladenen Liste (Vertriebspipeline), sonst Leads zum Verkauf
 *  - `leadIds`: fest gewählte Karten (Dialer aus der Pipeline)
 *  - `supplierIds`: Lieferanten
 */
export type DialerLeadFilter = { categoryIds?: number[]; statuses?: string[]; tagIds?: number[]; supplierIds?: number[]; notCalledDays?: number | null; onlyWithoutCall?: boolean; rawBatchIds?: number[]; leadsEnabled?: boolean; leadIds?: number[]; kind?: "verkauf" | "vertrieb" };

/** Beim Ändern einer Kampagne: Was die neue Angabe nicht nennt, bleibt aus der gespeicherten erhalten (nur die drei Angaben oben). */
export function keepHiddenFilter(before: DialerLeadFilter | null | undefined, next: DialerLeadFilter): DialerLeadFilter {
  const out: DialerLeadFilter = { ...next };
  if (out.kind === undefined && before?.kind) out.kind = before.kind;
  if (out.leadIds === undefined && before?.leadIds?.length) out.leadIds = before.leadIds;
  if (out.supplierIds === undefined && before?.supplierIds?.length) out.supplierIds = before.supplierIds;
  return out;
}
