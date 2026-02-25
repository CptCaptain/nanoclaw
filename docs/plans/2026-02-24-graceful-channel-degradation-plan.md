# Graceful Channel Degradation + Startup Greeting Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make WhatsApp failures non-fatal so NanoClaw keeps running on Telegram alone, and send a startup greeting listing any broken channels.

**Architecture:** Store resolve/reject refs from `connect()` on the WhatsApp instance so the initial promise can be rejected from inside the event handler. Cap reconnects at 3; on QR or cap-exceeded, reject the promise and set `failed = true`. In `main()`, wrap each channel's `connect()` in try/catch, bail only if zero channels succeed. After subsystems start, send a one-liner to the main group.

**Tech Stack:** TypeScript, Vitest (tests at `src/channels/whatsapp.test.ts`), Node.js EventEmitter pattern for WA socket events.

---

### Task 1: Update WhatsApp — fail gracefully on QR and logged-out

**Files:**
- Modify: `src/channels/whatsapp.ts`
- Modify: `src/channels/whatsapp.test.ts`

**Step 1: Update the QR test — expect rejection, not process.exit**

Find the existing test `'exits process when QR code is emitted'` in `src/channels/whatsapp.test.ts` and replace it:

```typescript
it('rejects connect() when QR code is emitted (session expired)', async () => {
  const opts = createTestOpts();
  const channel = new WhatsAppChannel(opts);

  const connectPromise = channel.connect();
  await new Promise((r) => setTimeout(r, 0)); // flush microtasks

  fakeSocket._ev.emit('connection.update', { qr: 'some-qr-data' });

  await expect(connectPromise).rejects.toThrow('session expired');
});
```

**Step 2: Run the test to confirm it fails**

```bash
npx vitest run src/channels/whatsapp.test.ts --reporter=verbose 2>&1 | grep -E 'PASS|FAIL|✓|✗|session expired'
```

Expected: test fails (current code calls `process.exit(1)` instead of rejecting).

**Step 3: Update the logged-out test — expect no process.exit after initial connect**

Find `'exits on loggedOut disconnect'` and replace it:

```typescript
it('marks channel as failed on loggedOut disconnect (no process.exit)', async () => {
  const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

  const opts = createTestOpts();
  const channel = new WhatsAppChannel(opts);

  await connectChannel(channel); // initial connect succeeded

  triggerDisconnect(401); // loggedOut

  expect(channel.isConnected()).toBe(false);
  expect(mockExit).not.toHaveBeenCalled();
  mockExit.mockRestore();
});
```

**Step 4: Implement the changes in `src/channels/whatsapp.ts`**

Add instance fields after the existing private fields (around line 35):

```typescript
private reconnectAttempts = 0;
private readonly MAX_RECONNECT_ATTEMPTS = 3;
private failed = false;
private initialConnectResolve?: () => void;
private initialConnectReject?: (err: Error) => void;
```

Replace the `connect()` method (lines 46-49):

```typescript
async connect(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    this.initialConnectResolve = resolve;
    this.initialConnectReject = reject;
    this.connectInternal().catch(reject);
  });
}
```

In the `connection.update` handler, replace the QR block (lines 71-79):

```typescript
if (qr) {
  this.failed = true;
  const err = new Error('session expired — run /setup to re-authenticate');
  logger.error({ msg: err.message }, 'WhatsApp authentication required');
  this.initialConnectReject?.(err);
  this.initialConnectResolve = undefined;
  this.initialConnectReject = undefined;
  return;
}
```

In the `connection === 'open'` block, after `this.connected = true` and before the LID mapping code, add:

```typescript
this.reconnectAttempts = 0;
if (this.initialConnectResolve) {
  this.initialConnectResolve();
  this.initialConnectResolve = undefined;
  this.initialConnectReject = undefined;
}
```

Remove the existing `if (onFirstOpen) { onFirstOpen(); onFirstOpen = undefined; }` block at the end of the `connection === 'open'` branch (no longer needed — resolution is handled above).

Also update `connectInternal`'s signature — remove the `onFirstOpen` parameter entirely since we no longer pass it:

```typescript
private async connectInternal(): Promise<void> {
```

In the `loggedOut` branch (the `else` after `if (shouldReconnect)`):

```typescript
} else {
  logger.info('WhatsApp: logged out. Run /setup to re-authenticate.');
  this.failed = true;
  this.initialConnectReject?.(new Error('logged out — run /setup to re-authenticate'));
  this.initialConnectResolve = undefined;
  this.initialConnectReject = undefined;
}
```

**Step 5: Run tests**

```bash
npx vitest run src/channels/whatsapp.test.ts --reporter=verbose 2>&1 | tail -30
```

Expected: QR test and loggedOut test pass. Other tests should still pass.

**Step 6: Commit**

```bash
git add src/channels/whatsapp.ts src/channels/whatsapp.test.ts
git commit -m "fix: WhatsApp QR and loggedOut no longer call process.exit"
```

---

### Task 2: Add reconnect cap to WhatsApp

**Files:**
- Modify: `src/channels/whatsapp.ts`
- Modify: `src/channels/whatsapp.test.ts`

**Step 1: Write failing test for reconnect cap**

Add to the `reconnection` describe block in `src/channels/whatsapp.test.ts`:

```typescript
it('rejects connect() after MAX_RECONNECT_ATTEMPTS failures', async () => {
  const opts = createTestOpts();
  const channel = new WhatsAppChannel(opts);

  const connectPromise = channel.connect();
  await new Promise((r) => setTimeout(r, 0)); // flush microtasks

  // Trigger MAX+1 disconnects before initial open (simulates 405 loop)
  for (let i = 0; i <= 3; i++) {
    triggerDisconnect(428); // connectionClosed — not loggedOut
    await new Promise((r) => setTimeout(r, 0));
  }

  await expect(connectPromise).rejects.toThrow('too many connection failures');
});

it('resets reconnect counter on successful connection', async () => {
  const opts = createTestOpts();
  const channel = new WhatsAppChannel(opts);

  await connectChannel(channel);

  // Simulate some disconnects and reconnects
  triggerDisconnect(428);
  await new Promise((r) => setTimeout(r, 0));
  triggerConnection('open');
  await new Promise((r) => setTimeout(r, 0));

  // Channel should still be functional (counter was reset)
  expect(channel.isConnected()).toBe(true);
});
```

**Step 2: Run tests to confirm they fail**

```bash
npx vitest run src/channels/whatsapp.test.ts -t "MAX_RECONNECT" --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL.

**Step 3: Implement the reconnect cap**

Replace the entire `if (shouldReconnect)` block in the `connection === 'close'` handler (currently lines 87-96):

```typescript
if (shouldReconnect && !this.failed) {
  this.reconnectAttempts++;
  if (this.reconnectAttempts > this.MAX_RECONNECT_ATTEMPTS) {
    this.failed = true;
    const err = new Error(
      `WhatsApp: too many connection failures (reason: ${reason})`,
    );
    if (this.initialConnectReject) {
      this.initialConnectReject(err);
      this.initialConnectResolve = undefined;
      this.initialConnectReject = undefined;
    } else {
      logger.error({ reason }, 'WhatsApp: too many reconnect failures, giving up');
    }
    return;
  }
  logger.info({ attempt: this.reconnectAttempts }, 'Reconnecting...');
  this.connectInternal().catch((err) =>
    logger.error({ err }, 'Reconnection failed'),
  );
}
```

**Step 4: Run all WhatsApp tests**

```bash
npx vitest run src/channels/whatsapp.test.ts --reporter=verbose 2>&1 | tail -40
```

Expected: all tests pass.

**Step 5: Run the full test suite**

```bash
npx vitest run 2>&1 | tail -20
```

Expected: all tests pass.

**Step 6: Commit**

```bash
git add src/channels/whatsapp.ts src/channels/whatsapp.test.ts
git commit -m "fix: cap WhatsApp reconnect attempts at 3, reject connect() on failure"
```

---

### Task 3: Catch channel failures in main()

**Files:**
- Modify: `src/index.ts`

**Step 1: Wrap channel connects in try/catch**

In `src/index.ts`, find the channel connection block (lines 446-459):

```typescript
// Create and connect channels
if (!TELEGRAM_ONLY) {
  whatsapp = new WhatsAppChannel(channelOpts);
  channels.push(whatsapp);
  await whatsapp.connect();
}

if (TELEGRAM_BOT_TOKEN) {
  const telegram = new TelegramChannel(TELEGRAM_BOT_TOKEN, channelOpts);
  channels.push(telegram);
  await telegram.connect();
  if (TELEGRAM_BOT_POOL.length > 0) {
    await initBotPool(TELEGRAM_BOT_POOL);
  }
}
```

Replace it with:

```typescript
// Create and connect channels — failures are non-fatal as long as one channel works
const channelErrors: string[] = [];

if (!TELEGRAM_ONLY) {
  whatsapp = new WhatsAppChannel(channelOpts);
  try {
    await whatsapp.connect();
    channels.push(whatsapp);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err }, 'WhatsApp failed to connect — continuing without it');
    channelErrors.push(`WhatsApp: ${msg}`);
  }
}

if (TELEGRAM_BOT_TOKEN) {
  const telegram = new TelegramChannel(TELEGRAM_BOT_TOKEN, channelOpts);
  try {
    await telegram.connect();
    channels.push(telegram);
    if (TELEGRAM_BOT_POOL.length > 0) {
      await initBotPool(TELEGRAM_BOT_POOL);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err }, 'Telegram failed to connect — continuing without it');
    channelErrors.push(`Telegram: ${msg}`);
  }
}

if (channels.length === 0) {
  logger.fatal({ channelErrors }, 'All channels failed to connect — shutting down');
  process.exit(1);
}
```

Note: `whatsapp` must still be pushed only on success, so move `channels.push(whatsapp)` inside the try block as shown.

**Step 2: Typecheck**

```bash
npm run typecheck 2>&1 | tail -20
```

Expected: no errors.

**Step 3: Run full test suite**

```bash
npx vitest run 2>&1 | tail -20
```

Expected: all tests pass.

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "fix: channel connection failures are non-fatal — keep running if any channel works"
```

---

### Task 4: Send startup greeting

**Files:**
- Modify: `src/index.ts`

**Step 1: Add `sendStartupGreeting` function**

Add this function to `src/index.ts` just before the `main()` function:

```typescript
async function sendStartupGreeting(channelErrors: string[]): Promise<void> {
  const mainEntry = Object.entries(registeredGroups).find(
    ([, g]) => g.folder === MAIN_GROUP_FOLDER,
  );
  if (!mainEntry) return; // fresh install, no main group registered yet

  const [mainJid] = mainEntry;
  const channel = findChannel(channels, mainJid);
  if (!channel) return;

  const msg =
    channelErrors.length > 0
      ? `Started. ⚠️ ${channelErrors.join('; ')}.`
      : 'Started.';

  await channel.sendMessage(mainJid, msg).catch((err) =>
    logger.warn({ err }, 'Failed to send startup greeting'),
  );
}
```

**Step 2: Call it in main() after subsystems start**

Find the end of `main()` where subsystems start (after `startMessageLoop().catch(...)`):

```typescript
startMessageLoop().catch((err) => {
  logger.fatal({ err }, 'Message loop crashed unexpectedly');
  process.exit(1);
});
```

Add the greeting call after `recoverPendingMessages()` and before `startMessageLoop()`:

```typescript
recoverPendingMessages();
await sendStartupGreeting(channelErrors);
startMessageLoop().catch((err) => {
  logger.fatal({ err }, 'Message loop crashed unexpectedly');
  process.exit(1);
});
```

Note: `channelErrors` is declared in the channel-connect block above. Make sure the variable is in scope (it is, since both are in `main()`).

**Step 3: Typecheck**

```bash
npm run typecheck 2>&1 | tail -20
```

Expected: no errors.

**Step 4: Run full test suite**

```bash
npx vitest run 2>&1 | tail -20
```

Expected: all tests pass.

**Step 5: Build**

```bash
npm run build 2>&1 | tail -20
```

Expected: no errors.

**Step 6: Commit**

```bash
git add src/index.ts
git commit -m "feat: send startup greeting to main group, including any broken channel warnings"
```

---

### Task 5: Restart the service and verify

**Step 1: Restart**

```bash
systemctl --user restart nanoclaw
```

**Step 2: Watch logs for clean startup**

```bash
tail -f /home/nils/code/nanoclaw/logs/nanoclaw.log 2>&1 | head -30
```

Expected: WhatsApp logs a warning and is skipped, Telegram connects, startup greeting arrives in the main Telegram chat with `⚠️ WhatsApp: session expired`.
