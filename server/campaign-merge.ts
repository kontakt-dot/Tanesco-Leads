/**
 * E-Mail-Kampagnen zusammenführen: alle Kontakte anderer Kampagnen in eine Ziel-Kampagne übernehmen – mit allem, was
 * sie schon hinter sich haben (gesendet, geöffnet, geklickt, geantwortet, Verlauf, Entwürfe). Jeder macht im Ziel genau
 * an dem Schritt weiter, an dem er in der alten Kampagne stand („2. E-Mail“ bleibt „2. E-Mail“).
 *
 * Regeln:
 * - Doppelte Kontakte (gleiche E-Mail in Ziel und Quelle): nur einmal behalten – der Eintrag, der weiter ist (mehr E-Mails
 *   bekommen); der Verlauf des anderen hängt sich an den behaltenen Eintrag, Posteingang-Antworten zeigen weiter auf ihn.
 * - Wer fertig ist, bleibt fertig; wer wartet, wartet im Ziel am passenden Schritt weiter. Gibt es den Schritt im Ziel
 *   nicht, ist der Kontakt dort fertig (mit Vermerk im Verlauf).
 * - Die Listen der Quelle kommen zur Zielgruppe des Ziels dazu (wenn beide auf Listen laufen).
 * - Die Quelle wandert ins Archiv (beendet) mit Vermerk in der Glocke – nichts wird gelöscht.
 */
import { and, eq, inArray } from "drizzle-orm";
import { emailCampaignEvents, emailCampaignRecipients, emailCampaigns, inboxMessages, leads } from "../drizzle/schema";
import { audienceLists, kiAnsatzOf, listAudience, nodeMapper, type EmailTree } from "../shared/email-campaigns";
import { logActivity } from "./activity";
import type { Db } from "./lead-pipeline";
import type { Audience } from "./sales-outreach";

type Recipient = typeof emailCampaignRecipients.$inferSelect;
const EMPTY_TREE: EmailTree = { start: null, nodes: [] };
const treeOf = (row: { tree: unknown }) => ((row.tree ?? EMPTY_TREE) as EmailTree);
const clearedDraft = { draftState: null, draftSubject: null, draftText: null, draftOptions: null, draftApproach: null, draftNodeId: null, draftSource: null, draftAt: null } as const;

export type MergeResult = { targetId: number; targetName: string; targetStatus: string; moved: number; duplicates: number; replaced: number; finished: number; sources: Array<{ id: number; name: string; moved: number; duplicates: number; replaced: number; finished: number }> };

export async function mergeEmailCampaigns(db: Db, tenantId: number, input: { targetId: number; sourceIds: number[] }, actorUserId: number | null = null): Promise<MergeResult> {
  const target = (await db.select().from(emailCampaigns).where(and(eq(emailCampaigns.id, input.targetId), eq(emailCampaigns.tenantId, tenantId))).limit(1))[0];
  if (!target) throw new Error("Ziel-Kampagne nicht gefunden.");
  if (target.isTemplate) throw new Error("In eine Vorlage lassen sich keine Kontakte übernehmen – bitte eine Kampagne wählen.");
  if (target.archivedAt) throw new Error("Die Ziel-Kampagne liegt im Archiv – bitte zuerst wiederherstellen.");
  const sourceIds = Array.from(new Set(input.sourceIds.map(Number).filter((id) => Number.isInteger(id) && id > 0 && id !== target.id)));
  if (!sourceIds.length) throw new Error("Bitte mindestens eine andere Kampagne wählen.");
  const sources = await db.select().from(emailCampaigns).where(and(eq(emailCampaigns.tenantId, tenantId), inArray(emailCampaigns.id, sourceIds)));
  if (sources.length !== sourceIds.length) throw new Error("Eine der Kampagnen wurde nicht gefunden.");
  if (sources.some((row) => row.isTemplate)) throw new Error("Vorlagen haben keine Kontakte – bitte nur Kampagnen wählen.");
  const targetTree = treeOf(target);
  const targetRows = await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.campaignId, target.id)));
  const byEmail = new Map<string, Recipient>(); for (const row of targetRows) byEmail.set(row.email.trim().toLowerCase(), row);
  const result: MergeResult = { targetId: target.id, targetName: target.name, targetStatus: target.status, moved: 0, duplicates: 0, replaced: 0, finished: 0, sources: [] };
  let targetLists = audienceLists(target.audience as Audience | null); let listsChanged = false;

  /** Verlauf eines Eintrags an einen anderen Eintrag hängen (Schritte dabei ins Ziel übersetzen). */
  const moveEvents = async (fromRecipientId: number, toRecipientId: number, map: (id: string | null | undefined) => string | null) => {
    const events = await db.select({ id: emailCampaignEvents.id, nodeId: emailCampaignEvents.nodeId }).from(emailCampaignEvents).where(and(eq(emailCampaignEvents.tenantId, tenantId), eq(emailCampaignEvents.recipientId, fromRecipientId)));
    const groups = new Map<string, number[]>(); for (const event of events) { const mapped = event.nodeId ? map(event.nodeId) ?? event.nodeId : null; const key = mapped ?? ""; const list = groups.get(key) ?? []; list.push(event.id); groups.set(key, list); }
    for (const [nodeId, ids] of Array.from(groups.entries())) for (let i = 0; i < ids.length; i += 500) await db.update(emailCampaignEvents).set({ campaignId: target.id, recipientId: toRecipientId, nodeId: nodeId || null }).where(inArray(emailCampaignEvents.id, ids.slice(i, i + 500)));
  };
  /** Einen Eintrag der Quelle ins Ziel holen – am passenden Schritt, mit Entwurf, Verlauf und Posteingang-Verknüpfung. */
  const moveRecipient = async (row: Recipient, map: (id: string | null | undefined) => string | null, targetName: string): Promise<boolean> => {
    const nodeId = map(row.nodeId); const draftNodeId = map(row.draftNodeId); let finished = false;
    const patch: Partial<Recipient> = { campaignId: target.id, nodeId: row.nodeId ? nodeId : null, draftNodeId: row.draftNodeId ? draftNodeId : null };
    if (row.nodeId && !nodeId && (row.status === "wartet" || row.status === "laeuft")) { Object.assign(patch, { status: "fertig", nextActionAt: null }); finished = true; }
    if (row.draftNodeId && !draftNodeId) Object.assign(patch, clearedDraft);
    await db.update(emailCampaignRecipients).set(patch).where(eq(emailCampaignRecipients.id, row.id));
    await moveEvents(row.id, row.id, map);
    if (finished) await db.insert(emailCampaignEvents).values({ tenantId, campaignId: target.id, recipientId: row.id, nodeId: null, kind: "beendet", subject: null, note: `In „${targetName}“ gibt es diesen Schritt nicht – Ablauf beendet` });
    return finished;
  };

  for (const source of sources) {
    const map = nodeMapper(treeOf(source), targetTree);
    const rows = await db.select().from(emailCampaignRecipients).where(and(eq(emailCampaignRecipients.tenantId, tenantId), eq(emailCampaignRecipients.campaignId, source.id)));
    const part = { id: source.id, name: source.name, moved: 0, duplicates: 0, replaced: 0, finished: 0 };
    for (const row of rows) {
      const key = row.email.trim().toLowerCase(); const existing = byEmail.get(key);
      if (!existing) { if (await moveRecipient(row, map, target.name)) part.finished += 1; byEmail.set(key, { ...row, campaignId: target.id }); part.moved += 1; continue; }
      // Doppelt: der weitere Eintrag bleibt, der Verlauf des anderen hängt sich an ihn
      if (row.sentCount > existing.sentCount) {
        if (await moveRecipient(row, map, target.name)) part.finished += 1;
        await moveEvents(existing.id, row.id, (id) => id ?? null); await db.update(inboxMessages).set({ campaignRecipientId: row.id }).where(and(eq(inboxMessages.tenantId, tenantId), eq(inboxMessages.campaignRecipientId, existing.id)));
        await db.delete(emailCampaignRecipients).where(eq(emailCampaignRecipients.id, existing.id));
        byEmail.set(key, { ...row, campaignId: target.id }); part.replaced += 1;
      } else {
        await moveEvents(row.id, existing.id, map); await db.update(inboxMessages).set({ campaignRecipientId: existing.id }).where(and(eq(inboxMessages.tenantId, tenantId), eq(inboxMessages.campaignRecipientId, row.id)));
        await db.delete(emailCampaignRecipients).where(eq(emailCampaignRecipients.id, row.id));
        part.duplicates += 1;
      }
    }
    // Pipeline-Karten und „Versendet“: die Kontakte gehören jetzt zur Ziel-Kampagne
    await db.update(leads).set({ adCampaignId: `email-${target.id}`, adCampaignName: target.name }).where(and(eq(leads.tenantId, tenantId), eq(leads.adCampaignId, `email-${source.id}`)));
    // Offene Entwürfe im Ansatz der Quelle → Ansatz des Ziels (eigene Texte bleiben)
    if (kiAnsatzOf(source) !== kiAnsatzOf(target)) { const { realignDrafts } = await import("./campaign-review"); await realignDrafts(db, tenantId, target.id, kiAnsatzOf(source), kiAnsatzOf(target)).catch(() => null); }
    // Listen der Quelle zur Zielgruppe des Ziels
    const sourceAudience = source.audience as Audience | null; const targetAudience = target.audience as Audience | null;
    if (sourceAudience?.source === "liste" && (!targetAudience || targetAudience.source === "liste")) { const extra = audienceLists(sourceAudience).filter((name) => !targetLists.includes(name)); if (extra.length) { targetLists = [...targetLists, ...extra]; listsChanged = true; } }
    // Quelle ins Archiv – nichts löschen
    const status = source.status === "aktiv" || source.status === "pausiert" ? "beendet" : source.status;
    await db.update(emailCampaigns).set({ status, archivedAt: source.archivedAt ?? new Date() }).where(eq(emailCampaigns.id, source.id));
    await logActivity(db, tenantId, { kind: "kampagne", title: `Kampagne „${source.name}“ in „${target.name}“ zusammengeführt`, detail: `${part.moved + part.replaced} Kontakte übernommen${part.duplicates ? ` · ${part.duplicates} waren schon im Ziel` : ""}${part.finished ? ` · ${part.finished} ohne passenden Schritt beendet` : ""} – „${source.name}“ liegt jetzt im Archiv.`, count: Math.max(1, part.moved + part.replaced), actorUserId, refType: "emailCampaign", refId: source.id });
    result.sources.push(part); result.moved += part.moved; result.duplicates += part.duplicates; result.replaced += part.replaced; result.finished += part.finished;
  }
  if (listsChanged) await db.update(emailCampaigns).set({ audience: listAudience(targetLists) }).where(eq(emailCampaigns.id, target.id));
  await logActivity(db, tenantId, { kind: "kampagne", title: `Kampagne „${target.name}“: ${result.moved + result.replaced} Kontakte aus ${sources.length === 1 ? "einer Kampagne" : `${sources.length} Kampagnen`} übernommen`, detail: result.duplicates ? `${result.duplicates} Kontakte waren schon dabei – jeweils nur einmal behalten.` : null, count: Math.max(1, result.moved + result.replaced), actorUserId, refType: "emailCampaign", refId: target.id });
  return result;
}
