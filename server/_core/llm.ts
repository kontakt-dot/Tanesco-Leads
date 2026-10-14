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
  const response = await fetch(API_URL, { method: "POST", headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" }, body: JSON.stringify(body) });
  if (!response.ok) { const text = await response.text().catch(() => ""); throw new Error(`Die KI-Anfrage ist fehlgeschlagen (HTTP ${response.status})${text ? `: ${text.slice(0, 300)}` : ""}`); }
  const data = await response.json() as { id: string; model: string; stop_reason: string | null; content: Array<{ type: string; text?: string; name?: string; input?: unknown }>; usage?: { input_tokens: number; output_tokens: number } };
  let content = "";
  if (schema) { const tool = data.content.find((block) => block.type === "tool_use" && block.name === schema.name); content = tool?.input !== undefined ? JSON.stringify(tool.input) : data.content.filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n").trim(); }
  else content = data.content.filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n").trim();
  return { id: data.id, created: Math.floor(Date.now() / 1000), model: data.model, choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: data.stop_reason }], usage: data.usage ? { prompt_tokens: data.usage.input_tokens, completion_tokens: data.usage.output_tokens, total_tokens: data.usage.input_tokens + data.usage.output_tokens } : undefined };
}
