# Home Assistant CLI + Skill Memory — Design

**Goal:** Replace the Home Assistant MCP integration with a simpler script-first interface that preserves full control capability, supports discovery of devices/locations, and learns user intent over time so Klaus can interpret natural requests consistently.

**Architecture:** A single strict Python CLI (`ha_cli.py`) handles discovery, reads, typed actions, and a generic service-call escape hatch. Klaus uses a skill that always calls the CLI via Bash. Device topology is stored in structured JSON (`home-assistant-catalog.json`), while user meaning/preferences are stored in a human-readable markdown memory file (`home-assistant-memory.md`) maintained continuously by Klaus and a scheduled refresh subagent.

**Tech Stack:** Python 3 CLI, Home Assistant REST API, NanoClaw skill instructions, scheduled NanoClaw task for refresh/diff/update.

---

## Decisions captured from user

1. Capability boundary: **Option B** (typed common actions + generic `service.call` escape hatch).
2. Memory application policy: **Auto-apply with brief transparency note**.
3. High-impact actions: **Always require explicit confirmation**.
4. Unknown ambiguity behavior: **Ask one clarification, then learn**.
5. Memory storage: **File in group folder**.
6. Discovery refresh mode: **Scheduled + on-demand fallback**.
7. Default schedule: **Every 6 hours**.
8. Stale mappings: **Fallback to discovery + brief clarification + repair**.
9. Memory representation refinement: **Markdown memory preferred over rigid rule engine**.

## Section 1: Runtime architecture

### Components

- **CLI runtime**
  - Path: `/workspace/work/integrations/home-assistant/scripts/ha_cli.py`
  - Single entrypoint for all HA operations.
  - Strict JSON request/response contract with stable error codes.

- **Discovery catalog (structured reality)**
  - Path: `groups/main/home-assistant-catalog.json`
  - Stores latest entities/devices/areas/labels/floors and freshness metadata.

- **Intent memory (human meaning)**
  - Path: `groups/main/home-assistant-memory.md`
  - Stores user-specific interpretation guidelines and change notes.

- **Scheduled refresh subagent**
  - Runs every 6h (plus on-demand fallback).
  - Refreshes catalog, diffs changes, updates memory markdown notes.

### Why this architecture

- Removes MCP operational complexity.
- Keeps machine-critical topology data strict and queryable.
- Keeps user semantics flexible and readable.
- Supports both routine actions and long-tail HA operations.

## Section 2: Strict CLI contract

Invocation pattern:

```bash
python3 /workspace/work/integrations/home-assistant/scripts/ha_cli.py <command> --json '<payload>'
```

### Command families

1. `catalog.refresh` — query HA and rebuild catalog snapshot.
2. `catalog.get` — return current snapshot and freshness.
3. `catalog.find` — search by name/domain/area/label/capability.
4. `state.get` — current state and attributes for entity/entities.
5. `history.get` — historical state window.
6. `health.check` — connection/auth readiness.
7. Typed control commands (examples):
   - `light.set`
   - `switch.set`
   - `climate.set`
   - `scene.activate`
   - `media.control`
8. `service.call` — generic HA domain/service call for full coverage.
9. Memory helpers (CLI-managed file ops):
   - `memory.read`
   - `memory.append_note`
   - `memory.replace_section`

### Response envelope

Success:

```json
{
  "ok": true,
  "request_id": "uuid",
  "command": "light.set",
  "data": {},
  "meta": {
    "catalog_version": "2026-02-26T18:00:00Z",
    "memory_path": "groups/main/home-assistant-memory.md"
  }
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
    "message": "High-impact action requires confirmation",
    "details": {},
    "retryable": true
  }
}
```

### Exit codes

- `0` success
- `2` validation error
- `3` not found / ambiguous
- `4` confirmation required
- `5` Home Assistant API error
- `6` stale mapping / drift conflict
- `10` internal error

## Section 3: Memory model (markdown-first)

### `home-assistant-memory.md` structure

Recommended sections:

1. `# Home Assistant Memory`
2. `## Interpretation Guidelines`
   - e.g. what “living room lights in the evening” means.
3. `## Room Preferences`
   - room-by-room behavior defaults.
4. `## Time/Context Behaviors`
   - evening/movie/bedtime/etc.
5. `## Safety Preferences`
   - explicit confirmations and forbidden operations.
6. `## Recent Home Changes (from -> to)`
   - factual catalog drift notes.
7. `## Open Questions`
   - unresolved ambiguities for future clarification.

### Runtime use

- Klaus reads memory markdown before interpreting HA requests.
- If memory clearly applies, Klaus executes and adds a short transparency note.
- If ambiguous, Klaus asks one focused clarification and updates memory.
- If stale, Klaus re-discovers from catalog, repairs memory text, and continues.

## Section 4: Discovery catalog and smart refresh

### Catalog contents (`home-assistant-catalog.json`)

- Generation metadata: `generated_at`, source endpoint versions.
- Entities with domain, state class, device class, friendly name.
- Device relationships.
- Area/floor/label mappings.
- Optional reverse indexes for quick lookup.

### Scheduled refresh subagent (every 6h)

1. Run `catalog.refresh`.
2. Diff old/new catalog.
3. Detect adds/removes/renames/reassignments.
4. Update `home-assistant-catalog.json`.
5. Update `home-assistant-memory.md` with factual `from -> to` notes.
6. If semantic meaning might be impacted, add an `Open Questions` item (not silent rewrite).

### On-demand fallback

If catalog is stale/unavailable during command handling, run lightweight refresh before resolution.

## Section 5: Skill behavior contract

The Home Assistant skill should enforce:

1. Read memory markdown + catalog freshness first.
2. Resolve intent using memory + current catalog.
3. Use typed command when available; else `service.call`.
4. Require confirmation for high-impact actions.
5. Ask one clarification when ambiguous and then learn.
6. Always report action result/failure clearly.

Transparency requirement example:

- “Using your evening living-room mood preference.”

## Section 6: Safety and reliability

- High-impact operations cannot bypass confirmation.
- Never silently ignore failures.
- Memory updates must be append/section-replace operations with auditable notes.
- Catalog drift should not delete intent history; use change notes and explicit repairs.

## Section 7: Out of scope

- Reintroducing MCP for Home Assistant.
- Full deterministic rule engine for semantic intent.
- Automatic high-impact action execution without confirmation.

## Acceptance criteria

1. Klaus can discover devices and locations without manual mapping.
2. Klaus can execute both common typed actions and arbitrary HA service calls.
3. Klaus learns and reuses user interpretation preferences from markdown memory.
4. Klaus auto-applies known preferences with brief transparency.
5. Klaus asks clarifying questions when uncertain and then records outcome.
6. Catalog and memory are updated by periodic refresh with `from -> to` change notes.
7. High-impact actions always require explicit confirmation.
