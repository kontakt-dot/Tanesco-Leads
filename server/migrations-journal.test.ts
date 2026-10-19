import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Der Migrator auf Railway spielt nur Migrationen ein, deren Zeitstempel („when“) NACH der zuletzt eingespielten liegt.
 * Ein kleinerer Zeitstempel wird still übersprungen (so fehlte die Tabelle inboxDeletedMessages in der Live-Datenbank).
 */
describe("Migrationen: Zeitstempel im Journal", () => {
  it("steigen streng an und passen zur Reihenfolge der Dateien", () => {
    const journal = JSON.parse(readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8")) as { entries: Array<{ idx: number; tag: string; when: number }> };
    for (let i = 1; i < journal.entries.length; i += 1) {
      const before = journal.entries[i - 1]; const entry = journal.entries[i];
      expect(entry.idx, entry.tag).toBe(before.idx + 1);
      expect(entry.when, `${entry.tag} muss nach ${before.tag} liegen`).toBeGreaterThan(before.when);
    }
  });
});
