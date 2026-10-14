export type ClaimListRow = { id: number; leadId: number; reason: string; status: string; dueAt?: Date | null; createdAt: Date };

export function filterClaims<T extends ClaimListRow>(claims: readonly T[] | undefined, query: string, status: string) {
  const needle = query.trim().toLowerCase();
  return (claims ?? []).filter((claim) => (status === "alle" || claim.status === status) && (!needle || [String(claim.id), String(claim.leadId), claim.reason, claim.status].join(" ").toLowerCase().includes(needle)));
}

export function buildClaimsCsv(claims: readonly ClaimListRow[]) {
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return ["Reklamation;Lead;Grund;Status;Frist;Erstellt", ...claims.map((claim) => [claim.id, claim.leadId, claim.reason, claim.status, claim.dueAt ? new Date(claim.dueAt).toISOString() : "", new Date(claim.createdAt).toISOString()].map(escape).join(";"))].join("\n");
}
