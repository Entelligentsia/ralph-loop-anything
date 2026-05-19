// ============================================================================
// Generator Agent
//
// Produces or improves a result for the goal.
// On first run: works from the goal alone.
// On revision: receives previous result + criticism and improves.
// ============================================================================

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { oneshotLLM } from "../llm";
import { FALLBACK_GENERATOR_PROMPT } from "../prompts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GeneratorInput {
	goal: string;
	systemPrompt: string;
	/** Previous result to improve (undefined on first run) */
	previousResult?: string;
	/** Criticism of previous result (undefined on first run) */
	previousCriticism?: string;
}

export interface GeneratorResult {
	text: string;
	error?: string;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export async function execute(
	ctx: ExtensionCommandContext,
	input: GeneratorInput,
	signal?: AbortSignal,
): Promise<GeneratorResult> {
	const userMsg = buildUserMessage(input);
	const systemPrompt = input.systemPrompt || FALLBACK_GENERATOR_PROMPT;

	const result = await oneshotLLM(ctx, systemPrompt, userMsg, signal);

	if (result.error) {
		return { text: "", error: result.error };
	}

	return { text: result.text };
}

// ---------------------------------------------------------------------------
// Message Construction
// ---------------------------------------------------------------------------

function buildUserMessage(input: GeneratorInput): string {
	if (!input.previousResult) {
		return `Goal: ${input.goal}\n\nProduce your best result to achieve this goal.`;
	}

	return [
		`Goal: ${input.goal}`,
		``,
		`Previous result:`,
		`${input.previousResult}`,
		``,
		`Criticism of the previous result:`,
		`${input.previousCriticism || "(none)"}`,
		``,
		`Improve upon the previous result, carefully addressing all the criticisms. Produce a better version.`,
	].join("\n");
}

// ---------------------------------------------------------------------------
// Chat Message Formatting
// ---------------------------------------------------------------------------

export function formatBefore(loop: number, maxLoops: number): string {
	return `## Loop ${loop}/${maxLoops} — Generating...`;
}

export function formatAfter(loop: number, maxLoops: number, text: string): string {
	return `## Loop ${loop}/${maxLoops} — Generated\n\n${text}`;
}

export function formatError(loop: number, maxLoops: number, error: string): string {
	return `## Loop ${loop}/${maxLoops} — Generator failed\n\n${error}`;
}