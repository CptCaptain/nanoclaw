import { spawnSync } from 'child_process';

import { logger } from './logger.js';

export interface CommandResult {
  status: number;
  stdout: string;
  stderr: string;
  error?: Error;
}

export type CommandRunner = (
  bin: string,
  args: string[],
  cwd?: string,
) => CommandResult;

export interface WorktreeCleanupOptions {
  repoPath?: string;
  staleDays?: number;
  run?: CommandRunner;
  now?: () => number;
  onStaleAlert?: (message: string) => Promise<void> | void;
}

export interface WorktreeCleanupResult {
  removedBranches: string[];
  staleBranches: string[];
  skippedOpenPrBranches: string[];
  skippedNoPrBranches: string[];
  skippedDirtyBranches: string[];
  errors: string[];
}

interface WorktreeEntry {
  path: string;
  branch?: string;
}

interface PrInfo {
  state?: string;
  mergedAt?: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function defaultRunner(bin: string, args: string[], cwd?: string): CommandResult {
  const result = spawnSync(bin, args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return {
    status: result.status ?? (result.error ? 1 : 0),
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error,
  };
}

function parseWorktreeList(output: string): WorktreeEntry[] {
  const lines = output.split('\n');
  const entries: WorktreeEntry[] = [];
  let current: WorktreeEntry | null = null;

  for (const line of lines) {
    if (!line.trim()) {
      if (current?.path) entries.push(current);
      current = null;
      continue;
    }

    if (line.startsWith('worktree ')) {
      if (current?.path) entries.push(current);
      current = { path: line.slice('worktree '.length).trim() };
      continue;
    }

    if (line.startsWith('branch ')) {
      const ref = line.slice('branch '.length).trim();
      if (ref.startsWith('refs/heads/')) {
        current = current || { path: '' };
        current.branch = ref.slice('refs/heads/'.length);
      }
    }
  }

  if (current?.path) entries.push(current);
  return entries;
}

function getPrState(pr: PrInfo | undefined): 'OPEN' | 'CLOSED' | 'MERGED' | 'NONE' {
  if (!pr) return 'NONE';
  if (pr.mergedAt) return 'MERGED';
  const state = (pr.state || '').toUpperCase();
  if (state === 'OPEN') return 'OPEN';
  if (state === 'CLOSED') return 'CLOSED';
  if (state === 'MERGED') return 'MERGED';
  return 'NONE';
}

async function sendStaleAlert(
  staleBranches: string[],
  staleDays: number,
  onStaleAlert?: (message: string) => Promise<void> | void,
): Promise<void> {
  if (!onStaleAlert || staleBranches.length === 0) return;

  const body = staleBranches.map((branch) => `- ${branch}`).join('\n');
  const msg = `⚠️ Stale worktrees (no commit activity for >= ${staleDays} days):\n${body}`;
  await onStaleAlert(msg);
}

export async function cleanupWorktreesOnce(
  options: WorktreeCleanupOptions = {},
): Promise<WorktreeCleanupResult> {
  const repoPath = options.repoPath || process.cwd();
  const staleDays = options.staleDays ?? 7;
  const run = options.run || defaultRunner;
  const now = options.now || (() => Date.now());

  const result: WorktreeCleanupResult = {
    removedBranches: [],
    staleBranches: [],
    skippedOpenPrBranches: [],
    skippedNoPrBranches: [],
    skippedDirtyBranches: [],
    errors: [],
  };

  const prune = run('git', ['worktree', 'prune'], repoPath);
  if (prune.status !== 0) {
    result.errors.push(`git worktree prune failed: ${prune.stderr || prune.error?.message || 'unknown error'}`);
  }

  const list = run('git', ['worktree', 'list', '--porcelain'], repoPath);
  if (list.status !== 0) {
    result.errors.push(`git worktree list failed: ${list.stderr || list.error?.message || 'unknown error'}`);
    return result;
  }

  const worktrees = parseWorktreeList(list.stdout);

  for (const wt of worktrees) {
    const branch = wt.branch;
    if (!branch) continue;
    if (branch === 'main' || branch === 'master') continue;

    const prCmd = run(
      'gh',
      ['pr', 'list', '--head', branch, '--state', 'all', '--json', 'state,mergedAt,number,url', '--limit', '1'],
      repoPath,
    );

    let prState: 'OPEN' | 'CLOSED' | 'MERGED' | 'NONE' = 'NONE';
    if (prCmd.status === 0) {
      try {
        const prs = JSON.parse(prCmd.stdout || '[]') as PrInfo[];
        prState = getPrState(prs[0]);
      } catch (err) {
        result.errors.push(`Failed to parse PR state for ${branch}: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      result.errors.push(`gh pr list failed for ${branch}: ${prCmd.stderr || prCmd.error?.message || 'unknown error'}`);
    }

    if (prState === 'OPEN') {
      result.skippedOpenPrBranches.push(branch);
    } else if (prState === 'CLOSED' || prState === 'MERGED') {
      const dirty = run('git', ['status', '--porcelain'], wt.path);
      if (dirty.status !== 0) {
        result.errors.push(`git status failed for ${branch}: ${dirty.stderr || dirty.error?.message || 'unknown error'}`);
        continue;
      }
      if (dirty.stdout.trim()) {
        result.skippedDirtyBranches.push(branch);
        continue;
      }

      const removeWorktree = run('git', ['worktree', 'remove', '--force', wt.path], repoPath);
      if (removeWorktree.status !== 0) {
        result.errors.push(`git worktree remove failed for ${branch}: ${removeWorktree.stderr || removeWorktree.error?.message || 'unknown error'}`);
        continue;
      }

      const removeBranch = run('git', ['branch', '-D', branch], repoPath);
      if (removeBranch.status !== 0) {
        result.errors.push(`git branch -D failed for ${branch}: ${removeBranch.stderr || removeBranch.error?.message || 'unknown error'}`);
      }

      result.removedBranches.push(branch);
      continue;
    } else {
      result.skippedNoPrBranches.push(branch);
    }

    const logCmd = run('git', ['log', '-1', '--format=%ct', branch], repoPath);
    if (logCmd.status !== 0) {
      result.errors.push(`git log failed for ${branch}: ${logCmd.stderr || logCmd.error?.message || 'unknown error'}`);
      continue;
    }

    const ts = Number.parseInt(logCmd.stdout.trim(), 10);
    if (!Number.isFinite(ts)) {
      result.errors.push(`Invalid commit timestamp for ${branch}: ${logCmd.stdout.trim()}`);
      continue;
    }

    const idleMs = now() - ts * 1000;
    if (idleMs >= staleDays * DAY_MS) {
      result.staleBranches.push(branch);
    }
  }

  try {
    await sendStaleAlert(result.staleBranches, staleDays, options.onStaleAlert);
  } catch (err) {
    result.errors.push(`Failed to send stale worktree alert: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}

export function startWorktreeCleanupLoop(options: {
  intervalMs: number;
  repoPath?: string;
  staleDays?: number;
  onStaleAlert?: (message: string) => Promise<void> | void;
}): void {
  const { intervalMs, repoPath, staleDays, onStaleAlert } = options;
  if (intervalMs <= 0) {
    logger.info({ intervalMs }, 'Worktree cleanup loop disabled');
    return;
  }

  const run = async () => {
    try {
      const summary = await cleanupWorktreesOnce({
        repoPath,
        staleDays,
        onStaleAlert,
      });
      logger.info(
        {
          removedBranches: summary.removedBranches,
          staleBranches: summary.staleBranches,
          skippedOpenPrBranches: summary.skippedOpenPrBranches,
          skippedNoPrBranches: summary.skippedNoPrBranches,
          skippedDirtyBranches: summary.skippedDirtyBranches,
          errorCount: summary.errors.length,
        },
        'Worktree cleanup pass finished',
      );
      for (const error of summary.errors) {
        logger.warn({ error }, 'Worktree cleanup warning');
      }
    } catch (err) {
      logger.warn({ err }, 'Worktree cleanup pass failed');
    } finally {
      setTimeout(run, intervalMs);
    }
  };

  void run();
}
