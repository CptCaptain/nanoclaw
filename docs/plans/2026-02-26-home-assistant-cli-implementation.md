# Home Assistant CLI + Skill Memory Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the Home Assistant MCP flow with a strict Python CLI and a Klaus skill that supports full Home Assistant control, discovery, and markdown-based user intent memory.

**Architecture:** Keep Home Assistant execution logic in a single Python entrypoint (`ha_cli.py`) with strict JSON envelope responses and stable exit codes. Store discovered topology in `home-assistant-catalog.json` and user semantic preferences in `home-assistant-memory.md`. Add a skill that always routes HA actions through the CLI, applies memory transparently, and schedules periodic catalog+memory refreshes.

**Tech Stack:** Python 3 (stdlib), pytest via `uv run --with pytest`, NanoClaw skill files, existing `mcp__nanoclaw__schedule_task` for periodic refresh orchestration.

---

### Task 1: Scaffold Python CLI with strict envelope + unknown-command handling

**Files:**
- Create: `agent-work/integrations/home-assistant/python/ha_cli.py`
- Create: `agent-work/integrations/home-assistant/python/commands/__init__.py`
- Create: `agent-work/integrations/home-assistant/python/tests/test_cli_contract.py`
- Create: `agent-work/integrations/home-assistant/python/tests/conftest.py`

**Step 1: Write failing contract test for envelope and unknown command**

```python
# test_cli_contract.py
result = run_cli(["unknown.command", "--json", "{}"])
assert result.returncode == 2
payload = json.loads(result.stdout)
assert payload["ok"] is False
assert payload["error"]["code"] == "VALIDATION_ERROR"
```

**Step 2: Run test to verify it fails**

Run: `uv run --with pytest pytest agent-work/integrations/home-assistant/python/tests/test_cli_contract.py -v`
Expected: FAIL (CLI missing)

**Step 3: Write minimal CLI implementation**

```python
# ha_cli.py
# - parse command + --json
# - emit JSON envelope with request_id/command
# - return structured VALIDATION_ERROR for unknown command
```

**Step 4: Run test to verify it passes**

Run: `uv run --with pytest pytest agent-work/integrations/home-assistant/python/tests/test_cli_contract.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add agent-work/integrations/home-assistant/python
git commit -m "feat: scaffold strict Home Assistant CLI contract"
```

### Task 2: Add config loading + Home Assistant HTTP client + `health.check` + `service.call`

**Files:**
- Create: `agent-work/integrations/home-assistant/python/config.py`
- Create: `agent-work/integrations/home-assistant/python/ha_client.py`
- Create: `agent-work/integrations/home-assistant/python/commands/health.py`
- Create: `agent-work/integrations/home-assistant/python/commands/service.py`
- Modify: `agent-work/integrations/home-assistant/python/ha_cli.py`
- Create: `agent-work/integrations/home-assistant/python/tests/test_health_and_service.py`

**Step 1: Write failing tests for `health.check` and `service.call`**

```python
result = run_cli_json("health.check", {})
assert result["ok"] is True
assert "api" in result["data"]

result = run_cli_json("service.call", {
  "domain": "light", "service": "turn_on", "target": {"entity_id": ["light.a"]}
})
assert result["ok"] is True
```

**Step 2: Run tests to verify they fail**

Run: `uv run --with pytest pytest agent-work/integrations/home-assistant/python/tests/test_health_and_service.py -v`
Expected: FAIL

**Step 3: Implement minimal config + client + command handlers**

```python
# config.py
# load HA_CONFIG JSON with baseUrl/accessToken

# ha_client.py
# get(path), post(path, data), auth headers

# commands/service.py
# POST /api/services/{domain}/{service}
```

**Step 4: Run tests to verify they pass**

Run: `uv run --with pytest pytest agent-work/integrations/home-assistant/python/tests/test_health_and_service.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add agent-work/integrations/home-assistant/python
git commit -m "feat: add HA client with health and generic service call"
```

### Task 3: Implement discovery catalog (`catalog.refresh`, `catalog.get`, `catalog.find`)

**Files:**
- Create: `agent-work/integrations/home-assistant/python/catalog.py`
- Create: `agent-work/integrations/home-assistant/python/commands/catalog.py`
- Modify: `agent-work/integrations/home-assistant/python/ha_cli.py`
- Create: `agent-work/integrations/home-assistant/python/tests/test_catalog_commands.py`

**Step 1: Write failing tests for refresh/get/find**

```python
refresh = run_cli_json("catalog.refresh", {})
assert refresh["ok"] is True
assert refresh["data"]["summary"]["entity_count"] > 0

f = run_cli_json("catalog.find", {"query": "living room", "limit": 10})
assert f["ok"] is True
assert isinstance(f["data"]["matches"], list)
```

**Step 2: Run tests to verify they fail**

Run: `uv run --with pytest pytest agent-work/integrations/home-assistant/python/tests/test_catalog_commands.py -v`
Expected: FAIL

**Step 3: Implement catalog persistence and indexes**

```python
# catalog path: groups/main/home-assistant-catalog.json
# include generated_at, entities, devices, areas, labels, floors, indexes
```

**Step 4: Run tests to verify they pass**

Run: `uv run --with pytest pytest agent-work/integrations/home-assistant/python/tests/test_catalog_commands.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add agent-work/integrations/home-assistant/python
git commit -m "feat: add discovery catalog refresh/get/find commands"
```

### Task 4: Implement typed action commands + safety gate for high-impact operations

**Files:**
- Create: `agent-work/integrations/home-assistant/python/safety.py`
- Create: `agent-work/integrations/home-assistant/python/commands/light.py`
- Create: `agent-work/integrations/home-assistant/python/commands/climate.py`
- Create: `agent-work/integrations/home-assistant/python/commands/scene.py`
- Create: `agent-work/integrations/home-assistant/python/commands/media.py`
- Modify: `agent-work/integrations/home-assistant/python/ha_cli.py`
- Create: `agent-work/integrations/home-assistant/python/tests/test_safety_and_typed_actions.py`

**Step 1: Write failing tests for typed commands and confirmation-required errors**

```python
ok = run_cli_json("light.set", {"entity_id": ["light.living_room"], "state": "on"})
assert ok["ok"] is True

blocked = run_cli_json("service.call", {
  "domain": "lock", "service": "unlock", "target": {"entity_id": ["lock.front_door"]}
})
assert blocked["ok"] is False
assert blocked["error"]["code"] == "CONFIRMATION_REQUIRED"
```

**Step 2: Run tests to verify they fail**

Run: `uv run --with pytest pytest agent-work/integrations/home-assistant/python/tests/test_safety_and_typed_actions.py -v`
Expected: FAIL

**Step 3: Implement minimal typed command wrappers + high-impact classifier**

```python
# safety.py
HIGH_IMPACT = {("lock", "unlock"), ("alarm_control_panel", "alarm_disarm"), ...}
```

**Step 4: Run tests to verify they pass**

Run: `uv run --with pytest pytest agent-work/integrations/home-assistant/python/tests/test_safety_and_typed_actions.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add agent-work/integrations/home-assistant/python
git commit -m "feat: add typed HA actions and high-impact confirmation gate"
```

### Task 5: Add markdown memory manager + change-note updater

**Files:**
- Create: `agent-work/integrations/home-assistant/python/memory.py`
- Create: `agent-work/integrations/home-assistant/python/commands/memory.py`
- Modify: `agent-work/integrations/home-assistant/python/ha_cli.py`
- Create: `agent-work/integrations/home-assistant/python/tests/test_memory_markdown.py`

**Step 1: Write failing tests for memory read/append/section replace**

```python
r = run_cli_json("memory.read", {})
assert r["ok"] is True

append = run_cli_json("memory.append_note", {"section": "Recent Home Changes", "note": "light.a -> light.b"})
assert append["ok"] is True
```

**Step 2: Run tests to verify they fail**

Run: `uv run --with pytest pytest agent-work/integrations/home-assistant/python/tests/test_memory_markdown.py -v`
Expected: FAIL

**Step 3: Implement markdown file manager**

```python
# memory file path: groups/main/home-assistant-memory.md
# bootstrap default sections if file missing
# append notes idempotently when possible
```

**Step 4: Run tests to verify they pass**

Run: `uv run --with pytest pytest agent-work/integrations/home-assistant/python/tests/test_memory_markdown.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add agent-work/integrations/home-assistant/python
git commit -m "feat: add markdown memory management commands"
```

### Task 6: Add maintenance command to refresh catalog + update memory with drift notes

**Files:**
- Create: `agent-work/integrations/home-assistant/python/commands/maint.py`
- Modify: `agent-work/integrations/home-assistant/python/catalog.py`
- Modify: `agent-work/integrations/home-assistant/python/memory.py`
- Modify: `agent-work/integrations/home-assistant/python/ha_cli.py`
- Create: `agent-work/integrations/home-assistant/python/tests/test_maint_refresh_sync.py`

**Step 1: Write failing test for one-shot maintenance command**

```python
m = run_cli_json("maint.refresh_and_sync", {})
assert m["ok"] is True
assert "changes" in m["data"]
```

**Step 2: Run test to verify it fails**

Run: `uv run --with pytest pytest agent-work/integrations/home-assistant/python/tests/test_maint_refresh_sync.py -v`
Expected: FAIL

**Step 3: Implement diff + memory change-note writes**

```python
# detect add/remove/rename/area-move deltas
# append markdown notes under "Recent Home Changes (from -> to)"
# add uncertain mappings under "Open Questions"
```

**Step 4: Run test to verify it passes**

Run: `uv run --with pytest pytest agent-work/integrations/home-assistant/python/tests/test_maint_refresh_sync.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add agent-work/integrations/home-assistant/python
git commit -m "feat: add maintenance refresh+memory sync command"
```

### Task 7: Create Klaus skill that enforces CLI usage, learning loop, and safety rules

**Files:**
- Create: `agent-work/skills/home-assistant/SKILL.md`
- Create: `agent-work/skills/home-assistant/examples.md`
- Modify: `groups/main/CLAUDE.md` (add short pointer to the new HA skill path and behavior)

**Step 1: Write failing behavior tests as prompt fixtures**

Create fixture file `agent-work/skills/home-assistant/fixtures.md` with expected prompt/response examples:
- known preference auto-apply with transparency note
- unknown ambiguity asks one question
- high-impact action requires confirmation

**Step 2: Run manual checklist against fixtures (fail baseline)**

Run: `rg -n "TODO|TBD" agent-work/skills/home-assistant/SKILL.md`
Expected: missing file / failures

**Step 3: Write skill contract**

Include exact CLI call templates:

```bash
python3 /workspace/work/integrations/home-assistant/python/ha_cli.py catalog.get --json '{}'
python3 /workspace/work/integrations/home-assistant/python/ha_cli.py maint.refresh_and_sync --json '{}'
```

**Step 4: Re-run manual checklist**

Run: `rg -n "TODO|TBD" agent-work/skills/home-assistant/SKILL.md agent-work/skills/home-assistant/examples.md`
Expected: no matches

**Step 5: Commit**

```bash
git add agent-work/skills/home-assistant groups/main/CLAUDE.md
git commit -m "feat: add Home Assistant CLI skill with memory and safety workflow"
```

### Task 8: Update integration docs from MCP flow to CLI+skill flow

**Files:**
- Modify: `agent-work/integrations/home-assistant/README.md`
- Create: `agent-work/integrations/home-assistant/CLI_CONTRACT.md`
- Modify: `agent-work/integrations/home-assistant/MCP_TOOLS_REFERENCE.md` (deprecation note + migration pointer)

**Step 1: Write failing docs assertion (grep for MCP-only setup language)**

Run: `rg -n "Add MCP Server|mcpServers|MCP Tools" agent-work/integrations/home-assistant/README.md`
Expected: matches found

**Step 2: Rewrite docs for CLI+skill install flow**

Add:
- config path usage
- CLI command reference
- memory/catalog file paths
- scheduled refresh setup through Klaus task scheduling

**Step 3: Re-run docs assertion**

Run: `rg -n "Add MCP Server to NanoClaw" agent-work/integrations/home-assistant/README.md`
Expected: no matches

**Step 4: Commit**

```bash
git add agent-work/integrations/home-assistant/README.md agent-work/integrations/home-assistant/CLI_CONTRACT.md agent-work/integrations/home-assistant/MCP_TOOLS_REFERENCE.md
git commit -m "docs: migrate Home Assistant integration docs to CLI + skill"
```

### Task 9: End-to-end verification before completion

**Files:**
- Test: `agent-work/integrations/home-assistant/python/tests/*.py`
- Verify: `agent-work/skills/home-assistant/SKILL.md`

**Step 1: Run full Python test suite**

Run: `uv run --with pytest pytest agent-work/integrations/home-assistant/python/tests -v`
Expected: all PASS

**Step 2: Run smoke commands against CLI (with real config if available)**

Run:
```bash
python3 agent-work/integrations/home-assistant/python/ha_cli.py health.check --json '{}'
python3 agent-work/integrations/home-assistant/python/ha_cli.py catalog.refresh --json '{}'
python3 agent-work/integrations/home-assistant/python/ha_cli.py catalog.find --json '{"query":"living room","limit":5}'
```
Expected: `ok: true` envelopes

**Step 3: Validate skill references valid paths/commands**

Run: `rg -n "/workspace/work/integrations/home-assistant/python/ha_cli.py|home-assistant-memory.md|home-assistant-catalog.json" agent-work/skills/home-assistant/SKILL.md`
Expected: required references present

**Step 4: Prepare final branch state commit (if needed)**

```bash
git status
git log --oneline --decorate -n 10
```

**Step 5: Request review**

Use superpowers:requesting-code-review before PR creation.
