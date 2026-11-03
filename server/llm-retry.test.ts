import { afterEach, describe, expect, it, vi } from "vitest";

describe("KI-Anfragen: Zeitgrenze und automatischer zweiter Versuch, wenn der Anbieter bremst", () => {
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.ANTHROPIC_RETRY_BASE_MS; delete process.env.ANTHROPIC_TIMEOUT_MS; vi.resetModules(); });
  const ok = () => new Response(JSON.stringify({ id: "m1", model: "claude", stop_reason: "end_turn", content: [{ type: "text", text: "Hallo" }] }), { status: 200, headers: { "content-type": "application/json" } });
  it("überlastet (529) → kurz warten, noch einmal – dann klappt es; die Lage zeigt den Engpass", async () => {
    process.env.ANTHROPIC_API_KEY = "test"; process.env.ANTHROPIC_RETRY_BASE_MS = "5";
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("overloaded", { status: 529 })).mockResolvedValueOnce(new Response("rate", { status: 429, headers: { "retry-after": "0" } })).mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", fetchMock);
    const { invokeLLM, aiHealthView } = await import("./_core/llm");
    const result = await invokeLLM({ messages: [{ role: "user", content: "Hi" }] });
    expect(result.choices[0].message.content).toBe("Hallo"); expect(fetchMock).toHaveBeenCalledTimes(3);
    const health = aiHealthView(); expect(health).toMatchObject({ calls: 3, errors: 2, busy: 2 }); expect(health.lastError?.status).toBe(429);
  });
  it("dauerhaft kaputt (z. B. Schlüssel ungültig, 401) → kein zweiter Versuch, klare Meldung", async () => {
    process.env.ANTHROPIC_API_KEY = "test"; process.env.ANTHROPIC_RETRY_BASE_MS = "5";
    const fetchMock = vi.fn().mockResolvedValue(new Response("invalid x-api-key", { status: 401 })); vi.stubGlobal("fetch", fetchMock);
    const { invokeLLM } = await import("./_core/llm");
    await expect(invokeLLM({ messages: [{ role: "user", content: "Hi" }] })).rejects.toThrow(/HTTP 401/); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("keine Antwort in der Zeitgrenze → abgebrochen, noch zweimal versucht, dann verständliche Meldung", async () => {
    process.env.ANTHROPIC_API_KEY = "test"; process.env.ANTHROPIC_RETRY_BASE_MS = "5"; process.env.ANTHROPIC_TIMEOUT_MS = "30";
    const hang = vi.fn((_url: string, init?: { signal?: AbortSignal }) => new Promise<Response>((_resolve, reject) => { init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))); }));
    vi.stubGlobal("fetch", hang);
    const { invokeLLM } = await import("./_core/llm");
    await expect(invokeLLM({ messages: [{ role: "user", content: "Hi" }] })).rejects.toThrow(/nicht rechtzeitig geantwortet/); expect(hang).toHaveBeenCalledTimes(3);
  });
});

describe("KI-Tempo: wann ist eine Kampagne fertig vorgeschrieben?", () => {
  it("reihum aus allen Kampagnen: fertig, wenn aus jeder höchstens so viele geschrieben sind", async () => {
    const { roundRobinEta } = await import("./campaign-review");
    expect(roundRobinEta([40, 10], 40, 5)).toBe(10); // 40 + 10 = 50 Entwürfe bei 5 pro Minute
    expect(roundRobinEta([40, 10], 10, 5)).toBe(4); // kleine Kampagne: 10 + 10 = 20 → 4 Minuten
    expect(roundRobinEta([3], 3, 6)).toBe(1); expect(roundRobinEta([5], 0, 5)).toBeNull(); expect(roundRobinEta([5], 5, null)).toBeNull();
  });
});
