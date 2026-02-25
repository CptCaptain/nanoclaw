# Global Emergency Stop Commands Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add global `/stop`, `/resume`, `/abort` (`/clear`) and `/diagnose` commands that halt active work immediately, pause new dispatch, and require fresh instruction after resume.

**Architecture:** Parse emergency commands before normal routing, then drive a host-level safety controller that orchestrates queue gating and runtime interruption. Use layered stop semantics (cooperative close -> container pause -> hard stop fallback) with deterministic operator feedback. Keep logic testable via small helper/controller modules and queue/runtime abstractions.

**Tech Stack:** TypeScript, Node.js, Vitest, Docker CLI runtime abstraction, existing NanoClaw queue + container runner.

---

**Required process skills during execution:** @test-driven-development, @verification-before-completion

### Task 1: Emergency command parser and operator message helpers

**Files:**
- Create: `src/emergency-controls.ts`
- Create: `src/emergency-controls.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { parseEmergencyCommand } from './emergency-controls.js';

describe('parseEmergencyCommand', () => {
  const trigger = /^@Klaus\b/i;

  it('parses /stop with and without trigger prefix', () => {
    expect(parseEmergencyCommand('/stop', trigger)?.action).toBe('stop');
    expect(parseEmergencyCommand('@Klaus /stop now', trigger)?.action).toBe('stop');
  });

  it('maps /clear to abort', () => {
    expect(parseEmergencyCommand('/clear', trigger)?.action).toBe('abort');
  });

  it('returns null for non-emergency commands', () => {
    expect(parseEmergencyCommand('/model show', trigger)).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/emergency-controls.test.ts`
Expected: FAIL with module/function missing errors.

**Step 3: Write minimal implementation**

```ts
export type EmergencyAction = 'stop' | 'resume' | 'abort' | 'diagnose';

export function parseEmergencyCommand(content: string, triggerPattern: RegExp): { action: EmergencyAction; raw: string } | null {
  let text = content.trim();
  if (triggerPattern.test(text)) text = text.replace(triggerPattern, '').trim();
  if (!text.startsWith('/')) return null;

  const [cmd] = text.split(/\s+/, 1);
  const normalized = cmd.toLowerCase();
  if (normalized === '/stop') return { action: 'stop', raw: text };
  if (normalized === '/resume') return { action: 'resume', raw: text };
  if (normalized === '/abort' || normalized === '/clear') return { action: 'abort', raw: text };
  if (normalized === '/diagnose') return { action: 'diagnose', raw: text };
  return null;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/emergency-controls.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/emergency-controls.ts src/emergency-controls.test.ts
git commit -m "feat(control): parse emergency slash commands"
```

### Task 2: Queue pause gate + snapshot + pending abort

**Files:**
- Modify: `src/group-queue.ts`
- Modify: `src/group-queue.test.ts`

**Step 1: Write the failing test**

Add tests:
```ts
it('blocks message and task dispatch while globally paused', async () => {
  const processMessages = vi.fn(async () => true);
  queue.setProcessMessagesFn(processMessages);
  queue.setPaused(true);

  queue.enqueueMessageCheck('group1@g.us');
  queue.enqueueTask('group1@g.us', 'task-1', async () => {});
  await vi.advanceTimersByTimeAsync(20);

  expect(processMessages).not.toHaveBeenCalled();
  const snap = queue.snapshot();
  expect(snap.pendingMessages).toBe(1);
  expect(snap.pendingTasks).toBe(1);
});

it('abortPending clears queued work for all groups', async () => {
  queue.setPaused(true);
  queue.enqueueMessageCheck('group1@g.us');
  queue.enqueueTask('group1@g.us', 'task-1', async () => {});
  queue.abortPending();
  expect(queue.snapshot().pendingMessages).toBe(0);
  expect(queue.snapshot().pendingTasks).toBe(0);
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/group-queue.test.ts -t "globally paused|abortPending"`
Expected: FAIL (missing methods/behavior).

**Step 3: Write minimal implementation**

Implement in `GroupQueue`:
```ts
private paused = false;

setPaused(paused: boolean): void { this.paused = paused; }
isPaused(): boolean { return this.paused; }

snapshot(): { active: number; pendingMessages: number; pendingTasks: number; groups: Array<{ jid: string; active: boolean; pendingMessages: boolean; pendingTasks: number; containerName: string | null; groupFolder: string | null; }> } {
  let pendingMessages = 0;
  let pendingTasks = 0;
  const groups = [...this.groups.entries()].map(([jid, state]) => {
    if (state.pendingMessages) pendingMessages += 1;
    pendingTasks += state.pendingTasks.length;
    return { jid, active: state.active, pendingMessages: state.pendingMessages, pendingTasks: state.pendingTasks.length, containerName: state.containerName, groupFolder: state.groupFolder };
  });
  return { active: this.activeCount, pendingMessages, pendingTasks, groups };
}

abortPending(): void {
  for (const [, state] of this.groups) {
    state.pendingMessages = false;
    state.pendingTasks = [];
  }
  this.waitingGroups = [];
}
```

Gate `enqueueMessageCheck` + `enqueueTask` to queue-but-not-run when `paused`.

**Step 4: Run test to verify it passes**

Run: `npm test -- src/group-queue.test.ts`
Expected: PASS, including existing queue tests.

**Step 5: Commit**

```bash
git add src/group-queue.ts src/group-queue.test.ts
git commit -m "feat(queue): add global pause gate snapshot and abort"
```

### Task 3: Container runtime pause/unpause helper APIs

**Files:**
- Modify: `src/container-runtime.ts`
- Modify: `src/container-runtime.test.ts`

**Step 1: Write the failing test**

Add tests:
```ts
import { pauseContainer, unpauseContainer, tryPauseContainer, tryUnpauseContainer } from './container-runtime.js';

it('builds pause/unpause commands', () => {
  expect(pauseContainer('nanoclaw-x')).toBe(`${CONTAINER_RUNTIME_BIN} pause nanoclaw-x`);
  expect(unpauseContainer('nanoclaw-x')).toBe(`${CONTAINER_RUNTIME_BIN} unpause nanoclaw-x`);
});

it('returns false when pause command fails', () => {
  mockExecSync.mockImplementationOnce(() => { throw new Error('fail'); });
  expect(tryPauseContainer('nanoclaw-x')).toBe(false);
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/container-runtime.test.ts -t "pause|unpause"`
Expected: FAIL (missing exports).

**Step 3: Write minimal implementation**

```ts
export function pauseContainer(name: string): string {
  return `${CONTAINER_RUNTIME_BIN} pause ${name}`;
}

export function unpauseContainer(name: string): string {
  return `${CONTAINER_RUNTIME_BIN} unpause ${name}`;
}

export function tryPauseContainer(name: string): boolean {
  try { execSync(pauseContainer(name), { stdio: 'pipe', timeout: 5000 }); return true; }
  catch { return false; }
}

export function tryUnpauseContainer(name: string): boolean {
  try { execSync(unpauseContainer(name), { stdio: 'pipe', timeout: 5000 }); return true; }
  catch { return false; }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/container-runtime.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/container-runtime.ts src/container-runtime.test.ts
git commit -m "feat(runtime): add pause and unpause container helpers"
```

### Task 4: Queue emergency stop escalation (cooperative -> pause -> hard stop)

**Files:**
- Modify: `src/group-queue.ts`
- Modify: `src/group-queue.test.ts`

**Step 1: Write the failing test**

Add tests around a new method `emergencyStopAll`:
```ts
it('requests cooperative close then pauses active containers', async () => {
  queue.registerProcess('group1@g.us', {} as any, 'nanoclaw-group1', 'group1');
  // mark active group state via enqueue/run setup from existing tests
  const report = await queue.emergencyStopAll({ graceMs: 10 });
  expect(report.attempted).toContain('nanoclaw-group1');
  expect(report.paused.length + report.stopped.length + report.failed.length).toBeGreaterThan(0);
});
```

Also assert `_close` sentinel write still occurs before escalation.

**Step 2: Run test to verify it fails**

Run: `npm test -- src/group-queue.test.ts -t "emergencyStopAll"`
Expected: FAIL (method missing).

**Step 3: Write minimal implementation**

Implement in queue:
```ts
async emergencyStopAll(opts: { graceMs: number }): Promise<{ attempted: string[]; paused: string[]; stopped: string[]; failed: string[] }> {
  const attempted: string[] = [];
  const paused: string[] = [];
  const stopped: string[] = [];
  const failed: string[] = [];

  for (const [jid, state] of this.groups) {
    if (!state.active || !state.containerName) continue;
    attempted.push(state.containerName);
    if (state.groupFolder) this.closeStdin(jid); // cooperative stop first
  }

  await new Promise((r) => setTimeout(r, opts.graceMs));

  for (const [, state] of this.groups) {
    if (!state.active || !state.containerName) continue;
    if (tryPauseContainer(state.containerName)) {
      paused.push(state.containerName);
      continue;
    }
    if (tryStopContainer(state.containerName)) {
      stopped.push(state.containerName);
      continue;
    }
    failed.push(state.containerName);
  }

  return { attempted, paused, stopped, failed };
}
```

Add `tryStopContainer` helper in `container-runtime.ts` if not already present.

**Step 4: Run test to verify it passes**

Run: `npm test -- src/group-queue.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/group-queue.ts src/group-queue.test.ts src/container-runtime.ts src/container-runtime.test.ts
git commit -m "feat(queue): add emergency stop escalation flow"
```

### Task 5: Emergency controller module (state transitions + command actions)

**Files:**
- Create: `src/emergency-controller.ts`
- Create: `src/emergency-controller.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { createEmergencyController } from './emergency-controller.js';

it('stop sets paused and emits options message', async () => {
  const queue = {
    setPaused: vi.fn(),
    snapshot: vi.fn(() => ({ active: 1, pendingMessages: 2, pendingTasks: 1, groups: [] })),
    emergencyStopAll: vi.fn(async () => ({ attempted: ['c1'], paused: ['c1'], stopped: [], failed: [] })),
    abortPending: vi.fn(),
  } as any;
  const notify = vi.fn(async () => {});
  const stateStore = { paused: false };

  const controller = createEmergencyController({ queue, notify, stateStore, now: () => '2026-02-25T09:00:00.000Z' });
  await controller.handle('stop');

  expect(stateStore.paused).toBe(true);
  expect(queue.setPaused).toHaveBeenCalledWith(true);
  expect(notify).toHaveBeenCalledWith(expect.stringContaining('/resume'));
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/emergency-controller.test.ts`
Expected: FAIL (module missing).

**Step 3: Write minimal implementation**

Implement controller with actions:
- `stop`: set paused, queue.setPaused(true), await queue.emergencyStopAll({graceMs:1500}), send summary.
- `resume`: queue.abortPending(), queue.setPaused(false), clear paused state, send “waiting for fresh instruction”.
- `abort`: queue.abortPending(), keep paused true, send confirmation.
- `diagnose`: send snapshot/state report.

Use explicit message builder:
```ts
function buildStopMessage(...) {
  return [
    '🛑 Emergency stop engaged (global).',
    `Active: ${snap.active}, queued messages: ${snap.pendingMessages}, queued tasks: ${snap.pendingTasks}`,
    `Paused containers: ${report.paused.length}, stopped: ${report.stopped.length}, failed: ${report.failed.length}`,
    'Options: /resume, /abort (or /clear), /diagnose',
  ].join('\n');
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/emergency-controller.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/emergency-controller.ts src/emergency-controller.test.ts
git commit -m "feat(control): add emergency controller state machine"
```

### Task 6: Wire emergency path into orchestrator + persisted safety state

**Files:**
- Modify: `src/index.ts`
- Modify: `src/db.ts` (only if helper state key plumbing needed; otherwise skip)

**Step 1: Write the failing test**

If extracting a helper for testability, create test file:
- Create: `src/index-emergency.test.ts`

Test behavior:
```ts
it('processes /stop immediately and does not invoke agent flow', async () => {
  // mock controller + parser + queue hooks
  // assert command handled and processGroupMessages path not called for that event
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/index-emergency.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

In `src/index.ts`:
1. Load/save `router_state` key `safety_state`.
2. Instantiate emergency controller.
3. In channel `onMessage` callback:
```ts
onMessage: (chatJid, msg) => {
  storeMessage(msg);
  const command = parseEmergencyCommand(msg.content, TRIGGER_PATTERN);
  if (!command) return;
  void handleEmergencyCommand(chatJid, command).catch((err) =>
    logger.error({ chatJid, err }, 'Emergency command handling failed'),
  );
},
```
4. In `startMessageLoop` and `processGroupMessages`, short-circuit normal dispatch if paused.
5. Ensure `/resume` only unpauses and waits for new instruction (no automatic replay).

**Step 4: Run test to verify it passes**

Run: `npm test -- src/index-emergency.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/index.ts src/index-emergency.test.ts
# add src/db.ts only if touched
git commit -m "feat(index): handle emergency commands on inbound path"
```

### Task 7: Telegram emergency command passthrough

**Files:**
- Modify: `src/channels/telegram.ts`
- Modify: `src/channels/telegram.test.ts`

**Step 1: Write the failing test**

Add test under text handling:
```ts
it('delivers emergency slash commands for registered chats', async () => {
  const opts = createTestOpts();
  const channel = new TelegramChannel('test-token', opts);
  await channel.connect();

  await triggerTextMessage(createTextCtx({ text: '/stop' }));

  expect(opts.onMessage).toHaveBeenCalledWith(
    'tg:100200300',
    expect.objectContaining({ content: '/stop' }),
  );
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/channels/telegram.test.ts -t "emergency slash commands"`
Expected: FAIL (currently dropped by generic slash-command skip).

**Step 3: Write minimal implementation**

Replace:
```ts
if (ctx.message.text.startsWith('/')) return;
```
with:
```ts
const text = ctx.message.text;
const isEmergency = /^\/(stop|resume|abort|clear|diagnose)\b/i.test(text);
if (text.startsWith('/') && !isEmergency) return;
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/channels/telegram.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/channels/telegram.ts src/channels/telegram.test.ts
git commit -m "feat(telegram): allow emergency slash commands through"
```

### Task 8: End-to-end verification + docs sync

**Files:**
- Modify: `docs/SPEC.md` (commands section)
- Modify: `README.md` (optional short control-command note)

**Step 1: Write failing verification checklist (manual + automated)**

Add checklist in commit notes:
- `/stop` during active run halts quickly and responds with options
- `/resume` returns to idle awaiting fresh instruction
- `/abort` clears pending and remains paused
- `/diagnose` reports active/queued state

**Step 2: Run full test suite (expect pre-existing failures allowed only if already present before branch)**

Run:
- `npm test`
- `npm run build`

Expected: PASS for changed areas; document any pre-existing unrelated failures before merge.

**Step 3: Update docs with exact command semantics**

Add explicit behavior text:
- Global scope
- Pause-first escalation strategy
- Resume requires fresh instruction
- Abort/clear semantics

**Step 4: Re-run targeted checks after docs/code finalization**

Run:
- `npm test -- src/emergency-controls.test.ts src/emergency-controller.test.ts src/group-queue.test.ts src/container-runtime.test.ts src/channels/telegram.test.ts`
- `npm run build`

Expected: PASS.

**Step 5: Commit**

```bash
git add docs/SPEC.md README.md
git commit -m "docs: document global emergency stop command semantics"
```
