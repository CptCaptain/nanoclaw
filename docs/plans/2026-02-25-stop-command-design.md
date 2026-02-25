# Global Emergency Stop / Resume / Abort Design

## Goal
Add a global emergency control plane so `/stop` immediately halts ongoing agent activity across all groups/runtimes, surfaces actionable recovery options, and keeps the system paused until the operator explicitly resumes.

## Scope
- Add global control commands: `/stop`, `/resume`, `/abort`, `/clear` (alias), `/diagnose`.
- Process emergency commands immediately on inbound message receipt (not delayed by polling/active model output).
- Apply globally across groups, active turns, queued work, and spawned subagents.
- Prefer pause/interrupt over kill; escalate only when pause/interrupt fails.

## User-Approved Constraints
- `/stop` must cut through normal processing and halt active work quickly.
- Scope is global (all groups/tasks), not per-chat.
- `/stop` should show status and options (active, queued, next actions).
- `/resume` should **not** auto-continue interrupted work; wait for fresh instruction.
- `/abort`/`/clear` should stop continuation work and clear pending execution state.
- Prefer graceful/cooperative interruption and pause (SIGSTOP / container pause) before kill.

## Architecture
Introduce a host-level safety controller (in `src/index.ts` + queue/runner hooks) that owns global execution state:
- `paused: boolean`
- `reason?: string`
- `stoppedAt?: string`
- optional latest status snapshot for operator diagnostics

Emergency commands are handled out-of-band from normal prompt routing so they are never forwarded to the agent. The controller fans stop/resume/abort actions to queue and runtime layers.

## Commands and Semantics

### `/stop`
1. Set global `paused = true` immediately.
2. Snapshot active/queued work.
3. Attempt cooperative runtime interrupt (short grace window).
4. If still active, pause runtime execution (container pause and/or process SIGSTOP).
5. If pause fails or timeout expires, hard-stop fallback.
6. Send operator status message with available options.

### `/resume`
- Leave paused mode and unpause runtime execution where needed.
- Do **not** resume previously interrupted turn automatically.
- Return to idle awaiting new operator instruction.

### `/abort` and `/clear`
- Stop active continuation work.
- Drop queued pending work and continuation state.
- Keep conversation history/state records intact.
- Remain paused (safety-first) until `/resume`.

### `/diagnose`
- Report current safety state, active work, queued work, and suggested recovery actions.
- v1 is status+guidance; optional safety-copilot launch can be added in phase 2.

## Component Plan

1. **Control parser + handlers** (`src/index.ts` or helper module)
   - Parse commands with/without trigger prefix.
   - Handle commands before regular routing.

2. **Immediate ingestion path** (`src/index.ts` channel callback)
   - Execute emergency commands synchronously on inbound events.

3. **Queue controls** (`src/group-queue.ts`)
   - Add paused dispatch gate.
   - Add state snapshot API.
   - Add pending-work abort API.
   - Add active runtime interrupt/pause hooks.

4. **Runtime interruption/pause hooks**
   - Host/runtime integration (`src/container-runner.ts`, `src/container-runtime.ts`).
   - Runner-side interrupt observation (`container/agent-runner/src/index.ts`).
   - Cooperative interrupt first, then pause, then kill fallback.

5. **Telegram ingress compatibility** (`src/channels/telegram.ts`)
   - Allow emergency slash commands through intake while preserving existing bot-command behavior.

6. **Operator UX templates** (`src/index.ts`)
   - Standardized responses for stop/resume/abort/diagnose with clear next actions.

## Data Flow
1. Inbound message arrives.
2. Emergency parser checks message first.
3. If control command: execute host-side action and return.
4. If paused and non-control message: do not dispatch; inform operator to use `/resume` or abort.
5. If not paused: continue normal queue/agent routing.

## Error Handling
- Best-effort layered stop: interrupt → pause → hard-stop.
- Idempotent command handling with deterministic responses.
- Partial-failure reporting in `/diagnose`.
- No stack traces in user-facing channel messages.

## Testing Strategy
1. **Queue tests** (`src/group-queue.test.ts`)
   - paused gate blocks dispatch
   - abort clears pending
   - snapshot correctness

2. **Parser/flow tests** (new or extracted index tests)
   - trigger-stripped command recognition
   - stop/resume/abort state transitions
   - resume does not auto-run prior interrupted turn

3. **Telegram tests** (`src/channels/telegram.test.ts`)
   - emergency commands are accepted (not dropped by generic slash filtering)

4. **Runner/runtime tests**
   - cooperative interrupt detection and escalation behavior
   - codex/claude pause/stop fallback handling

5. **Integration smoke**
   - active turn + `/stop` halts quickly
   - `/diagnose` reflects reality
   - `/resume` returns to idle awaiting new instruction

## Risks / Trade-offs
- Pause semantics differ across runtimes/platforms; abstraction in `container-runtime.ts` must normalize behavior.
- For very short-lived commands, pause may race with natural completion.
- Immediate command handling adds concurrency complexity; must keep state transitions atomic and idempotent.

## Success Criteria
- `/stop` globally halts active processing quickly and safely.
- Operator gets a clear status/options message immediately.
- `/resume` requires explicit post-resume instruction.
- `/abort` reliably clears pending continuation work.
- No accidental continued execution while paused.
