---
name: home-assistant
description: Control Home Assistant via local Python CLI with catalog discovery, markdown memory, and high-impact confirmation safeguards.
---

# Home Assistant CLI Skill

Use this skill for any smart-home request.

## Command runner

Always call:

```bash
python3 /workspace/work/integrations/home-assistant/python/ha_cli.py <command> --json '<payload>'
```

## Required flow

1. **Read semantic memory first**

```bash
python3 /workspace/work/integrations/home-assistant/python/ha_cli.py memory.read --json '{}'
```

2. **Load discovery catalog**

```bash
python3 /workspace/work/integrations/home-assistant/python/ha_cli.py catalog.get --json '{}'
```

If catalog is missing/stale, run:

```bash
python3 /workspace/work/integrations/home-assistant/python/ha_cli.py maint.refresh_and_sync --json '{}'
```

3. **Resolve intent and execute**
- Prefer typed commands: `light.set`, `climate.set`, `scene.activate`, `media.control`
- Use `service.call` for uncovered actions

4. **Safety rule (hard requirement)**
- If command returns `CONFIRMATION_REQUIRED`, ask for explicit confirmation before retrying.
- Never bypass high-impact confirmation.

5. **Learning rule**
- If request is ambiguous, ask one focused clarification question.
- After clarification, update memory markdown:

```bash
python3 /workspace/work/integrations/home-assistant/python/ha_cli.py memory.append_note --json '{"section":"Interpretation Guidelines","note":"..."}'
```

6. **Transparency rule**
- When memory influenced interpretation, mention it briefly (e.g. “Using your evening living-room mood preference”).

## Common command templates

### Refresh topology + memory drift notes

```bash
python3 /workspace/work/integrations/home-assistant/python/ha_cli.py maint.refresh_and_sync --json '{}'
```

### Find entities by phrase

```bash
python3 /workspace/work/integrations/home-assistant/python/ha_cli.py catalog.find --json '{"query":"living room","limit":10}'
```

### Turn light on with brightness

```bash
python3 /workspace/work/integrations/home-assistant/python/ha_cli.py light.set --json '{"entity_id":["light.living_room_mood"],"state":"on","brightness":120}'
```

### Generic service call

```bash
python3 /workspace/work/integrations/home-assistant/python/ha_cli.py service.call --json '{"domain":"script","service":"turn_on","target":{"entity_id":["script.movie_mode"]}}'
```
