/** Message-ID einer E-Mail vereinheitlichen: ohne spitze Klammern, klein geschrieben – so lassen sich Antworten (In-Reply-To/References) sicher wiederfinden. */
export function normalizeMessageId(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim().replace(/^<+|>+$/g, "").trim().toLowerCase();
  return trimmed.length >= 3 && trimmed.length <= 320 ? trimmed : null;
}
/** Alle Message-IDs aus „References“/„In-Reply-To“ – mehrere je Text (in spitzen Klammern, durch Leerzeichen getrennt) oder eine blanke ID je Eintrag. */
export function messageIdsIn(value: string | string[] | null | undefined): string[] {
  const parts = Array.isArray(value) ? value : [value ?? ""];
  const out = new Set<string>();
  for (const text of parts) {
    const re = /<([^<>\s]+)>/g; let match: RegExpExecArray | null; let found = false;
    while ((match = re.exec(text ?? ""))) { found = true; const id = normalizeMessageId(match[1]); if (id) out.add(id); }
    if (!found) { const id = normalizeMessageId(text); if (id && !/\s/.test(id)) out.add(id); }
  }
  return Array.from(out);
}
