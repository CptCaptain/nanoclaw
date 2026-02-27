# Home Assistant CLI Contract

Entrypoint:

```bash
python3 /workspace/work/integrations/home-assistant/python/ha_cli.py <command> --json '<payload>'
```

## Response envelope

Success:

```json
{
  "ok": true,
  "request_id": "uuid",
  "command": "light.set",
  "data": {}
}
```

Failure:

```json
{
  "ok": false,
  "request_id": "uuid",
  "command": "service.call",
  "error": {
    "code": "CONFIRMATION_REQUIRED",
    "message": "..."
  }
}
```

## Exit codes

- `0` success
- `2` validation / unknown command / bad payload
- `4` confirmation required (high-impact action)
- `5` Home Assistant API failure
- `10` internal runtime failure

## Commands

### Readiness
- `health.check` `{}`

### Discovery / Catalog
- `catalog.refresh` `{}`
- `catalog.get` `{}`
- `catalog.find` `{ "query": "living room", "limit": 10 }`

### Typed actions
- `light.set` `{ "entity_id": ["light.a"], "state": "on", "brightness": 100 }`
- `climate.set` `{ "entity_id": "climate.a", "temperature": 22, "hvac_mode": "heat" }`
- `scene.activate` `{ "entity_id": "scene.movie_time" }`
- `media.control` `{ "entity_id": "media_player.a", "action": "pause" }`

### Generic action
- `service.call` `{ "domain": "script", "service": "turn_on", "target": {"entity_id": ["script.a"]}, "data": {} }`

### Memory
- `memory.read` `{}`
- `memory.append_note` `{ "section": "Interpretation Guidelines", "note": "..." }`
- `memory.replace_section` `{ "section": "Open Questions", "content": "- ..." }`

### Maintenance
- `maint.refresh_and_sync` `{}`

## File outputs

Defaults (when not overridden by env):

- Catalog: `./home-assistant-catalog.json`
- Memory: `./home-assistant-memory.md`

Overrides:

- `HA_CONFIG`
- `HA_CATALOG_PATH`
- `HA_MEMORY_PATH`
