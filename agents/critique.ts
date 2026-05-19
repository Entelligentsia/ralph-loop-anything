// ============================================================================
// Critique Agent
//
// Evaluates a result against the goal.
// Identifies problems, gaps, and suggests concrete improvements.
// ============================================================================

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { oneshotLLM } from "../llm";
import { FALLBACK_CRITIQUE_PROMPT } from "../prompts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CritiqueInput {
	goal: string;
	systemPrompt: string;
	result: string;
}

export interface CritiqueResult {
	text: string;
	error?: string;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export async function execute(
	ctx: ExtensionCommandContext,
	input: CritiqueInput,
	signal?: AbortSignal,
): Promise<CritiqueResult> {
	const userMsg = buildUserMessage(input);
	const systemPrompt = input.systemPrompt || FALLBACK_CRITIQUE_PROMPT;

	const result = await oneshotLLM(ctx, systemPrompt, userMsg, signal);

	if (result.error) {
		return { text: "", error: result.error };
	}

	return { text: result.text };
}

// ---------------------------------------------------------------------------
// Message Construction
// ---------------------------------------------------------------------------

function buildUserMessage(input: CritiqueInput): string {
	return [
		`Goal: ${input.goal}`,
		``,
		`Result to evaluate:`,
		`${input.result}`,
		``,
		`Critically evaluate this result against the goal. Identify problems and suggest improvements.`,
	].join("\n");
}

// ---------------------------------------------------------------------------
// Chat Message Formatting
// ---------------------------------------------------------------------------

export function formatBefore(loop: number, maxLoops: number): string {
	return `## Loop ${loop}/${maxLoops} — Critiquing...`;
}

export function formatAfter(loop: number, maxLoops: number, text: string): string {
	return `## Loop ${loop}/${maxLoops} — Critique\n\n${text}`;
}

export function formatError(loop: number, maxLoops: number, error: string): string {
	return `## Loop ${loop}/${maxLoops} — Critique failed\n\n${error}`;
}