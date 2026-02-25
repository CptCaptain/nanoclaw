# Graceful Channel Degradation + Startup Greeting

**Date:** 2026-02-24
**Status:** Approved

## Problem

WhatsApp currently causes the whole process to crash when its session expires:
- `process.exit(1)` fires when a QR code is needed (session expired)
- 405 connection failures trigger an infinite reconnect loop, keeping startup blocked forever
- Result: systemd kills and restarts the process, which fails again, repeat

The user no longer uses WhatsApp. Telegram is the active channel.

## Goals

1. A broken channel must not crash or block the process
2. As long as one channel is working, NanoClaw keeps running
3. After startup, send a one-liner to the main group listing any broken channels

## Design

### 1. WhatsApp: fail gracefully instead of exiting

**On QR code needed** (`whatsapp.ts:72-79`):
- Remove `process.exit(1)`
- Reject the pending `connect()` promise with a descriptive error: `"session expired — run /setup to re-authenticate"`
- Set `this.failed = true` so reconnect loops stop

**On repeated 405 / connection failures**:
- Track `reconnectAttempts` (reset to 0 on successful open)
- After `MAX_RECONNECT_ATTEMPTS = 3`, reject the `connect()` promise with `"too many connection failures"` and set `this.failed = true`
- Replace the ad-hoc nested retry logic with a single clean reconnect path

**On logged out** (`DisconnectReason.loggedOut`):
- Remove `process.exit(0)`
- Set `failed = true`, reject/resolve the connect promise, stop

To wire the rejection back to the `connect()` promise, store resolve/reject refs on the instance when `connect()` is first called.

### 2. index.ts: catch channel failures, don't abort

```
try { await whatsapp.connect() }
catch (err) { channelErrors.push(`WhatsApp: ${err.message}`) }

try { await telegram.connect() }
catch (err) { channelErrors.push(`Telegram: ${err.message}`) }

if (channels.length === 0) { logger.fatal(...); process.exit(1); }
```

### 3. Startup greeting

After all subsystems start, send a one-liner to the main group:

- All good: `"Started."`
- With failures: `"Started. ⚠️ WhatsApp: session expired — run /setup to re-authenticate."`

Implementation: find the registered group with `folder === MAIN_GROUP_FOLDER`, find its channel via `findChannel()`, send. Skip silently if no main group is registered yet (fresh install).

## Files Changed

| File | Change |
|------|--------|
| `src/channels/whatsapp.ts` | Fail gracefully: cap reconnects, no `process.exit`, reject connect promise |
| `src/index.ts` | Wrap connects in try/catch, send startup greeting |

No interface changes needed — `connect()` already returns `Promise<void>` and can reject.
