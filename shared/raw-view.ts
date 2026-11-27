/**
 * Rohdaten: Zahlen einer Liste in Worten und als Anteile – für Zahlenleiste, Balken der Liste und die Reiter der Kontakte.
 * „Offen“ heißt: neu oder schon in einer Wählliste – also noch nicht Lead, nicht verworfen, nicht doppelt.
 */
export type RawStatus = "neu" | "in_liste" | "konvertiert" | "verworfen" | "duplikat";
export type RawCounts = { total: number } & Record<RawStatus, number>;
/** Reihenfolge der Reiter über den Kontakten. */
export const RAW_STATUS: Array<[RawStatus, string]> = [["neu", "Neu"], ["in_liste", "In Wählliste"], ["konvertiert", "Lead"], ["verworfen", "Verworfen"], ["duplikat", "Doppelt"]];
export const rawStatusLabel = (status: string) => RAW_STATUS.find(([key]) => key === status)?.[1] ?? status;
/** Reihenfolge im Balken einer Liste: von „geschafft“ (Lead) über „in Arbeit“ bis „fällt weg“. */
const BAR_ORDER: Array<[RawStatus, string]> = [["konvertiert", "Leads"], ["in_liste", "in Wählliste"], ["neu", "neu"], ["verworfen", "verworfen"], ["duplikat", "doppelt"]];

export const emptyRawCounts = (): RawCounts => ({ total: 0, neu: 0, in_liste: 0, konvertiert: 0, verworfen: 0, duplikat: 0 });
/** Alle Listen zusammen. */
export function rawTotals(batches: ReadonlyArray<{ counts: RawCounts }>): RawCounts {
  return batches.reduce((sum, batch) => ({ total: sum.total + batch.counts.total, neu: sum.neu + batch.counts.neu, in_liste: sum.in_liste + batch.counts.in_liste, konvertiert: sum.konvertiert + batch.counts.konvertiert, verworfen: sum.verworfen + batch.counts.verworfen, duplikat: sum.duplikat + batch.counts.duplikat }), emptyRawCounts());
}
export const rawOpen = (counts: RawCounts) => counts.neu + counts.in_liste;
/** Anteil in ganzen Prozent – 0, wenn es nichts gibt. */
export const rawShare = (part: number, total: number) => total > 0 ? Math.round((part / total) * 100) : 0;

export type RawSegment = { key: RawStatus; label: string; count: number; share: number };
/** Die Teile des Balkens einer Liste – alle fünf (auch die mit 0, für die Legende); `share` in Prozent der Kontakte. */
export function rawSegments(counts: RawCounts): RawSegment[] {
  return BAR_ORDER.map(([key, label]) => ({ key, label: key === "konvertiert" && counts[key] === 1 ? "Lead" : label, count: counts[key], share: counts.total > 0 ? (counts[key] / counts.total) * 100 : 0 }));
}

/**
 * Ist in einer Liste kein Kontakt mehr offen, gibt es nichts ins Callcenter zu geben und nichts zu übernehmen.
 * Dann steht da, warum – null, solange noch Kontakte offen sind oder die Liste leer ist.
 */
export function rawDoneText(counts: RawCounts): string | null {
  if (counts.total === 0 || rawOpen(counts) > 0) return null;
  if (counts.konvertiert === counts.total) return counts.total === 1 ? "Der Kontakt ist schon ein Lead – hier gibt es nichts mehr zu übernehmen." : `Alle ${counts.total} Kontakte sind schon Leads – hier gibt es nichts mehr zu übernehmen.`;
  const parts = [counts.konvertiert ? `${counts.konvertiert} ${counts.konvertiert === 1 ? "ist schon ein Lead" : "sind schon Leads"}` : null, counts.verworfen ? `${counts.verworfen} verworfen` : null, counts.duplikat ? `${counts.duplikat} doppelt` : null].filter(Boolean).join(", ");
  return `Kein Kontakt mehr offen (${parts}) – hier gibt es nichts mehr zu übernehmen.`;
}
