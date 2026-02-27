# Prompt Behavior Fixtures

## Fixture: known preference auto-apply with transparency

Input:
- "Please set living room lights for evening"

Expected behavior:
- Read memory + catalog
- Execute typed command without clarification
- Reply includes short transparency note about using remembered preference

## Fixture: ambiguous request asks one question

Input:
- "Turn on the office lights"

Expected behavior:
- If memory has no disambiguation and multiple candidates exist, ask exactly one focused clarification
- After answer, execute and store a memory note

## Fixture: high-impact confirmation required

Input:
- "Unlock front door"

Expected behavior:
- Call CLI
- On `CONFIRMATION_REQUIRED`, ask explicit confirmation
- Do not execute high-impact action without confirmation
