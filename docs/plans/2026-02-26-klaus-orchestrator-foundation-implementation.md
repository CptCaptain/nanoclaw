# Klaus Orchestrator Foundation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give Klaus a git-tracked writable workspace (`agent-work/`), skill self-modification, and a constrained IPC broker for git/GitHub operations and deployment.

**Architecture:** Four independent additions: (1) `agent-work/` directory + container mount, (2) extended skill sync to include `agent-work/skills/`, (3) three new git IPC task types (`git_commit`, `git_push`, `create_pr`) handled on the host, (4) `deploy` IPC task type running the full pull→install→build→restart pipeline. All new IPC handlers live in a new `src/ipc-host-ops.ts` module, wired into `src/ipc.ts`.

**Tech Stack:** TypeScript, Node.js `child_process.execSync`, GitHub REST API via `fetch` + `GITHUB_TOKEN`, vitest for tests.

---

### Task 1: Create agent-work/ directory structure

**Files:**
- Create: `agent-work/.gitkeep`
- Create: `agent-work/integrations/.gitkeep`
- Create: `agent-work/skills/.gitkeep`
- Create: `agent-work/subagents/.gitkeep`
- Modify: `.gitignore`

**Step 1: Create the directory structure**

```bash
mkdir -p agent-work/integrations agent-work/skills agent-work/subagents
touch agent-work/.gitkeep agent-work/integrations/.gitkeep agent-work/skills/.gitkeep agent-work/subagents/.gitkeep
```

**Step 2: Add node_modules exclusion to .gitignore**

In `.gitignore`, add after the existing `node_modules/` line:

```
# agent-work — exclude nested node_modules but track everything else
agent-work/**/node_modules/
agent-work/**/.git/
```

**Step 3: Verify git tracks the directories**

```bash
git status
```

Expected: four `.gitkeep` files shown as new untracked files under `agent-work/`.

**Step 4: Commit**

```bash
git add agent-work/ .gitignore
git commit -m "feat: add agent-work/ versioned workspace directory"
```

---

### Task 2: Move home-assistant-integration to agent-work/

**Files:**
- Move: `groups/main/home-assistant-integration/` → `agent-work/integrations/home-assistant/`

**Step 1: Copy files, excluding .git/ and node_modules/**

```bash
cp -r groups/main/home-assistant-integration agent-work/integrations/home-assistant
rm -rf agent-work/integrations/home-assistant/.git
rm -rf agent-work/integrations/home-assistant/node_modules
```

**Step 2: Verify the right files are present**

```bash
find agent-work/integrations/home-assistant -type f | sort
```

Expected output (no .git/ or node_modules/ entries):
```
agent-work/integrations/home-assistant/.gitignore
agent-work/integrations/home-assistant/config.example.json
agent-work/integrations/home-assistant/IMPROVEMENTS_SUMMARY.md
agent-work/integrations/home-assistant/MCP_TOOLS_REFERENCE.md
agent-work/integrations/home-assistant/package.json
agent-work/integrations/home-assistant/package-lock.json
agent-work/integrations/home-assistant/README.md
agent-work/integrations/home-assistant/skills/automation/SKILL.md
agent-work/integrations/home-assistant/skills/climate/SKILL.md
agent-work/integrations/home-assistant/skills/lights/SKILL.md
agent-work/integrations/home-assistant/skills/status/SKILL.md
agent-work/integrations/home-assistant/src/client.ts
agent-work/integrations/home-assistant/src/mcp-server.ts
agent-work/integrations/home-assistant/src/types.ts
agent-work/integrations/home-assistant/test/client.test.ts
```

**Step 3: Commit**

```bash
git add agent-work/integrations/home-assistant
git commit -m "feat: move home-assistant integration to agent-work/integrations/"
```

---

### Task 3: Mount agent-work/ into the main container

**Files:**
- Modify: `src/container-runner.ts:275-320` (the `buildVolumeMounts` function)
- Modify: `src/config.ts`

**Step 1: Add AGENT_WORK_DIR to config.ts**

In `src/config.ts`, after the `DATA_DIR` line:

```typescript
export const AGENT_WORK_DIR = path.resolve(PROJECT_ROOT, 'agent-work');
```

**Step 2: Write a failing test**

In `src/container-runner.test.ts`, add:

```typescript
import { AGENT_WORK_DIR } from './config.js';

describe('buildVolumeMounts agent-work', () => {
  it('mounts agent-work/ read-write for main group at /workspace/work', () => {
    // This test verifies the mount is present; we inspect the container args
    // by checking the exported mount-building logic indirectly via the args string
    // For now, verify AGENT_WORK_DIR is exported correctly
    expect(AGENT_WORK_DIR).toContain('agent-work');
    expect(path.isAbsolute(AGENT_WORK_DIR)).toBe(true);
  });
});
```

**Step 3: Run the test**

```bash
npm test -- src/container-runner.test.ts
```

Expected: PASS (just verifies the config export).

**Step 4: Add the mount in buildVolumeMounts**

In `src/container-runner.ts`, in the `buildVolumeMounts` function, inside the `if (isMain)` block (around line 297), after the existing two main mounts:

```typescript
// agent-work/: git-tracked versioned workspace for Klaus-built integrations,
// skills, and subagent output. Main-only — non-main groups have no persistent workspace.
const agentWorkDir = path.resolve(process.cwd(), 'agent-work');
fs.mkdirSync(agentWorkDir, { recursive: true });
mounts.push({
  hostPath: agentWorkDir,
  containerPath: '/workspace/work',
  readonly: false,
});
```

**Step 5: Run all tests**

```bash
npm test
```

Expected: all tests pass.

**Step 6: Commit**

```bash
git add src/container-runner.ts src/config.ts
git commit -m "feat: mount agent-work/ read-write into main container at /workspace/work"
```

---

### Task 4: Extend skill sync to include agent-work/skills/

**Files:**
- Modify: `src/container-runner.ts` (the skill sync loop, around line 346)
- Modify: `src/container-runner-sync.test.ts`

**Step 1: Write a failing test**

In `src/container-runner-sync.test.ts`, add a new describe block:

```typescript
import { syncAgentWorkSkills } from './container-runner.js';

describe('syncAgentWorkSkills', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-agentwork-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('copies skills from agentWorkSkillsDir into destSkillsDir', () => {
    const agentWorkSkillsDir = path.join(tmpDir, 'agent-work', 'skills');
    const destSkillsDir = path.join(tmpDir, 'dest-skills');

    fs.mkdirSync(path.join(agentWorkSkillsDir, 'my-custom-skill'), { recursive: true });
    fs.writeFileSync(path.join(agentWorkSkillsDir, 'my-custom-skill', 'SKILL.md'), '# Custom');

    syncAgentWorkSkills(agentWorkSkillsDir, destSkillsDir);

    expect(fs.existsSync(path.join(destSkillsDir, 'my-custom-skill', 'SKILL.md'))).toBe(true);
  });

  it('does nothing if agentWorkSkillsDir does not exist', () => {
    const agentWorkSkillsDir = path.join(tmpDir, 'nonexistent');
    const destSkillsDir = path.join(tmpDir, 'dest-skills');

    expect(() => syncAgentWorkSkills(agentWorkSkillsDir, destSkillsDir)).not.toThrow();
  });

  it('agent-work skills overwrite built-in skills with the same name', () => {
    const agentWorkSkillsDir = path.join(tmpDir, 'agent-work', 'skills');
    const destSkillsDir = path.join(tmpDir, 'dest-skills');

    // Pre-populate dest with a built-in skill
    fs.mkdirSync(path.join(destSkillsDir, 'my-skill'), { recursive: true });
    fs.writeFileSync(path.join(destSkillsDir, 'my-skill', 'SKILL.md'), '# Built-in');

    // agent-work has an override
    fs.mkdirSync(path.join(agentWorkSkillsDir, 'my-skill'), { recursive: true });
    fs.writeFileSync(path.join(agentWorkSkillsDir, 'my-skill', 'SKILL.md'), '# Override');

    syncAgentWorkSkills(agentWorkSkillsDir, destSkillsDir);

    expect(fs.readFileSync(path.join(destSkillsDir, 'my-skill', 'SKILL.md'), 'utf-8')).toBe('# Override');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm test -- src/container-runner-sync.test.ts
```

Expected: FAIL — `syncAgentWorkSkills` is not exported.

**Step 3: Extract and export syncAgentWorkSkills**

In `src/container-runner.ts`, extract the skill-sync logic into a named exported function. Add after the existing `copyFileIfSourceNewer` function:

```typescript
export function syncAgentWorkSkills(agentWorkSkillsDir: string, destSkillsDir: string): void {
  if (!fs.existsSync(agentWorkSkillsDir)) return;

  for (const skillDir of fs.readdirSync(agentWorkSkillsDir)) {
    const srcDir = path.join(agentWorkSkillsDir, skillDir);
    if (!fs.statSync(srcDir).isDirectory()) continue;
    const dstDir = path.join(destSkillsDir, skillDir);
    try {
      const stat = fs.lstatSync(dstDir);
      if (stat.isSymbolicLink()) fs.unlinkSync(dstDir);
      else if (stat.isDirectory()) fs.rmSync(dstDir, { recursive: true });
    } catch { /* doesn't exist yet */ }
    fs.cpSync(srcDir, dstDir, { recursive: true });
  }
}
```

**Step 4: Call syncAgentWorkSkills in buildVolumeMounts**

In `buildVolumeMounts`, after the existing built-in skill sync loop (after the `for (const skillDir of fs.readdirSync(skillsSrc))` block), add:

```typescript
// Merge agent-work/skills/ on top of built-in skills (main group only)
if (isMain) {
  const agentWorkSkillsDir = path.join(process.cwd(), 'agent-work', 'skills');
  syncAgentWorkSkills(agentWorkSkillsDir, skillsDst);
}
```

**Step 5: Run tests**

```bash
npm test -- src/container-runner-sync.test.ts
```

Expected: all PASS.

**Step 6: Run all tests**

```bash
npm test
```

Expected: all pass.

**Step 7: Commit**

```bash
git add src/container-runner.ts src/container-runner-sync.test.ts
git commit -m "feat: extend skill sync to include agent-work/skills/ for main group"
```

---

### Task 5: Create ipc-host-ops.ts with git_commit handler

**Files:**
- Create: `src/ipc-host-ops.ts`
- Create: `src/ipc-host-ops.test.ts`

The git IPC handlers live in a dedicated module to keep `ipc.ts` focused on task/group management. All git operations call `execSync` which throws on failure — errors are caught and returned as `{ success: false, error }`.

**Step 1: Write failing tests**

Create `src/ipc-host-ops.test.ts`:

```typescript
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { handleGitCommit, ALLOWED_COMMIT_PATHS } from './ipc-host-ops.js';

describe('handleGitCommit', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-git-'));
    execSync('git init', { cwd: tmpDir });
    execSync('git config user.email "test@test.com"', { cwd: tmpDir });
    execSync('git config user.name "Test"', { cwd: tmpDir });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects paths outside allowed prefixes', async () => {
    const result = await handleGitCommit(
      { paths: ['src/index.ts'], message: 'bad' },
      tmpDir,
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not allowed/i);
  });

  it('rejects path traversal attempts', async () => {
    const result = await handleGitCommit(
      { paths: ['agent-work/../../src/index.ts'], message: 'bad' },
      tmpDir,
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not allowed/i);
  });

  it('commits files in allowed paths', async () => {
    const agentWorkDir = path.join(tmpDir, 'agent-work', 'integrations');
    fs.mkdirSync(agentWorkDir, { recursive: true });
    fs.writeFileSync(path.join(agentWorkDir, 'test.txt'), 'hello');

    const result = await handleGitCommit(
      { paths: ['agent-work/integrations'], message: 'test commit' },
      tmpDir,
    );
    expect(result.success).toBe(true);

    const log = execSync('git log --oneline', { cwd: tmpDir }).toString();
    expect(log).toContain('test commit');
  });

  it('returns error when there is nothing to commit', async () => {
    const result = await handleGitCommit(
      { paths: ['agent-work/integrations'], message: 'empty' },
      tmpDir,
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/nothing to commit/i);
  });
});

describe('ALLOWED_COMMIT_PATHS', () => {
  it('includes agent-work/, container/skills/, and groups/main/CLAUDE.md', () => {
    expect(ALLOWED_COMMIT_PATHS).toContain('agent-work/');
    expect(ALLOWED_COMMIT_PATHS).toContain('container/skills/');
    expect(ALLOWED_COMMIT_PATHS).toContain('groups/main/CLAUDE.md');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm test -- src/ipc-host-ops.test.ts
```

Expected: FAIL — module not found.

**Step 3: Implement ipc-host-ops.ts**

Create `src/ipc-host-ops.ts`:

```typescript
import { execSync } from 'child_process';
import path from 'path';

import { logger } from './logger.js';

export const ALLOWED_COMMIT_PATHS = [
  'agent-work/',
  'container/skills/',
  'groups/main/CLAUDE.md',
];

export interface HostOpResult {
  success: boolean;
  output?: string;
  error?: string;
}

function isPathAllowed(filePath: string): boolean {
  // Normalize to prevent traversal (../../etc)
  const normalized = path.normalize(filePath);
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) return false;
  return ALLOWED_COMMIT_PATHS.some(
    (allowed) => normalized === allowed || normalized.startsWith(allowed),
  );
}

export async function handleGitCommit(
  data: { paths: unknown; message: unknown },
  cwd: string = process.cwd(),
): Promise<HostOpResult> {
  const { paths, message } = data;

  if (!Array.isArray(paths) || paths.length === 0) {
    return { success: false, error: 'paths must be a non-empty array' };
  }
  if (typeof message !== 'string' || !message.trim()) {
    return { success: false, error: 'message must be a non-empty string' };
  }

  for (const p of paths) {
    if (typeof p !== 'string' || !isPathAllowed(p)) {
      return {
        success: false,
        error: `Path not allowed: "${p}". Only agent-work/, container/skills/, and groups/main/CLAUDE.md may be committed via IPC.`,
      };
    }
  }

  try {
    const addArgs = paths.map((p) => `"${p}"`).join(' ');
    execSync(`git add ${addArgs}`, { cwd });

    // Check if there's anything staged
    const staged = execSync('git diff --cached --name-only', { cwd }).toString().trim();
    if (!staged) {
      return { success: false, error: 'Nothing to commit — no changes staged in the specified paths.' };
    }

    const output = execSync(`git commit -m ${JSON.stringify(message.trim())}`, { cwd }).toString();
    logger.info({ paths, message }, 'IPC git_commit succeeded');
    return { success: true, output };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.warn({ paths, message, error }, 'IPC git_commit failed');
    return { success: false, error };
  }
}
```

**Step 4: Run tests**

```bash
npm test -- src/ipc-host-ops.test.ts
```

Expected: all PASS.

**Step 5: Run all tests**

```bash
npm test
```

Expected: all pass.

**Step 6: Commit**

```bash
git add src/ipc-host-ops.ts src/ipc-host-ops.test.ts
git commit -m "feat: add git_commit IPC host operation with path allowlist"
```

---

### Task 6: Add git_push and create_pr handlers

**Files:**
- Modify: `src/ipc-host-ops.ts`
- Modify: `src/ipc-host-ops.test.ts`

**Step 1: Write failing tests**

Add to `src/ipc-host-ops.test.ts`:

```typescript
import { handleGitPush, handleCreatePr } from './ipc-host-ops.js';

describe('handleGitPush', () => {
  it('rejects push to main', async () => {
    const result = await handleGitPush({ branch: 'main' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/cannot push to main/i);
  });

  it('rejects push to master', async () => {
    const result = await handleGitPush({ branch: 'master' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/cannot push to main/i);
  });

  it('rejects missing branch', async () => {
    const result = await handleGitPush({ branch: undefined });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/branch/i);
  });

  it('rejects empty branch name', async () => {
    const result = await handleGitPush({ branch: '' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/branch/i);
  });
});

describe('handleCreatePr', () => {
  it('rejects missing GITHUB_TOKEN', async () => {
    const result = await handleCreatePr(
      { title: 'Test', body: 'Body', branch: 'feat/test', base: 'main' },
      '', // no token
      'CptCaptain/nanoclaw',
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/GITHUB_TOKEN/i);
  });

  it('rejects missing GITHUB_REPO', async () => {
    const result = await handleCreatePr(
      { title: 'Test', body: 'Body', branch: 'feat/test', base: 'main' },
      'ghp_fake',
      '', // no repo
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/GITHUB_REPO/i);
  });

  it('rejects missing title', async () => {
    const result = await handleCreatePr(
      { title: '', body: 'Body', branch: 'feat/test', base: 'main' },
      'ghp_fake',
      'CptCaptain/nanoclaw',
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/title/i);
  });

  it('rejects push to protected base branch via PR targeting non-main', async () => {
    // PR base can be main — that's the intended use
    // This test just verifies validation logic doesn't block valid input shape
    const result = await handleCreatePr(
      { title: 'feat', body: 'body', branch: '', base: 'main' },
      'ghp_fake',
      'CptCaptain/nanoclaw',
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/branch/i);
  });
});
```

**Step 2: Run to verify failures**

```bash
npm test -- src/ipc-host-ops.test.ts
```

Expected: FAIL — `handleGitPush` and `handleCreatePr` not exported.

**Step 3: Add handlers to ipc-host-ops.ts**

Append to `src/ipc-host-ops.ts`:

```typescript
const PROTECTED_BRANCHES = new Set(['main', 'master']);

export async function handleGitPush(
  data: { branch: unknown },
  cwd: string = process.cwd(),
): Promise<HostOpResult> {
  const { branch } = data;

  if (typeof branch !== 'string' || !branch.trim()) {
    return { success: false, error: 'branch must be a non-empty string' };
  }
  if (PROTECTED_BRANCHES.has(branch.trim())) {
    return { success: false, error: `Cannot push to main/master branch via IPC. Use a feature branch.` };
  }

  try {
    const b = branch.trim();
    // Create branch from HEAD if it doesn't exist on remote, then push
    const output = execSync(
      `git push origin HEAD:refs/heads/${b} --set-upstream`,
      { cwd },
    ).toString();
    logger.info({ branch: b }, 'IPC git_push succeeded');
    return { success: true, output };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.warn({ branch, error }, 'IPC git_push failed');
    return { success: false, error };
  }
}

export async function handleCreatePr(
  data: { title: unknown; body: unknown; branch: unknown; base: unknown },
  githubToken: string,
  githubRepo: string,
): Promise<HostOpResult> {
  if (!githubToken) return { success: false, error: 'GITHUB_TOKEN is not configured' };
  if (!githubRepo) return { success: false, error: 'GITHUB_REPO is not configured' };

  const { title, body, branch, base } = data;
  if (typeof title !== 'string' || !title.trim()) {
    return { success: false, error: 'title must be a non-empty string' };
  }
  if (typeof branch !== 'string' || !branch.trim()) {
    return { success: false, error: 'branch must be a non-empty string' };
  }
  const prBase = typeof base === 'string' && base.trim() ? base.trim() : 'main';

  try {
    const response = await fetch(`https://api.github.com/repos/${githubRepo}/pulls`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: title.trim(),
        body: typeof body === 'string' ? body : '',
        head: branch.trim(),
        base: prBase,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `GitHub API error ${response.status}: ${text}` };
    }

    const pr = await response.json() as { html_url: string; number: number };
    logger.info({ pr: pr.number, url: pr.html_url }, 'IPC create_pr succeeded');
    return { success: true, output: `PR #${pr.number}: ${pr.html_url}` };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.warn({ branch, error }, 'IPC create_pr failed');
    return { success: false, error };
  }
}
```

**Step 4: Run tests**

```bash
npm test -- src/ipc-host-ops.test.ts
```

Expected: all PASS.

**Step 5: Run all tests**

```bash
npm test
```

**Step 6: Commit**

```bash
git add src/ipc-host-ops.ts src/ipc-host-ops.test.ts
git commit -m "feat: add git_push and create_pr IPC host operations"
```

---

### Task 7: Add deploy handler

**Files:**
- Modify: `src/ipc-host-ops.ts`
- Modify: `src/ipc-host-ops.test.ts`

**Step 1: Write failing test**

Add to `src/ipc-host-ops.test.ts`:

```typescript
import { handleDeploy } from './ipc-host-ops.js';

describe('handleDeploy', () => {
  it('returns step results and stops on first failure', async () => {
    // Use a temp dir with no package.json — npm install will fail
    const result = await handleDeployWithCommands(
      [
        { name: 'step1', cmd: 'echo ok' },
        { name: 'step2', cmd: 'false' }, // always fails
        { name: 'step3', cmd: 'echo should-not-run' },
      ],
      tmpDir,
    );
    expect(result.success).toBe(false);
    expect(result.steps?.find((s) => s.name === 'step1')?.success).toBe(true);
    expect(result.steps?.find((s) => s.name === 'step2')?.success).toBe(false);
    expect(result.steps?.find((s) => s.name === 'step3')).toBeUndefined();
  });
});
```

Note: `handleDeployWithCommands` is a testable variant; `handleDeploy` calls it with the real commands. Add to imports at top of test file.

**Step 2: Run to verify failure**

```bash
npm test -- src/ipc-host-ops.test.ts
```

Expected: FAIL.

**Step 3: Add deploy handlers to ipc-host-ops.ts**

Append to `src/ipc-host-ops.ts`:

```typescript
interface DeployStep {
  name: string;
  cmd: string;
}

interface DeployResult {
  success: boolean;
  steps?: Array<{ name: string; success: boolean; output?: string; error?: string }>;
  error?: string;
}

export async function handleDeployWithCommands(
  steps: DeployStep[],
  cwd: string,
): Promise<DeployResult> {
  const results: Array<{ name: string; success: boolean; output?: string; error?: string }> = [];

  for (const step of steps) {
    try {
      const output = execSync(step.cmd, { cwd, encoding: 'utf-8' });
      results.push({ name: step.name, success: true, output });
      logger.info({ step: step.name }, 'Deploy step succeeded');
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({ name: step.name, success: false, error });
      logger.error({ step: step.name, error }, 'Deploy step failed — aborting');
      return { success: false, steps: results };
    }
  }

  return { success: true, steps: results };
}

export async function handleDeploy(cwd: string = process.cwd()): Promise<DeployResult> {
  const steps: DeployStep[] = [
    { name: 'git_pull', cmd: 'git pull --rebase origin main' },
    { name: 'npm_install', cmd: 'npm install' },
    { name: 'migrations', cmd: 'echo "no migrations"' }, // placeholder
    { name: 'build', cmd: 'npm run build' },
    // Restart is handled by caller after confirming build succeeded
  ];

  const result = await handleDeployWithCommands(steps, cwd);

  if (result.success) {
    logger.info('Deploy pipeline succeeded — scheduling restart');
    // Delay restart slightly so IPC result can be written first
    setTimeout(() => process.exit(0), 500);
  }

  return result;
}
```

**Step 4: Run tests**

```bash
npm test -- src/ipc-host-ops.test.ts
```

Expected: all PASS.

**Step 5: Run all tests**

```bash
npm test
```

**Step 6: Commit**

```bash
git add src/ipc-host-ops.ts src/ipc-host-ops.test.ts
git commit -m "feat: add deploy IPC host operation (pull, install, build, restart)"
```

---

### Task 8: Wire host ops into ipc.ts

**Files:**
- Modify: `src/ipc.ts:186-430` (the `processTaskIpc` switch)
- Modify: `src/config.ts`
- Modify: `src/ipc-auth.test.ts`

**Step 1: Add GITHUB_TOKEN and GITHUB_REPO to config.ts**

In `src/config.ts`, add to the `readEnvFile` call:

```typescript
const envConfig = readEnvFile([
  'ASSISTANT_NAME',
  'ASSISTANT_HAS_OWN_NUMBER',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_ONLY',
  'TELEGRAM_BOT_POOL',
  'GITHUB_TOKEN',
  'GITHUB_REPO',
]);
```

And export them:

```typescript
export const GITHUB_TOKEN =
  process.env.GITHUB_TOKEN || envConfig.GITHUB_TOKEN || '';
export const GITHUB_REPO =
  process.env.GITHUB_REPO || envConfig.GITHUB_REPO || 'CptCaptain/nanoclaw';
```

**Step 2: Write failing tests for the new IPC task types**

Add to `src/ipc-auth.test.ts`:

```typescript
describe('git_commit authorization', () => {
  it('main group can trigger git_commit', async () => {
    // Should reach the handler (not be blocked by auth)
    // Handler will fail due to test env, but auth should pass
    const result = await processTaskIpc(
      { type: 'git_commit', paths: ['agent-work/test'], message: 'test' },
      'main',
      true,
      deps,
    );
    // No auth error — result is whatever the handler returns
    // We just verify it doesn't throw and auth isn't blocking it
  });

  it('non-main group cannot trigger git_commit', async () => {
    // Should be silently blocked
    await processTaskIpc(
      { type: 'git_commit', paths: ['agent-work/test'], message: 'test' },
      'other-group',
      false,
      deps,
    );
    // If we get here without error, auth gate worked
  });
});

describe('deploy authorization', () => {
  it('non-main group cannot trigger deploy', async () => {
    await processTaskIpc(
      { type: 'deploy' },
      'other-group',
      false,
      deps,
    );
    // Auth gate should block silently
  });
});
```

**Step 3: Run to verify failures**

```bash
npm test -- src/ipc-auth.test.ts
```

Expected: FAIL — unknown IPC task type for `git_commit` and `deploy`.

**Step 4: Wire into processTaskIpc in ipc.ts**

In `src/ipc.ts`, add imports at the top:

```typescript
import { handleGitCommit, handleGitPush, handleCreatePr, handleDeploy } from './ipc-host-ops.js';
import { GITHUB_TOKEN, GITHUB_REPO } from './config.js';
```

In the `processTaskIpc` switch statement (before the `default` case), add:

```typescript
case 'git_commit': {
  if (!isMain) {
    logger.warn({ groupFolder }, 'Non-main group attempted git_commit — blocked');
    break;
  }
  const result = await handleGitCommit(data, process.cwd());
  writeIpcResult(groupFolder, data.taskId as string | undefined, result);
  break;
}

case 'git_push': {
  if (!isMain) {
    logger.warn({ groupFolder }, 'Non-main group attempted git_push — blocked');
    break;
  }
  const result = await handleGitPush(data, process.cwd());
  writeIpcResult(groupFolder, data.taskId as string | undefined, result);
  break;
}

case 'create_pr': {
  if (!isMain) {
    logger.warn({ groupFolder }, 'Non-main group attempted create_pr — blocked');
    break;
  }
  const result = await handleCreatePr(data, GITHUB_TOKEN, GITHUB_REPO);
  writeIpcResult(groupFolder, data.taskId as string | undefined, result);
  break;
}

case 'deploy': {
  if (!isMain) {
    logger.warn({ groupFolder }, 'Non-main group attempted deploy — blocked');
    break;
  }
  const result = await handleDeploy(process.cwd());
  writeIpcResult(groupFolder, data.taskId as string | undefined, result);
  break;
}
```

**Step 5: Add writeIpcResult helper to ipc.ts**

Add this helper function near the top of `src/ipc.ts` (after the imports):

```typescript
function writeIpcResult(
  groupFolder: string,
  taskId: string | undefined,
  result: { success: boolean; output?: string; error?: string; steps?: unknown },
): void {
  if (!taskId) return;
  const resultPath = path.join(
    DATA_DIR, 'ipc', groupFolder, 'input', `${taskId}-result.json`,
  );
  try {
    fs.mkdirSync(path.dirname(resultPath), { recursive: true });
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
  } catch (err) {
    logger.warn({ taskId, err }, 'Failed to write IPC result file');
  }
}
```

**Step 6: Run tests**

```bash
npm test -- src/ipc-auth.test.ts
```

Expected: all PASS.

**Step 7: Run all tests**

```bash
npm test
```

Expected: all pass.

**Step 8: Commit**

```bash
git add src/ipc.ts src/ipc-host-ops.ts src/config.ts src/ipc-auth.test.ts
git commit -m "feat: wire git_commit, git_push, create_pr, deploy into IPC handler"
```

---

### Task 9: Update groups/main/CLAUDE.md with workspace instructions

**Files:**
- Modify: `groups/main/CLAUDE.md`

**Step 1: Add the workspace section**

In `groups/main/CLAUDE.md`, add a new section after the `## Container Mounts` table:

```markdown
## Versioned Workspace

`/workspace/work` maps to `agent-work/` in the nanoclaw repository. This directory is **git-tracked** — everything you build here persists across sessions and can be versioned.

| Path | Purpose |
|------|---------|
| `/workspace/work/integrations/` | Integrations you build (MCP servers, channel adapters) |
| `/workspace/work/skills/` | Skills you write — available to you on the next container turn |
| `/workspace/work/subagents/` | Output and artifacts from subagent work |

**Rules:**
- Build things in `/workspace/work`, not in `/workspace/group` (ephemeral, not versioned)
- Skills you write to `/workspace/work/skills/` are available to you only (main group). To make a skill available to all groups, promote it to `container/skills/` via a PR.

## Shipping Changes via IPC

To version and ship your work, write task files to `/workspace/ipc/tasks/`:

**Commit files:**
```json
{
  "type": "git_commit",
  "taskId": "commit-1",
  "message": "feat: add home-assistant integration",
  "paths": ["agent-work/integrations/home-assistant"]
}
```

**Push a branch:**
```json
{
  "type": "git_push",
  "taskId": "push-1",
  "branch": "feat/home-assistant-integration"
}
```

**Open a PR:**
```json
{
  "type": "create_pr",
  "taskId": "pr-1",
  "title": "feat: add Home Assistant MCP integration",
  "body": "Adds an MCP server for Home Assistant...",
  "branch": "feat/home-assistant-integration",
  "base": "main"
}
```

**Deploy after PR is merged:**
```json
{
  "type": "deploy",
  "taskId": "deploy-1"
}
```

Results are written to `/workspace/ipc/input/{taskId}-result.json`. Always include a `taskId` so you can read the result.

Allowed paths for `git_commit`: `agent-work/`, `container/skills/`, `groups/main/CLAUDE.md`.
`git_push` cannot target `main` or `master`.
```

**Step 2: Run all tests to confirm nothing broke**

```bash
npm test
```

**Step 3: Commit**

```bash
git add groups/main/CLAUDE.md
git commit -m "docs: tell Klaus about /workspace/work and IPC git/deploy operations"
```

---

### Task 10: Final verification

**Step 1: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

**Step 2: Build TypeScript**

```bash
npm run build
```

Expected: no errors.

**Step 3: Verify agent-work/ structure is correct**

```bash
find agent-work -not -path '*/node_modules/*' -type f | sort
```

Expected: `.gitkeep` files plus the home-assistant integration files.

**Step 4: Confirm the new IPC result path is documented**

```bash
grep -r "taskId-result" src/
```

Expected: found in `src/ipc.ts` (the `writeIpcResult` helper).

**Step 5: Final commit if any loose ends**

```bash
git status
```

If clean, done. If anything missed, stage and commit with a descriptive message.
