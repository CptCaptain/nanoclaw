import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  handleGitCommit,
  handleGitPush,
  handleCreatePr,
  handleDeployWithCommands,
  ALLOWED_COMMIT_PATHS,
} from './ipc-host-ops.js';

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
      '',
      'CptCaptain/nanoclaw',
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/GITHUB_TOKEN/i);
  });

  it('rejects missing GITHUB_REPO', async () => {
    const result = await handleCreatePr(
      { title: 'Test', body: 'Body', branch: 'feat/test', base: 'main' },
      'ghp_fake',
      '',
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

  it('rejects empty branch', async () => {
    const result = await handleCreatePr(
      { title: 'feat', body: 'body', branch: '', base: 'main' },
      'ghp_fake',
      'CptCaptain/nanoclaw',
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/branch/i);
  });
});

describe('handleDeployWithCommands', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-deploy-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns success when all steps succeed', async () => {
    const result = await handleDeployWithCommands(
      [
        { name: 'step1', cmd: 'echo ok' },
        { name: 'step2', cmd: 'echo also ok' },
      ],
      tmpDir,
    );
    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(2);
    expect(result.steps![0].success).toBe(true);
    expect(result.steps![1].success).toBe(true);
  });

  it('stops on first failure and does not run subsequent steps', async () => {
    const result = await handleDeployWithCommands(
      [
        { name: 'step1', cmd: 'echo ok' },
        { name: 'step2', cmd: 'exit 1' },
        { name: 'step3', cmd: 'echo should-not-run' },
      ],
      tmpDir,
    );
    expect(result.success).toBe(false);
    expect(result.steps).toHaveLength(2);
    expect(result.steps![0].success).toBe(true);
    expect(result.steps![1].success).toBe(false);
  });
});
