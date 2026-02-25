import { describe, expect, it, vi } from 'vitest';

import {
  cleanupWorktreesOnce,
  CommandResult,
  CommandRunner,
} from './worktree-cleanup.js';

type StubMap = Record<string, CommandResult | (() => CommandResult)>;

function runnerFrom(stubs: StubMap): CommandRunner {
  return (bin, args, cwd) => {
    const key = `${cwd || ''}|${bin} ${args.join(' ')}`;
    const stub = stubs[key] ?? stubs[`|${bin} ${args.join(' ')}`];
    if (!stub) {
      throw new Error(`Missing stub for command: ${key}`);
    }
    return typeof stub === 'function' ? stub() : stub;
  };
}

function ok(stdout = ''): CommandResult {
  return { status: 0, stdout, stderr: '' };
}

const WORKTREES = `worktree /repo
HEAD 1111111
branch refs/heads/main

worktree /repo/.worktrees/feat-merged
HEAD 2222222
branch refs/heads/feat/merged

worktree /repo/.worktrees/feat-open
HEAD 3333333
branch refs/heads/feat/open
`;

describe('cleanupWorktreesOnce', () => {
  it('removes worktree and local branch when PR is merged', async () => {
    const run = vi.fn(
      runnerFrom({
        '|git worktree prune': ok(),
        '|git worktree list --porcelain': ok(WORKTREES),
        '|gh pr list --head feat/merged --state all --json state,mergedAt,number,url --limit 1': ok(
          '[{"state":"MERGED","mergedAt":"2026-02-25T10:00:00Z","number":12,"url":"u"}]',
        ),
        '|gh pr list --head feat/open --state all --json state,mergedAt,number,url --limit 1': ok(
          '[{"state":"OPEN","mergedAt":null,"number":13,"url":"u2"}]',
        ),
        '/repo/.worktrees/feat-merged|git status --porcelain': ok(''),
        '|git worktree remove --force /repo/.worktrees/feat-merged': ok(),
        '|git branch -D feat/merged': ok(),
        '|git log -1 --format=%ct feat/open': ok(`${Math.floor(Date.now() / 1000)}`),
      }),
    );

    const result = await cleanupWorktreesOnce({
      repoPath: '/repo',
      run,
      now: () => Date.now(),
      staleDays: 7,
    });

    expect(result.removedBranches).toEqual(['feat/merged']);
    expect(run).toHaveBeenCalledWith('git', ['worktree', 'prune'], '/repo');
    expect(run).toHaveBeenCalledWith(
      'git',
      ['worktree', 'remove', '--force', '/repo/.worktrees/feat-merged'],
      '/repo',
    );
    expect(run).toHaveBeenCalledWith('git', ['branch', '-D', 'feat/merged'], '/repo');
  });

  it('keeps worktrees with open PRs', async () => {
    const run = vi.fn(
      runnerFrom({
        '|git worktree prune': ok(),
        '|git worktree list --porcelain': ok(`worktree /repo\nHEAD 1\nbranch refs/heads/feat/open\n`),
        '|gh pr list --head feat/open --state all --json state,mergedAt,number,url --limit 1': ok(
          '[{"state":"OPEN","mergedAt":null}]',
        ),
        '|git log -1 --format=%ct feat/open': ok(`${Math.floor(Date.now() / 1000)}`),
      }),
    );

    const result = await cleanupWorktreesOnce({ repoPath: '/repo', run });

    expect(result.removedBranches).toEqual([]);
    expect(result.skippedOpenPrBranches).toEqual(['feat/open']);
  });

  it('keeps worktrees with no PR', async () => {
    const run = vi.fn(
      runnerFrom({
        '|git worktree prune': ok(),
        '|git worktree list --porcelain': ok(`worktree /repo\nHEAD 1\nbranch refs/heads/feat/local\n`),
        '|gh pr list --head feat/local --state all --json state,mergedAt,number,url --limit 1': ok('[]'),
        '|git log -1 --format=%ct feat/local': ok(`${Math.floor(Date.now() / 1000)}`),
      }),
    );

    const result = await cleanupWorktreesOnce({ repoPath: '/repo', run });

    expect(result.removedBranches).toEqual([]);
    expect(result.skippedNoPrBranches).toEqual(['feat/local']);
  });

  it('does not remove dirty worktree even when PR is closed', async () => {
    const run = vi.fn(
      runnerFrom({
        '|git worktree prune': ok(),
        '|git worktree list --porcelain': ok(`worktree /repo/.worktrees/feat/closed\nHEAD 1\nbranch refs/heads/feat/closed\n`),
        '|gh pr list --head feat/closed --state all --json state,mergedAt,number,url --limit 1': ok(
          '[{"state":"CLOSED","mergedAt":null}]',
        ),
        '/repo/.worktrees/feat/closed|git status --porcelain': ok(' M file.ts\n'),
      }),
    );

    const result = await cleanupWorktreesOnce({ repoPath: '/repo', run });

    expect(result.removedBranches).toEqual([]);
    expect(result.skippedDirtyBranches).toEqual(['feat/closed']);
    expect(run).not.toHaveBeenCalledWith(
      'git',
      ['worktree', 'remove', '--force', '/repo/.worktrees/feat/closed'],
      '/repo',
    );
  });

  it('alerts when open or no-PR branch is stale for configured days', async () => {
    const alert = vi.fn();
    const now = new Date('2026-02-25T12:00:00.000Z').getTime();
    const staleTs = Math.floor((now - 8 * 24 * 60 * 60 * 1000) / 1000);

    const run = vi.fn(
      runnerFrom({
        '|git worktree prune': ok(),
        '|git worktree list --porcelain': ok(`worktree /repo/.worktrees/feat/open\nHEAD 1\nbranch refs/heads/feat/open\n`),
        '|gh pr list --head feat/open --state all --json state,mergedAt,number,url --limit 1': ok(
          '[{"state":"OPEN","mergedAt":null}]',
        ),
        '|git log -1 --format=%ct feat/open': ok(`${staleTs}`),
      }),
    );

    const result = await cleanupWorktreesOnce({
      repoPath: '/repo',
      run,
      now: () => now,
      staleDays: 7,
      onStaleAlert: alert,
    });

    expect(result.staleBranches).toEqual(['feat/open']);
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][0]).toContain('feat/open');
  });
});
