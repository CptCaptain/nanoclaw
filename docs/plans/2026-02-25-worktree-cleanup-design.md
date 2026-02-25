# Worktree Cleanup Automation (Design)

## Goal
Automatically clean up finished local worktrees in NanoClaw while preserving active work, and alert the owner about stale in-progress worktrees.

## Requirements
1. Run periodically from NanoClaw host process.
2. Keep worktrees with open PRs.
3. Remove worktrees with closed or merged PRs.
4. Also delete the corresponding local branch when that worktree is removed.
5. Preserve in-progress worktrees (no PR yet).
6. Alert when an in-progress worktree has had no commit activity for 7+ days.
7. Send stale alerts to logs and to the main channel.

## Approach
Implement a lightweight periodic host loop (independent from user task scheduler):

- New module `src/worktree-cleanup.ts`:
  - `cleanupWorktreesOnce()` executes one cleanup pass.
  - `startWorktreeCleanupLoop()` schedules periodic passes.
- Integrate loop in `src/index.ts` during startup.
- Add config:
  - `WORKTREE_CLEANUP_INTERVAL_MS` (default 6h)
  - `WORKTREE_STALE_DAYS` (default 7)

## Cleanup Algorithm
Per run:
1. `git worktree prune` to remove stale/broken metadata entries.
2. Parse `git worktree list --porcelain`.
3. For each non-main/non-master branch worktree:
   - Fetch PR state via GH CLI (`gh pr list --head <branch> --state all`).
   - If PR is **OPEN**: keep.
   - If PR is **CLOSED** or **MERGED**:
     - If dirty: skip removal and log warning.
     - Else remove worktree (`git worktree remove --force <path>`) and delete branch (`git branch -D <branch>`).
   - If no PR: keep.
4. For kept branches (open/no PR), check last commit timestamp. If idle >= stale threshold, emit stale alert.

## Alerting
- Always log cleanup summary.
- For stale branches, send a message to the main registered chat via existing channel routing.
- If channel send fails, keep process alive and log warning.

## Safety / Failure Handling
- If `git`/`gh` is unavailable or commands fail, log warning and continue (non-fatal).
- Never touch main/master worktree.
- Never remove dirty worktrees.

## Test Plan
TDD coverage for `src/worktree-cleanup.ts`:
- removes branches with CLOSED/MERGED PRs
- keeps branches with OPEN PRs
- keeps branches with no PR
- skips dirty worktree removal
- runs prune each pass
- marks stale branches and triggers alert callback
