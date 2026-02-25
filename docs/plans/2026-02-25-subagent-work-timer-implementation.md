# Subagent-Aware Work Timer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add subagent/nested-process utilization metrics to work-timer stats with no double counting, and auto-reset old logs.

**Architecture:** Upgrade work-timer log events to schema v2 with trace metadata (`rootSessionId`, `parentSessionId`, `runKind`, `runSource`). Propagate context from parent to nested `pi` runs via env vars, then compute delegated wall-clock and summed runtime from nested intervals. Render a new `Subagent utilization` section in stats output.

**Tech Stack:** TypeScript, Pi extension API (`session_start`, `agent_start`, `agent_end`, `input`), Node child process spawn env, JSONL logs.

---

### Task 1: Add schema-v2 event model and trace context wiring

**Files:**
- Modify: `~/.pi/agent/extensions/work-timer-status.ts`

**Step 1: Add failing test scaffolding in-code via temporary assertion helper**

Add a temporary internal assertion block (guarded by `if (process.env.WORK_TIMER_SELFTEST === "1")`) that validates:
- events always include `schemaVersion`, `rootSessionId`, `parentSessionId`, `runKind`, `runSource`
- root runs use `parentSessionId: null`

Expected initial failure: old event shape misses fields.

**Step 2: Add schema-v2 fields to event type and builders**

Implement:
```ts
type RunKind = "root" | "nested";
type RunSource = "interactive" | "subagent" | "unknown";

interface TraceContext {
  schemaVersion: 2;
  rootSessionId: string;
  parentSessionId: string | null;
  runKind: RunKind;
  runSource: RunSource;
}
```

Embed this in every `WorkTimerLogEvent` line.

**Step 3: Resolve trace context on `session_start`**

Read env vars:
- `PI_WORK_TIMER_ROOT_SESSION_ID`
- `PI_WORK_TIMER_PARENT_SESSION_ID`
- `PI_WORK_TIMER_RUN_SOURCE`

Rules:
- no parent env => root run (`parentSessionId=null`, `runKind="root"`, `runSource="interactive"`)
- parent env present => nested run (`runKind="nested"`, `runSource` from env or `unknown`)

**Step 4: Remove temporary selftest guard or keep as opt-in debug**

If kept, make it no-op unless env flag set.

**Step 5: Commit**

```bash
git add ~/.pi/agent/extensions/work-timer-status.ts
git commit -m "feat(work-timer): add schema v2 trace context to log events"
```

---

### Task 2: Auto-reset existing logs for schema migration

**Files:**
- Modify: `~/.pi/agent/extensions/work-timer-status.ts`

**Step 1: Write failing check for schema mismatch detection**

Add helper expectations:
- if log exists and first parseable line is missing `schemaVersion: 2`, reset should trigger.

**Step 2: Implement reset helper**

Add:
```ts
async function ensureSchemaV2Logs(paths: string[]): Promise<void>
```
Behavior:
- for each target log path (`~/.pi/agent/logs/work-timer.jsonl`, `<cwd>/.pi/logs/work-timer.jsonl`):
  - read first parseable line
  - if absent or not v2 -> truncate file (overwrite empty)

**Step 3: Call reset once on `session_start` before first append**

Guarantee all new lines are v2 after startup.

**Step 4: Commit**

```bash
git add ~/.pi/agent/extensions/work-timer-status.ts
git commit -m "feat(work-timer): auto-reset pre-v2 timer logs"
```

---

### Task 3: Add nested/delegated stats math

**Files:**
- Modify: `~/.pi/agent/extensions/work-timer-status.ts`

**Step 1: Write failing pure-function checks**

Create tiny inline fixture arrays and assert:
- delegated wall-clock uses interval union
- delegated summed runtime sums raw intervals
- direct work = total work - delegated wall-clock (clamped)

**Step 2: Implement interval utilities**

Add pure helpers:
```ts
function unionDuration(intervals: Array<{startMs:number; endMs:number}>): number
function sumDuration(intervals: Array<{startMs:number; endMs:number}>): number
```

**Step 3: Build run summaries from events**

Group by `sessionId`, compute run intervals from `agent_start`/`agent_end`, retain trace context.

**Step 4: Compute root-level delegated metrics**

For each root:
- find nested runs with matching `rootSessionId`
- compute:
  - delegatedWallClock
  - delegatedSummedRuntime
  - directWork
  - delegationShare
  - parallelismFactor

**Step 5: Commit**

```bash
git add ~/.pi/agent/extensions/work-timer-status.ts
git commit -m "feat(work-timer): compute delegated and direct work metrics"
```

---

### Task 4: Render `Subagent utilization` section in `/work-timer stats`

**Files:**
- Modify: `~/.pi/agent/extensions/work-timer-status.ts`

**Step 1: Add failing formatting expectations**

Ensure report includes lines:
- `Subagent utilization`
- `Runs:`
- `Delegated wall-clock:`
- `Delegated summed runtime:`
- `Direct work:`
- `Delegation share:`
- `Parallelism factor:`

**Step 2: Extend stats models**

Add fields to scope stats object:
```ts
nestedRunCount
nestedRunCountSubagent
nestedRunCountOther
delegatedWallClockMs
delegatedSummedRuntimeMs
directWorkMs
delegationSharePct
parallelismFactor
```

**Step 3: Append section to formatted report**

Do not change top-level existing lines except where needed for direct work consistency.

**Step 4: Commit**

```bash
git add ~/.pi/agent/extensions/work-timer-status.ts
git commit -m "feat(work-timer): add subagent utilization stats section"
```

---

### Task 5: Propagate tracing env in subagent spawns

**Files:**
- Modify: `~/.pi/agent/extensions/subagent/index.ts`

**Step 1: Add failing behavior check (manual)**

Run one subagent call and inspect latest timer lines.
Expected pre-change: nested lines missing `runSource: subagent` and parent linkage.

**Step 2: Inject env into `spawn("pi", ...)`**

In `runSingleAgent`, set:
```ts
env: {
  ...process.env,
  PI_WORK_TIMER_ROOT_SESSION_ID: <current root session id>,
  PI_WORK_TIMER_PARENT_SESSION_ID: <current session id>,
  PI_WORK_TIMER_RUN_SOURCE: "subagent",
}
```

Use `ctx.sessionManager.getSessionFile() ?? "ephemeral"` for parent id source.

**Step 3: Verify env is per-child (no global mutation)**

Do not mutate `process.env` globally for source tags.

**Step 4: Commit**

```bash
git add ~/.pi/agent/extensions/subagent/index.ts
git commit -m "feat(subagent): propagate work-timer trace context to child pi runs"
```

---

### Task 6: End-to-end verification

**Files:**
- Modify (if needed): `~/.pi/agent/extensions/work-timer-status.ts`
- Modify (if needed): `~/.pi/agent/extensions/subagent/index.ts`

**Step 1: Single nested run scenario**

- Start session, run one subagent task.
- Run: `/work-timer stats session`

Expected:
- `Subagent utilization` section present
- runs >= 1
- delegated wall-clock > 0
- direct + delegated wall-clock ~= total work

**Step 2: Parallel nested run scenario**

- Trigger parallel subagent tasks.
- Run: `/work-timer stats session`

Expected:
- `delegated summed runtime >= delegated wall-clock`
- `parallelism factor > 1.0`

**Step 3: Project/global scenarios**

- Run: `/work-timer stats project`
- Run: `/work-timer stats global`

Expected:
- section renders without errors
- nested counts aggregate across roots

**Step 4: Confirm auto-reset worked**

Check both log files were truncated/recreated to v2 lines before new entries.

**Step 5: Final commit**

```bash
git add ~/.pi/agent/extensions/work-timer-status.ts ~/.pi/agent/extensions/subagent/index.ts
git commit -m "test(work-timer): verify nested utilization metrics and schema reset"
```

---

### Task 7: Documentation note (optional but recommended)

**Files:**
- Modify: `~/.pi/agent/extensions/work-timer-status.ts` (command description/help text)
- Optionally create: `~/.pi/agent/extensions/work-timer-status.md`

**Step 1: Document metric semantics**

Clarify:
- delegated wall-clock vs delegated summed runtime
- no-double-count identity
- parallelism factor interpretation

**Step 2: Commit**

```bash
git add ~/.pi/agent/extensions/work-timer-status.ts ~/.pi/agent/extensions/work-timer-status.md
git commit -m "docs(work-timer): document subagent utilization metrics"
```

---

## Final verification checklist

- `/work-timer stats session|project|global` all render `Subagent utilization`
- No runtime exceptions from old logs (because logs are reset)
- Direct/delegated math is consistent
- Parallel scenario shows factor > 1

