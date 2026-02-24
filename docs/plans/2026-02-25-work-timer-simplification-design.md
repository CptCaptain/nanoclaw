# Work Timer Simplification Design

## Goal
Simplify our recent footer/timer changes while improving usefulness: keep a tiny status indicator, show a toggleable work-vs-idle bar (session and rolling views), and record analytics in both global and project logs.

## Scope
- Remove custom image extension if built-in image generation is already available.
- Consolidate timer behavior into one clean extension.
- Keep UI minimal and footer-friendly.
- Log telemetry for later analysis without risking runtime stability.

## User-Approved Constraints
- Prioritize minimal footprint and elegance.
- "Worked" time means only strict `agent_start -> agent_end` intervals.
- Show both cumulative session and rolling-window metrics, with a toggle between them.
- Keep a tiny indicator even when idle.
- Persist analytics to both:
  - `~/.pi/agent/logs/work-timer.jsonl`
  - `<repo>/.pi/logs/work-timer.jsonl`
- Idle time is only counted when confirmed by a subsequent user input.
- Trailing idle at shutdown/close is discarded.

## Architecture
Use one extension file (`~/.pi/agent/extensions/work-timer-status.ts`) as the single source of truth for:
1) in-memory segment accounting (work and confirmed idle),
2) status rendering, and
3) best-effort JSONL logging.

No extra UI components, dialogs, or secondary extensions are required.

## Behavior Design

### Footer Status
Compact status string, e.g.:
- Working: `⏱ Working (3m 12s) ███████░░░ 68% W / 32% I [S]`
- Idle: `⏱ · ███░░░░░░░ 27% W / 73% I [R]`

Where:
- `W` = worked time (`agent_start -> agent_end` only)
- `I` = confirmed idle time
- `[S]` = session mode
- `[R]` = rolling mode

### Mode Controls
- Slash command: `/work-timer toggle`
- Slash command: `/work-timer mode session|rolling`
- Slash command: `/work-timer stats`
- Shortcut: `ctrl+shift+t` for session/rolling toggle

### Counting Rules
- Work starts at `agent_start`, ends at `agent_end`.
- Idle segment begins after `agent_end`, but is only finalized when next user `input` arrives.
- If no next input arrives, trailing idle is not counted.

## Data Model

### Session Aggregates
- `workedMsSession`
- `idleMsSession` (confirmed only)

### Rolling Window
- Maintain a small in-memory segment list/ring buffer with timestamps.
- Window default: last 15 minutes.
- Rolling totals are computed by interval intersection with `[now - windowMs, now]`.

## Logging Design
Append JSONL events to both targets:
- `~/.pi/agent/logs/work-timer.jsonl`
- `<repo>/.pi/logs/work-timer.jsonl`

Event shape:
```json
{
  "ts": 1739920000000,
  "sessionId": "...",
  "event": "agent_start|agent_end|input|mode_change|snapshot",
  "mode": "session|rolling",
  "workedMsSession": 12345,
  "idleMsSession": 67890,
  "workedMsRolling": 4567,
  "idleMsRolling": 8910
}
```

Emit events on transitions and periodic snapshots (e.g. every 60s).

## Error Handling
- Logging failures are non-fatal.
- If one log target fails, continue writing to the other.
- Footer rendering must continue regardless of log failures.
- State transition anomalies should self-heal safely (avoid double-open segments).

## Testing Strategy
1. Unit tests for time accounting:
   - work accumulation,
   - confirmed idle accumulation,
   - trailing idle discard,
   - rolling-window intersection.
2. Unit tests for mode toggling and command behavior.
3. Unit tests for log payload and path resolution.
4. Manual smoke check for footer, toggles, and dual-log writes.

## Simplification Wins
- One extension instead of multiple moving parts.
- Minimal visual footprint while adding richer insight.
- Strict metric semantics prevent inflated idle/wait claims.
- Telemetry ready for offline analysis with JSONL tooling.
