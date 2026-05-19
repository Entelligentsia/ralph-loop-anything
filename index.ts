/**
 * Ralph Loop Extension
 *
 * Iterative goal-achievement loop with Generator → Critique → Judge agents.
 * Each step sends a message to chat as it completes — tail -f style.
 *
 * Architecture:
 *   index.ts              — thin entry point, registers command & renderer
 *   agents/orchestrator   — coordinates the full flow
 *   agents/generator      — produces or improves a result
 *   agents/critique       — evaluates a result against the goal
 *   agents/judge          — decides if the goal is achieved
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { parseArgs } from "./argParser";
import { renderRalphLoopMessage } from "./renderer";
import * as Orchestrator from "./agents/orchestrator";

export default function (pi: ExtensionAPI) {

	pi.registerCommand("ralph-loop-anything", {
		description: "Run a dynamic Ralph loop (Generator->Critique->Judge) to achieve a goal",
		getArgumentCompletions: (prefix: string) => {
			const items = [
				{ value: '--goal "', label: '--goal "specify your goal"' },
				{ value: "--loop ", label: "--loop N (default 3)" },
			];
			const filtered = items.filter((i) =>
				i.value.startsWith(prefix) || i.label.startsWith(prefix)
			);
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			let parsed: ReturnType<typeof parseArgs>;
			try {
				parsed = parseArgs(args);
			} catch (err: any) {
				ctx.ui.notify(`Failed: ${err.message}`, "error");
				return;
			}

			if (!ctx.model) {
				ctx.ui.notify("No model selected. Use /model to select one.", "error");
				return;
			}

			ctx.ui.notify(`Ralph Loop: "${parsed.goal}" (max ${parsed.loop} iterations)`, "info");

			await Orchestrator.execute(pi, ctx, {
				goal: parsed.goal,
				maxLoops: parsed.loop,
			});
		},
	});

	pi.registerMessageRenderer("ralph-loop", (message, theme) => {
		return renderRalphLoopMessage(message, theme);
	});
}