/** Vertrag mit KI schreiben: Beschreibung in Alltagssprache → fertige Bausteine (Claude über invokeLLM). Ohne KI-Schlüssel: passende Vorlage. */
import { invokeLLM } from "./_core/llm";
import { aiDraftToContract, CONTRACT_AI_SCHEMA, CONTRACT_AI_SYSTEM, fallbackContractFromPrompt, type AiContractDraft, type ContractBlock } from "../shared/contracts";

export async function draftContractWithAi(input: { prompt: string; current?: { title: string; blocks: ContractBlock[] } | null }): Promise<{ title: string; blocks: ContractBlock[]; source: "ki" | "vorlage" }> {
  const prompt = input.prompt.trim(); if (prompt.length < 10) throw new Error("Bitte beschreibe kurz, worum es im Vertrag gehen soll.");
  if (!process.env.ANTHROPIC_API_KEY) return { ...fallbackContractFromPrompt(prompt), source: "vorlage" };
  const current = input.current?.blocks?.length ? `\n\nBisheriger Vertrag (überarbeiten statt neu erfinden, wenn die Beschreibung eine Änderung ist):\n${JSON.stringify({ title: input.current.title, blocks: input.current.blocks.filter((block) => ["heading", "text", "bullets", "detail"].includes(block.type)) }).slice(0, 20000)}` : "";
  const response = await invokeLLM({ maxTokens: 6000, temperature: 0.3, outputSchema: CONTRACT_AI_SCHEMA, messages: [{ role: "system", content: CONTRACT_AI_SYSTEM }, { role: "user", content: `Beschreibung:\n${prompt.slice(0, 6000)}${current}` }] });
  let parsed: Partial<AiContractDraft> | null = null; try { parsed = JSON.parse(response.choices[0]?.message.content ?? "null"); } catch { parsed = null; }
  return { ...aiDraftToContract(parsed), source: "ki" };
}
