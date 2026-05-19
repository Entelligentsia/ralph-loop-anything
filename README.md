# pi-ralph

**A [pi](https://github.com/earendil-works/pi) extension** — iterative goal-achievement loop with Generator → Critique → Judge agents.

[![npm](https://img.shields.io/npm/v/@entelligentsia/pi-ralph?style=flat-square)](https://www.npmjs.com/package/@entelligentsia/pi-ralph)

## Install

```
pi install npm:@entelligentsia/pi-ralph
```

Or pin a version:

```
pi install npm:@entelligentsia/pi-ralph@1.0.0
```

From GitHub:

```
pi install git:github.com:Entelligentsia/pi-ralph
```

## What It Does

Give it a goal. It loops — generate, critique, judge — until the goal is met or iterations run out.

Each agent's system prompt is dynamically generated from the goal, so they're domain-aligned from the start. Output streams to chat as it happens — like `tail -f`.

## Usage

```
/ralph-loop-anything --goal "Your goal here" --loop 5
```

- `--goal` (required): The goal to achieve
- `--loop` (optional, default 3): Maximum iterations

## How It Works

```
1. Feasibility check  →  can an LLM do this?
2. Prompt generation   →  domain + agent prompts tailored to the goal
3. Loop (up to N):
   ├─ Generate   →  produces a result
   ├─ Critique   →  identifies problems, suggests improvements
   └─ Judge      →  { done: true/false, reason }
       └── if not done: feeds result + criticism back to Generator
4. Final message with verdict
```

Every step posts a message to chat as it completes. No hidden progress bars — you see each agent's output the moment it arrives.

### LLM Calls Per Run

| Step | Calls |
|------|-------|
| Feasibility | 1 |
| Prompt generation | 1 |
| Per loop iteration | 3 (generate + critique + judge) |

Total for `--loop 3`: 1 + 1 + (3 × 3) = **11** LLM calls

## Examples

### Creative Writing

```
/ralph-loop-anything --goal "Write a complete short story in one sentence and fewer than 10 words that is better than Hemingway could write"
```

```
/ralph-loop-anything --goal "Write a villanelle poem about debugging at 3am"
```

```
/ralph-loop-anything --goal "Invent a new myth that explains why rivers bend, told as if by a 9th-century monk"
```

### Code

```
/ralph-loop-anything --goal "Write an ergonomic CLI argument parser in Rust that handles flags, options, subcommands, and generates help text" --loop 5
```

```
/ralph-loop-anything --goal "Implement a lock-free concurrent hash map in Zig"
```

```
/ralph-loop-anything --goal "Write a single-file SQLite clone in C that supports CREATE TABLE, INSERT, and SELECT with WHERE clauses"
```

### Design & Strategy

```
/ralph-loop-anything --goal "Design a go-to-market strategy for a developer tools startup that has a free CLI tool but wants to monetize a team tier"
```

```
/ralph-loop-anything --goal "Create a 12-week fitness program for a 40-year-old desk worker who has 30 minutes a day and bad knees"
```

```
/ralph-loop-anything --goal "Write a production-ready incident response playbook for a SaaS company experiencing a data breach"
```

### Explaining & Teaching

```
/ralph-loop-anything --goal "Explain monads to a JavaScript developer who has never used Haskell, using only analogies from web development"
```

```
/ralph-loop-anything --goal "Create a 5-minute presentation script that explains neural networks to a room of skeptical middle managers"
```

### Constraints & Style

```
/ralph-loop-anything --goal "Rewrite the Gettysburg Address as if it were a Slack announcement from a tech CEO" --loop 2
```

```
/ralph-loop-anything --goal "Write a recipe for coq au vin where every step is a haiku"
```

```
/ralph-loop-anything --goal "Explain quantum entanglement using only words with 4 letters or fewer"
```

## Architecture

| File | Purpose |
|------|---------|
| `index.ts` | Thin entry point — parses args, calls orchestrator |
| `agents/orchestrator.ts` | Coordinates full flow: feasibility, prompts, loop, verdict |
| `agents/generator.ts` | Generator agent — produces or improves a result |
| `agents/critique.ts` | Critique agent — evaluates result against the goal |
| `agents/judge.ts` | Judge agent — decides if goal is achieved |
| `types.ts` | Shared interfaces (`LoopIteration`, `LoopStep`, etc.) |
| `prompts.ts` | Static system prompts (feasibility, prompt generator, fallbacks) |
| `helpers.ts` | Text utilities (`truncate`, `firstNLines`) |
| `llm.ts` | LLM client (`oneshotLLM`, `parseJsonResponse`) |
| `argParser.ts` | Command argument parsing |
| `renderer.ts` | Message renderer — passes markdown content through |