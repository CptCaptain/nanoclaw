# Klaus Orchestrator Foundation — Design

**Goal:** Give Klaus a git-tracked writable workspace, the ability to write new skills, and a constrained IPC broker for git/GitHub operations and deployment — so he can build things, version them, and ship PRs for review without holding credentials or having unrestricted host access.

**Architecture:** Four additions to the existing system: (1) `agent-work/` directory mounted read-write into the main container, (2) skill sync extended to also read from `agent-work/skills/`, (3) three new git IPC task types backed by a host-side handler holding the GitHub token, (4) a `deploy` IPC task type that runs the full pull→install→migrate→build→restart pipeline.

**Tech Stack:** TypeScript (existing), Node.js `child_process` for git/npm commands, GitHub REST API via `GITHUB_TOKEN` for PR creation, systemd/launchd for service restart.

---

## Section 1: agent-work/ workspace

A new top-level `agent-work/` directory, tracked in git. Added as a second writable volume mount in `container-runner.ts` for the main group only, available at `/workspace/work` inside the container.

Directory layout:
```
agent-work/
  integrations/    ← Klaus-built integrations (e.g. home-assistant-integration moves here)
  skills/          ← New skills Klaus writes; synced into main container at startup
  subagents/       ← Artifacts and output from subagent work
  .gitkeep
```

`.gitignore` gets a `agent-work/**/node_modules/` exclusion. Everything else in `agent-work/` tracks.

`groups/main/CLAUDE.md` gets a new section:
- `/workspace/work` is the git-tracked workspace — build things here, not in `/workspace/group`
- `/workspace/group` is ephemeral and not versioned
- Skills written to `/workspace/work/skills/` are available on the next container turn (main only)

## Section 2: Skill self-modification

The skill sync loop in `container-runner.ts` currently copies `container/skills/*` into `data/sessions/{group}/.claude/skills/`. Extended to also merge in `agent-work/skills/*` for the main group only.

Merge order: built-in skills (`container/skills/`) first, then `agent-work/skills/` — so Klaus-written skills can override built-ins if needed.

Constraint documented to Klaus: skills in `agent-work/skills/` are main-only. To make a skill available to all groups, promote it to `container/skills/` via a PR.

## Section 3: Git IPC broker

Three new IPC task types. Klaus writes them to `/workspace/ipc/tasks/` as normal; NanoClaw handles them on the host.

**`git_commit`**
```json
{
  "type": "git_commit",
  "message": "feat: add home-assistant integration",
  "paths": ["agent-work/integrations/home-assistant"]
}
```
Stages only paths under `agent-work/`, `container/skills/`, and `groups/main/CLAUDE.md`. Rejects anything else.

**`git_push`**
```json
{
  "type": "git_push",
  "branch": "feat/home-assistant-integration"
}
```
Refuses to push to `main` or `master`. Creates the branch from current HEAD if it doesn't exist.

**`create_pr`**
```json
{
  "type": "create_pr",
  "title": "feat: add Home Assistant MCP integration",
  "body": "...",
  "branch": "feat/home-assistant-integration",
  "base": "main"
}
```
Calls GitHub API using `GITHUB_TOKEN` from `.env`. Target repo hardcoded to `CptCaptain/nanoclaw` via `GITHUB_REPO` env var.

All three write a result back to `/workspace/ipc/input/{taskId}-result.json`:
```json
{ "success": true, "output": "..." }
{ "success": false, "error": "..." }
```

New `.env` vars needed: `GITHUB_TOKEN`, `GITHUB_REPO=CptCaptain/nanoclaw`.

## Section 4: Deploy IPC action

**`deploy`**
```json
{ "type": "deploy" }
```

Executes in order on the host, stopping on first failure:
1. `git pull --rebase origin main`
2. `npm install`
3. DB migrations (no-op placeholder for now, hook for future)
4. `npm run build`
5. `process.exit(0)` — systemd/launchd restarts the service

Result written back to `/workspace/ipc/input/{taskId}-result.json` with per-step status. If build fails, the restart step is skipped so the service stays up on the previous build.

Klaus triggers this after the user merges a PR.

---

## Out of Scope (Future)

- **Plugin architecture:** NanoClaw auto-discovers integrations in `agent-work/` without touching `src/` (Option C)
- **Visible agent conversations:** Persistent subagents as Matrix rooms once Matrix integration exists
- **Persistent specialized agents:** Registered NanoClaw groups acting as long-running workers
- **Writable `src/channels/`:** Klaus adding new channels directly to NanoClaw source
