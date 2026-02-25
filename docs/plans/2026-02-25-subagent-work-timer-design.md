# Subagent-Aware Work Timer Design

**Date:** 2026-02-25  
**Status:** Approved

## Goal

Add subagent utilization metrics to the work timer so we can understand delegation behavior without double-counting parent work.

## Decisions (from discussion)

1. Show both **time-based** and **count-based** subagent metrics.
2. Present metrics in a separate **"Subagent utilization"** section in `/work-timer stats ...` output.
3. Avoid double counting by splitting work into:
   - **Direct work** (non-delegated)
   - **Delegated wall-clock** (nested overlap removed)
4. Also show **delegated summed runtime** (keeps parallel amplification visible).
5. Scope of tracking: **any nested `pi` process** that inherits timer trace context (not only `subagent` tool).
6. Apply to **stats only** (no status bar change).
7. **No backwards compatibility requirement** for old log schema.
8. **Auto-reset existing work-timer logs** on first run after update.

---

## High-Level Architecture

### 1) Extend log event schema with trace context

Current `WorkTimerLogEvent` is session-local. We will add mandatory trace fields to all newly-written events:

- `schemaVersion: 2`
- `rootSessionId: string`
- `parentSessionId: string | null`
- `runKind: "root" | "nested"`
- `runSource: "interactive" | "subagent" | "unknown"`

This turns logs into a trace graph that can attribute nested runs to a root run.

### 2) Propagate context to nested `pi` processes

Nested `pi` runs receive context through environment variables:

- `PI_WORK_TIMER_ROOT_SESSION_ID`
- `PI_WORK_TIMER_PARENT_SESSION_ID`
- `PI_WORK_TIMER_RUN_SOURCE`

At `session_start`, `work-timer-status` reads these vars and stamps them into event state.

### 3) Subagent integration

`extensions/subagent/index.ts` sets/forwards the env vars when spawning subagents:

- parent = current session file/id
- run source = `subagent`

This enables high-confidence subagent attribution while still supporting other nested process types (`unknown`).

### 4) Stats computation model

For each root session in scope:

- Build prompt/run intervals from `agent_start -> agent_end` for root and nested runs.
- Compute:
  - `totalWork` (existing definition)
  - `delegatedWallClock` = union duration of nested intervals
  - `delegatedSummedRuntime` = sum duration of nested intervals
  - `directWork = max(0, totalWork - delegatedWallClock)`

Additivity guarantee (no double counting):

- `directWork + delegatedWallClock = totalWork`

Parallelism visibility:

- `parallelismFactor = delegatedSummedRuntime / delegatedWallClock` (when wall-clock > 0)

---

## Stats Output Changes

Keep existing section and append:

### Subagent utilization

- `Runs: <n> (subagent: <x>, other nested: <y>)`
- `Delegated wall-clock: <duration>`
- `Delegated summed runtime: <duration>`
- `Direct work: <duration>`
- `Delegation share: <percent>` (delegated wall-clock / total work)
- `Parallelism factor: <value>x`

Applies to `session`, `project`, and `global` scopes.

---

## Breaking-Change / Migration Strategy

No compatibility path for old schema.

On first startup after deployment:

1. Detect missing/old schema marker in log file.
2. Auto-reset logs (`~/.pi/agent/logs/work-timer.jsonl` and project `.pi/logs/work-timer.jsonl`).
3. Start writing schema v2 only.

Optional lightweight marker line can be written at top/start event sequence to simplify future upgrades.

---

## Error Handling / Edge Cases

- Ignore incomplete intervals (missing `agent_end`).
- Clamp invalid durations to zero.
- Treat orphan nested runs as nested only when trace context is complete.
- Keep stats deterministic under parallel overlap by using interval-union logic.

---

## Files Expected to Change

- `~/.pi/agent/extensions/work-timer-status.ts`
  - schema update
  - trace ingestion/propagation
  - delegated/direct math
  - stats rendering section
  - log auto-reset logic
- `~/.pi/agent/extensions/subagent/index.ts`
  - env propagation for nested process tracing

---

## Validation Plan

1. Unit tests for:
   - interval union
   - direct/delegated formulas
   - parallelism factor
2. Integration fixtures:
   - root-only
   - root + sequential nested
   - root + parallel nested
3. Manual smoke:
   - run subagent once, verify section appears
   - run parallel subagents, verify factor > 1
   - verify no double counting identity holds

---

## Non-Goals

- No status bar redesign.
- No migration/read support for old schema logs.
- No UI changes outside `/work-timer stats ...` output.
