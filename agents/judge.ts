// ============================================================================
// Judge Agent
//
// Determines if a result adequately achieves the goal, given the criticism.
// Returns structured verdict: { done: boolean, reason: string }.
// ============================================================================

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { oneshotLLM, parseJsonResponse } from "../llm";
import { FALLBACK_JUDGE_PROMPT } from "../prompts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JudgeInput {
	goal: string;
	systemPrompt: string;
	result: string;
	criticism: string;
}

export interface JudgeResult {
	done: boolean;
	reason: string;
	raw: string;
	error?: string;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export async function execute(
	ctx: ExtensionCommandContext,
	input: JudgeInput,
	signal?: AbortSignal,
): Promise<JudgeResult> {
	const userMsg = buildUserMessage(input);
	const systemPrompt = input.systemPrompt || FALLBACK_JUDGE_PROMPT;

	const result = await oneshotLLM(ctx, systemPrompt, userMsg, signal);

	if (result.error) {
		return { done: false, reason: "", raw: "", error: result.error };
	}

	const parsed = parseJsonResponse<{ done?: boolean; reason?: string }>(result.text);
	let done = false;
	let reason = "";

	if (parsed) {
		done = parsed.done === true;
		reason = parsed.reason || "";
	} else {
		reason = `(could not parse judge response) ${result.text.slice(0, 200)}`;
	}

	return { done, reason, raw: result.text };
}

// ---------------------------------------------------------------------------
// Message Construction
// ---------------------------------------------------------------------------

function buildUserMessage(input: JudgeInput): string {
	return [
		`Goal: ${input.goal}`,
		``,
		`Result:`,
		`${input.result}`,
		``,
		`Criticism:`,
		`${input.criticism}`,
		``,
		`Determine if the goal has been adequately achieved. Respond with JSON.`,
	].join("\n");
}

// ---------------------------------------------------------------------------
// Chat Message Formatting
// ---------------------------------------------------------------------------

export function formatBefore(loop: number, maxLoops: number): string {
	return `## Loop ${loop}/${maxLoops} — Judging...`;
}

export function formatAfter(loop: number, maxLoops: number, done: boolean, reason: string): string {
	const verdict = done ? "DONE ✓" : "CONTINUE ✗";
	return `## Loop ${loop}/${maxLoops} — Judge: ${verdict}\n\n${reason}`;
}

export function formatError(loop: number, maxLoops: number, error: string): string {
	return `## Loop ${loop}/${maxLoops} — Judge failed\n\n${error}`;
}