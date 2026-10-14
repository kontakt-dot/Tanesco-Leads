export function offerStatusAfterApprovedClaim(rule: "keep" | "relist") {
  return rule === "relist" ? "aktiv" : "entfernt";
}
