import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Markenkonfiguration", () => {
  it("führt Tanesco Leads als zentralen Anwendungstitel", () => {
    expect(readFileSync(new URL("../client/index.html", import.meta.url), "utf8")).toContain("<title>Tanesco Leads</title>");
  });
});
