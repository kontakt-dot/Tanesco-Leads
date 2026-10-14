export const claimEventLabel = (eventType: string) => ({
  erstellt: "Reklamation erfasst",
  frist_gesetzt: "Prüfungsfrist gesetzt",
  status_geändert: "Status aktualisiert",
  entschieden: "Entscheidung dokumentiert",
  notiz: "Fallnotiz",
}[eventType] ?? eventType.replaceAll("_", " "));

export const claimTimelineSource = "persistierte_claim_events" as const;
