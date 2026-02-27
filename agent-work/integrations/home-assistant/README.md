# Home Assistant Integration for NanoClaw (CLI + Skill)

Home Assistant control for Klaus without MCP server setup.

## What changed

This integration now uses:

- A strict Python CLI (`python/ha_cli.py`) called via Bash
- A Klaus skill (`agent-work/skills/home-assistant/SKILL.md`)
- A structured discovery catalog (`home-assistant-catalog.json`)
- A markdown intent memory (`home-assistant-memory.md`)

No MCP config or MCP server lifecycle required.

## Features

- Strict JSON request/response envelope
- Stable exit codes for automation-safe handling
- Discovery + search of entities/devices by natural phrase
- Typed commands (`light.set`, `climate.set`, `scene.activate`, `media.control`)
- Generic escape hatch (`service.call`) for full HA coverage
- High-impact confirmation guard (`CONFIRMATION_REQUIRED`)
- Memory commands for markdown preference learning
- Maintenance sync command to refresh catalog and append drift notes

## Prerequisites

- Python 3 available in the agent container (`python3`)
- Home Assistant long-lived access token

## Setup

### 1) Create Home Assistant config

Create `~/.config/home-assistant/config.json`:

```json
{
  "baseUrl": "http://homeassistant.local:8123",
  "accessToken": "YOUR_LONG_LIVED_ACCESS_TOKEN"
}
```

Optional override:

```bash
export HA_CONFIG=/path/to/config.json
```

### 2) Verify CLI health check

```bash
python3 /workspace/work/integrations/home-assistant/python/ha_cli.py health.check --json '{}'
```

Expected: JSON with `"ok": true`.

### 3) Use the Home Assistant skill

Skill path:

- `/workspace/work/skills/home-assistant/SKILL.md`

The skill enforces memory-first interpretation, catalog discovery, and safety confirmation handling.

## Core file locations

From group working directory (`/workspace/group`):

- Catalog: `home-assistant-catalog.json`
- Memory: `home-assistant-memory.md`

Optional env overrides:

- `HA_CATALOG_PATH`
- `HA_MEMORY_PATH`

## Command examples

### Discovery

```bash
python3 /workspace/work/integrations/home-assistant/python/ha_cli.py catalog.refresh --json '{}'
python3 /workspace/work/integrations/home-assistant/python/ha_cli.py catalog.get --json '{}'
python3 /workspace/work/integrations/home-assistant/python/ha_cli.py catalog.find --json '{"query":"living room","limit":10}'
```

### Typed actions

```bash
python3 /workspace/work/integrations/home-assistant/python/ha_cli.py light.set --json '{"entity_id":["light.living_room_mood"],"state":"on","brightness":120}'
python3 /workspace/work/integrations/home-assistant/python/ha_cli.py climate.set --json '{"entity_id":"climate.bedroom","temperature":22}'
python3 /workspace/work/integrations/home-assistant/python/ha_cli.py scene.activate --json '{"entity_id":"scene.movie_time"}'
python3 /workspace/work/integrations/home-assistant/python/ha_cli.py media.control --json '{"entity_id":"media_player.living_room","action":"pause"}'
```

### Generic service call

```bash
python3 /workspace/work/integrations/home-assistant/python/ha_cli.py service.call --json '{"domain":"script","service":"turn_on","target":{"entity_id":["script.good_night"]}}'
```

### Memory

```bash
python3 /workspace/work/integrations/home-assistant/python/ha_cli.py memory.read --json '{}'
python3 /workspace/work/integrations/home-assistant/python/ha_cli.py memory.append_note --json '{"section":"Interpretation Guidelines","note":"Evening living room lights means mood lamp only"}'
python3 /workspace/work/integrations/home-assistant/python/ha_cli.py memory.replace_section --json '{"section":"Open Questions","content":"- Confirm office default on weekends"}'
```

### Periodic maintenance (catalog + drift notes)

```bash
python3 /workspace/work/integrations/home-assistant/python/ha_cli.py maint.refresh_and_sync --json '{}'
```

Suggested cadence: every 6 hours via scheduled task.

## Testing

Run Python tests:

```bash
uv run --with pytest pytest agent-work/integrations/home-assistant/python/tests -v
```

## Reference

- CLI contract: `CLI_CONTRACT.md`
- Legacy MCP reference and migration note: `MCP_TOOLS_REFERENCE.md`
