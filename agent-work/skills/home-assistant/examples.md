# Home Assistant Skill Examples

## Example 1: Known preference auto-apply

User: "Turn on living room lights, it's evening"

Agent flow:
1. `memory.read`
2. `catalog.get`
3. Resolve to remembered mood-light intent
4. `light.set` with remembered target/brightness
5. Reply: "Done — using your evening living-room mood preference."

## Example 2: Ambiguous request, learn once

User: "Turn on the office lights"

If multiple office lights exist and no memory rule:
- Ask: "Do you mean the desk lamp only or all office lights?"
- Execute clarified command
- `memory.append_note` to capture future interpretation

## Example 3: High-impact guardrail

User: "Unlock the front door"

- Run `service.call` for `lock.unlock`
- If CLI returns `CONFIRMATION_REQUIRED`, ask:
  - "This is a high-impact action. Confirm unlock front door now?"
- Proceed only after explicit confirmation

## Example 4: Drift repair

If command fails due renamed/moved entity:
1. Run `maint.refresh_and_sync`
2. Retry resolution with updated catalog
3. If still unclear, ask one focused question
4. Write memory update note
