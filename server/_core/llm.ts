/**
 * KI-Anbindung direkt an die Anthropic-API (Claude) – ersetzt die Manus-Forge-Weiterleitung.
 * Die Schnittstelle (invokeLLM → choices[0].message.content) bleibt gleich, damit routers.ts unverändert bleibt.
 *
 * Umgebung: ANTHROPIC_API_KEY (Pflicht für KI-Funktionen), ANTHROPIC_MODEL (Standard: claude-sonnet-4-6).
 * Strukturierte Ausgaben (outputSchema) werden über ein erzwungenes Tool geliefert und als JSON-Text zurückgegeben.
 */
export type Role = "system" | "user" | "assistant";
export type TextContent = { type: "text"; text: string };
export type ImageContent = { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } };
export type FileContent = { type: "file"; file: { data: string; mime_type: "application/pdf" | "image/png" | "image/jpeg" | "image/webp" | "image/gif" } };
export type MessageContent = string | TextContent | ImageContent | FileContent;
export type Message = { role: Role; content: MessageContent | MessageContent[]; name?: string };
export type JsonSchema = { name: string; schema: Record<string, unknown>; strict?: boolean };
export type OutputSchema = JsonSchema;
export type InvokeParams = { messages: Message[]; maxTokens?: number; max_tokens?: number; outputSchema?: OutputSchema; output_schema?: OutputSchema; model?: string; temperature?: number };
export type InvokeResult = { id: string; created: number; model: string; choices: Array<{ index: number; message: { role: Role; content: string }; finish_reason: string | null }>; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } };

const API_URL = process.env.ANTHROPIC_API_URL ?? "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
const FAST_MODEL = process.env.ANTHROPIC_FAST_MODEL ?? "claude-haiku-4-5-20251001"; // Chat-Hilfe: schnelle Antworten
const pickModel = (hint?: string) => (hint && /mini|haiku|fast|schnell/i.test(hint) ? FAST_MODEL : DEFAULT_MODEL);

type AnthropicBlock = { type: "text"; text: string } | { type: "image"; source: { type: "base64" | "url"; media_type?: string; data?: string; url?: string } } | { type: "document"; source: { type: "base64"; media_type: string; data: string } };

function toBlocks(content: MessageContent | MessageContent[]): AnthropicBlock[] {
  const parts = Array.isArray(content) ? content : [content];
  return parts.map((part): AnthropicBlock => {
    if (typeof part === "string") return { type: "text", text: part };
    if (part.type === "text") return { type: "text", text: part.text };
    if (part.type === "image_url") {
      const match = /^data:([^;]+);base64,(.+)$/.exec(part.image_url.url);
      return match ? { type: "image", source: { type: "base64", media_type: match[1], data: match[2] } } : { type: "image", source: { type: "url", url: part.image_url.url } };
    }
    if (part.file.mime_type === "application/pdf") return { type: "document", source: { type: "base64", media_type: "application/pdf", data: part.file.data } };
    return { type: "image", source: { type: "base64", media_type: part.file.mime_type, data: part.file.data } };
  });
}

/*
 * Tempo und Störungen der KI – für „KI schreibt gerade …“ in der Oberfläche: Dauer der letzten Anfragen und der letzte Fehler des Anbieters.
 * Bei Überlastung (429/529/5xx), Zeitüberschreitung oder Netzfehler versucht es die App nach ein paar Sekunden automatisch noch zweimal
 * (Wartezeit des Anbieters wird beachtet, höchstens 30 s). Jede Anfrage hat eine Zeitgrenze, damit nie eine hängende Anfrage alles aufhält.
 */
type AiCall = { at: number; ms: number; ok: boolean; status: number | null };
const aiCalls: AiCall[] = []; let aiLastError: { at: number; status: number | null; message: string } | null = null;
const RETRY_STATUS = new Set([408, 409, 429, 500, 502, 503, 504, 529]);
const MAX_RETRIES = Number(process.env.ANTHROPIC_RETRIES ?? 2);
function noteCall(call: AiCall, message?: string) {
  aiCalls.push(call); if (aiCalls.length > 400) aiCalls.splice(0, aiCalls.length - 400);
  if (!call.ok) aiLastError = { at: call.at, status: call.status, message: (message ?? "").slice(0, 200) };
}
/** KI-Lage der letzten 15 Minuten: Anfragen, Fehler, davon „Anbieter überlastet/Limit“, mittlere Dauer – und der letzte Fehler. */
export function aiHealthView(now = Date.now()) {
  const recent = aiCalls.filter((call) => now - call.at < 15 * 60_000); const ok = recent.filter((call) => call.ok); const errors = recent.filter((call) => !call.ok);
  const busy = errors.filter((call) => call.status === 429 || call.status === 529 || call.status === 503).length;
  return { calls: recent.length, errors: errors.length, busy, timeouts: errors.filter((call) => call.status === null).length, avgSeconds: ok.length ? Math.round(ok.reduce((sum, call) => sum + call.ms, 0) / ok.length / 100) / 10 : null, lastError: aiLastError && now - aiLastError.at < 15 * 60_000 ? { ...aiLastError } : null };
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const retryWait = (response: Response | null, attempt: number) => { const header = Number(response?.headers.get("retry-after") ?? NaN); const base = Number(process.env.ANTHROPIC_RETRY_BASE_MS ?? 4000); return Number.isFinite(header) && header > 0 ? Math.min(30_000, header * 1000) : base * ([1, 3, 5][attempt] ?? 5); };

export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Die KI-Funktionen sind nicht konfiguriert (ANTHROPIC_API_KEY fehlt).");
  const schema = params.outputSchema ?? params.output_schema;
  const system = params.messages.filter((message) => message.role === "system").map((message) => (Array.isArray(message.content) ? message.content : [message.content]).map((part) => (typeof part === "string" ? part : part.type === "text" ? part.text : "")).join("\n")).join("\n\n");
  const messages = params.messages.filter((message) => message.role !== "system").map((message) => ({ role: message.role === "assistant" ? "assistant" : "user", content: toBlocks(message.content) }));
  if (!messages.length) messages.push({ role: "user", content: [{ type: "text", text: "Bitte antworte gemäß Systemanweisung." }] });
  const body: Record<string, unknown> = { model: pickModel(params.model), max_tokens: params.maxTokens ?? params.max_tokens ?? 4096, messages };
  if (system) body.system = system;
  if (typeof params.temperature === "number") body.temperature = params.temperature;
  if (schema) {
    body.tools = [{ name: schema.name, description: "Gibt das Ergebnis strukturiert im vorgegebenen Schema zurück.", input_schema: schema.schema }];
    body.tool_choice = { type: "tool", name: schema.name };
  }
  // Zeitgrenze passend zur Länge der Antwort (z. B. 4096 Tokens → ca. 2 Minuten), mindestens 90 s, höchstens 5 Minuten
  const timeoutMs = Number(process.env.ANTHROPIC_TIMEOUT_MS ?? 0) || Math.max(90_000, Math.min(300_000, Number(body.max_tokens) * 30));
  type AnthropicResponse = { id: string; model: string; stop_reason: string | null; content: Array<{ type: string; text?: string; name?: string; input?: unknown }>; usage?: { input_tokens: number; output_tokens: number } };
  let answer: AnthropicResponse | null = null;
  for (let attempt = 0; answer === null; attempt += 1) {
    const started = Date.now(); const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response | null = null;
    try {
      response = await fetch(API_URL, { method: "POST", headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" }, body: JSON.stringify(body), signal: controller.signal });
      if (!response.ok) {
        const text = await response.text().catch(() => ""); noteCall({ at: Date.now(), ms: Date.now() - started, ok: false, status: response.status }, text);
        if (RETRY_STATUS.has(response.status) && attempt < MAX_RETRIES) { clearTimeout(timer); await pause(retryWait(response, attempt)); continue; } // überlastet/Limit: kurz warten, noch einmal
        throw Object.assign(new Error(`Die KI-Anfrage ist fehlgeschlagen (HTTP ${response.status})${text ? `: ${text.slice(0, 300)}` : ""}`), { final: true });
      }
      answer = await response.json() as AnthropicResponse;
      noteCall({ at: Date.now(), ms: Date.now() - started, ok: true, status: response.status });
    } catch (error) {
      if ((error as { final?: boolean }).final) throw error;
      const aborted = controller.signal.aborted; const message = aborted ? `keine Antwort nach ${Math.round(timeoutMs / 1000)} s` : error instanceof Error ? error.message : String(error);
      noteCall({ at: Date.now(), ms: Date.now() - started, ok: false, status: null }, message);
      if (attempt < MAX_RETRIES) { await pause(retryWait(null, attempt)); continue; }
      throw new Error(aborted ? `Die KI hat nicht rechtzeitig geantwortet (${Math.round(timeoutMs / 1000)} s) – bitte gleich noch einmal versuchen.` : `Die KI ist gerade nicht erreichbar: ${message}`);
    } finally { clearTimeout(timer); }
  }
  const data: AnthropicResponse = answer;
  let content = "";
  if (schema) { const tool = data.content.find((block) => block.type === "tool_use" && block.name === schema.name); content = tool?.input !== undefined ? JSON.stringify(tool.input) : data.content.filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n").trim(); }
  else content = data.content.filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n").trim();
  return { id: data.id, created: Math.floor(Date.now() / 1000), model: data.model, choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: data.stop_reason }], usage: data.usage ? { prompt_tokens: data.usage.input_tokens, completion_tokens: data.usage.output_tokens, total_tokens: data.usage.input_tokens + data.usage.output_tokens } : undefined };
}
