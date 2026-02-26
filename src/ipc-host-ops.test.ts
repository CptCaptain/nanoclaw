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
