// ============================================================================
// Orchestrator Agent
//
// Coordinates the full ralph-loop flow:
//   1. Feasibility check
//   2. Domain identification + agent prompt generation
//   3. Loop: Generator → Critique → Judge (repeat until done or max loops)
//   4. Final verdict
//
// Every step posts a message to chat as it completes — tail -f style.
// ============================================================================

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { oneshotLLM, parseJsonResponse } from "../llm";
import { FEASIBILITY_PROMPT, PROMPT_GENERATOR_PROMPT, FALLBACK_GENERATOR_PROMPT, FALLBACK_CRITIQUE_PROMPT, FALLBACK_JUDGE_PROMPT } from "../prompts";
import { truncate } from "../helpers";
import * as Generator from "./generator";
import * as Critique from "./critique";
import * as Judge from "./judge";
import type { AgentPrompts, RalphLoopResult, LoopIteration } from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OrchestratorInput {
	goal: string;
	maxLoops: number;
}

export interface OrchestratorResult {
	details: RalphLoopResult;
	achieved: boolean;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export async function execute(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	input: OrchestratorInput,
): Promise<OrchestratorResult | null> {
	const { goal, maxLoops } = input;
	const signal = ctx.signal;

	// ── Step 1: Feasibility ──────────────────────────────────────────
	send(pi, `## Checking feasibility\n\n> ${goal}\n\nEvaluating whether this goal is achievable with an LLM...`);

	const feasibilityPrompt = `Evaluate whether this goal is achievable using an LLM: "${goal}"`;
	const feasibility = await oneshotLLM(ctx, FEASIBILITY_PROMPT, feasibilityPrompt, signal);

	if (feasibility.error) {
		send(pi, `## Feasibility check failed\n\n${feasibility.error}`);
		persistToSession(ctx, goal, `Feasibility check failed: ${feasibility.error}`, undefined);
		return null;
	}

	const feasibilityJson = parseJsonResponse<{ achievable?: boolean; reason?: string }>(feasibility.text);
	let feasible = true;
	let feasibilityReason = "";

	if (feasibilityJson) {
		feasible = feasibilityJson.achievable !== false;
		feasibilityReason = feasibilityJson.reason || "";
	} else {
		feasibilityReason = "Could not parse feasibility response; proceeding anyway";
	}

	if (!feasible) {
		send(pi, `## Goal not achievable\n\n${feasibilityReason || feasibility.text.slice(0, 500)}`);
		persistToSession(ctx, goal, `Goal not achievable: ${feasibilityReason || feasibility.text.slice(0, 500)}`, undefined);
		return null;
	}

	send(pi, `## Feasibility: Yes\n\n${feasibilityReason}\n\nGenerating agent prompts...`);

	// ── Step 2: Generate agent prompts ───────────────────────────────
	const promptGenResult = await generateAgentPrompts(ctx, goal, signal);

	let agentPrompts: AgentPrompts;
	let domain: string;

	if (promptGenResult) {
		agentPrompts = promptGenResult.prompts;
		domain = promptGenResult.domain;
		send(pi, formatPromptsMessage(domain, agentPrompts));
	} else {
		agentPrompts = {
			generator_prompt: FALLBACK_GENERATOR_PROMPT,
			critique_prompt: FALLBACK_CRITIQUE_PROMPT,
			judge_prompt: FALLBACK_JUDGE_PROMPT,
		};
		domain = "General";
	}

	// ── Step 3: Ralph Loop ───────────────────────────────────────────
	const iterations: LoopIteration[] = [];
	let currentResult = "";
	let currentCriticism = "";

	for (let i = 1; i <= maxLoops; i++) {
		const iteration = buildIteration(i);

		// ── Generate ──
		send(pi, Generator.formatBefore(i, maxLoops));
		const genResult = await Generator.execute(ctx, {
			goal,
			systemPrompt: agentPrompts.generator_prompt,
			previousResult: i > 1 ? currentResult : undefined,
			previousCriticism: i > 1 ? currentCriticism : undefined,
		}, signal);

		if (genResult.error) {
			send(pi, Generator.formatError(i, maxLoops, genResult.error));
			persistToSession(ctx, goal, `Generator failed: ${genResult.error}`, undefined);
			return null;
		}

		currentResult = genResult.text;
		iteration.steps.push({ type: "generate", preview: truncate(currentResult, 100), full: currentResult });
		send(pi, Generator.formatAfter(i, maxLoops, currentResult));

		// ── Critique ──
		send(pi, Critique.formatBefore(i, maxLoops));
		const critResult = await Critique.execute(ctx, {
			goal,
			systemPrompt: agentPrompts.critique_prompt,
			result: currentResult,
		}, signal);

		if (critResult.error) {
			send(pi, Critique.formatError(i, maxLoops, critResult.error));
			persistToSession(ctx, goal, `Critique failed: ${critResult.error}`, undefined);
			return null;
		}

		currentCriticism = critResult.text;
		iteration.steps.push({ type: "critique", preview: truncate(currentCriticism, 100), full: currentCriticism });
		send(pi, Critique.formatAfter(i, maxLoops, currentCriticism));

		// ── Judge ──
		send(pi, Judge.formatBefore(i, maxLoops));
		const judgeResult = await Judge.execute(ctx, {
			goal,
			systemPrompt: agentPrompts.judge_prompt,
			result: currentResult,
			criticism: currentCriticism,
		}, signal);

		if (judgeResult.error) {
			send(pi, Judge.formatError(i, maxLoops, judgeResult.error));
			persistToSession(ctx, goal, `Judge failed: ${judgeResult.error}`, undefined);
			return null;
		}

		iteration.steps.push({ type: "judge", verdict: judgeResult.done, reason: judgeResult.reason, raw: judgeResult.raw });
		iteration.achieved = judgeResult.done;
		iteration.finalResult = currentResult;
		iteration.finalCriticism = currentCriticism;
		iteration.finalJudgeReason = judgeResult.reason;

		iterations.push(iteration);

		send(pi, Judge.formatAfter(i, maxLoops, judgeResult.done, judgeResult.reason));

		if (judgeResult.done) break;
	}

	// ── Step 4: Final verdict ─────────────────────────────────────────
	const lastIteration = iterations[iterations.length - 1];
	const achieved = lastIteration?.achieved ?? false;
	const verdictReason = lastIteration?.finalJudgeReason || "no judgment rendered";
	const finalLabel = achieved ? "GOAL ACHIEVED ✓" : "GOAL NOT FULLY ACHIEVED ✗";

	const lines: string[] = [];
	lines.push(`## Result: ${finalLabel}`);
	lines.push(``);
	lines.push(`> ${verdictReason}`);
	lines.push(``);
	lines.push(`---`);
	lines.push(``);
	lines.push(`**Final output:**`);
	lines.push(``);
	lines.push(lastIteration?.finalResult || "(no result)");

	if (lastIteration?.finalCriticism && lastIteration.finalCriticism.trim()) {
		lines.push(``);
		lines.push(`**Final criticism:**`);
		lines.push(``);
		lines.push(lastIteration.finalCriticism);
	}

	lines.push(``);
	lines.push(`---`);
	lines.push(``);
	lines.push(`*${iterations.length}/${maxLoops} iterations, domain: ${domain}*`);

	const finalText = lines.join("\n");

	const details: RalphLoopResult = {
		goal,
		domain,
		maxLoops,
		loopCount: iterations.length,
		achieved,
		feasibilityReason,
		feasibilityRaw: feasibility.text,
		agentPrompts,
		result: lastIteration?.finalResult || "",
		criticism: lastIteration?.finalCriticism || "",
		judgeReason: lastIteration?.finalJudgeReason || "",
		iterations,
	};

	send(pi, finalText, details);

	// ── Step 5: Persist as conversation messages ────────────────────────
	// pi.sendMessage() creates custom_message entries, but /export and /share
	// require the session file to exist on disk. The session file is only
	// flushed when an assistant message is present (SessionManager._persist
	// defers writes until an assistant entry triggers a full flush). Without
	// this, /export returns "Nothing to export yet - start a conversation first".
	persistToSession(ctx, goal, finalText, lastIteration);

	return { details, achieved };
}

// ---------------------------------------------------------------------------
// Agent Prompt Generation
// ---------------------------------------------------------------------------

async function generateAgentPrompts(
	ctx: ExtensionCommandContext,
	goal: string,
	signal: AbortSignal | undefined,
): Promise<{ prompts: AgentPrompts; domain: string } | null> {
	const userMsg = `Design system prompts for three agents that will work together to achieve this goal:

"${goal}"

Each prompt must be specifically tailored to this goal's domain. Output the JSON with keys: domain, generator_prompt, critique_prompt, judge_prompt. The "domain" field should identify the subject area (e.g., "Literary Fiction", "Systems Programming", "Business Strategy").`;

	const result = await oneshotLLM(ctx, PROMPT_GENERATOR_PROMPT, userMsg, signal);

	if (result.error) return null;

	const json = parseJsonResponse<{ domain?: string; generator_prompt?: string; critique_prompt?: string; judge_prompt?: string }>(result.text);

	if (
		!json ||
		typeof json.generator_prompt !== "string" ||
		typeof json.critique_prompt !== "string" ||
		typeof json.judge_prompt !== "string"
	) return null;

	return {
		prompts: {
			generator_prompt: json.generator_prompt,
			critique_prompt: json.critique_prompt,
			judge_prompt: json.judge_prompt,
		},
		domain: json.domain || "General",
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildIteration(loop: number): LoopIteration {
	return {
		loop,
		steps: [],
		achieved: false,
		finalResult: "",
		finalCriticism: "",
		finalJudgeReason: "",
	};
}

// ---------------------------------------------------------------------------
// Session Persistence (for /export and /share)
// ---------------------------------------------------------------------------

/**
 * Append user + assistant messages to the session so /export and /share work.
 *
 * pi.sendMessage() creates custom_message entries (role: "custom"), but
 * SessionManager._persist() won't write the session file to disk until an
 * assistant message exists. This means /export finds no file and returns
 * "Nothing to export yet - start a conversation first". By appending a
 * proper user/assistant pair, the session flushes to disk and becomes
 * exportable.
 */
function persistToSession(
	ctx: ExtensionCommandContext,
	goal: string,
	finalText: string,
	_lastIteration: LoopIteration | undefined,
): void {
	ctx.sessionManager.appendMessage({
		role: "user",
		content: `Ralph Loop: "${goal}"`,
		timestamp: Date.now(),
	});

	ctx.sessionManager.appendMessage({
		role: "assistant",
		content: [{ type: "text", text: finalText }],
		api: "ralph-loop",
		provider: ctx.model?.provider || "ralph-loop",
		model: ctx.model?.id || "unknown",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	});
}

function send(pi: ExtensionAPI, content: string, details?: RalphLoopResult): void {
	pi.sendMessage({
		customType: "ralph-loop",
		content,
		display: true,
		...(details ? { details } : {}),
	});
}

function formatPromptsMessage(domain: string, prompts: AgentPrompts): string {
	return [
		`## Agent Prompts — Domain: ${domain}`,
		``,
		`### Generator`,
		``,
		prompts.generator_prompt,
		``,
		`### Critique`,
		``,
		prompts.critique_prompt,
		``,
		`### Judge`,
		``,
		prompts.judge_prompt,
	].join("\n");
}