# Worktree Cleanup Automation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add periodic host-side cleanup of finished git worktrees, while preserving active branches and alerting on stale in-progress work.

**Architecture:** Introduce a dedicated `worktree-cleanup` module that runs git/gh checks, removes worktrees for closed/merged PR branches, and reports stale active branches. Wire this module into startup in `src/index.ts` with configurable interval/stale thresholds from `src/config.ts`.

**Tech Stack:** Node.js (TypeScript), `child_process.spawnSync`, existing logger/channel abstractions, Vitest.

---

### Task 1: Add failing tests for cleanup behavior

**Files:**
- Create: `src/worktree-cleanup.test.ts`
- Create: `src/worktree-cleanup.ts` (API stubs only)

**Steps:**
1. Write tests for:
   - prune command runs
   - open PR branch is kept
   - merged/closed PR branch is removed and local branch deleted
   - branch with no PR is kept
   - dirty worktree is not removed
   - stale branch triggers alert callback
2. Run: `npm test -- src/worktree-cleanup.test.ts`
3. Confirm tests fail due to missing implementation.

### Task 2: Implement single-pass cleanup logic

**Files:**
- Modify: `src/worktree-cleanup.ts`
- Test: `src/worktree-cleanup.test.ts`

**Steps:**
1. Implement git/gh command runner wrapper.
2. Implement parsing of `git worktree list --porcelain`.
3. Implement PR-state lookup per branch.
4. Implement cleanup decisions and actions.
5. Implement stale detection + alert callback.
6. Run: `npm test -- src/worktree-cleanup.test.ts`
7. Confirm pass.

### Task 3: Wire periodic loop and config

**Files:**
- Modify: `src/config.ts`
- Modify: `src/index.ts`
- Modify: `src/worktree-cleanup.ts`

**Steps:**
1. Add config values:
   - `WORKTREE_CLEANUP_INTERVAL_MS` (default 6h)
   - `WORKTREE_STALE_DAYS` (default 7)
2. Add `startWorktreeCleanupLoop(...)` helper.
3. Wire loop startup in `main()` and route stale alerts to main channel.
4. Run targeted tests.

### Task 4: Verify end-to-end test suite and commit

**Files:**
- Modify: any touched source/tests

**Steps:**
1. Run: `npm test -- src/worktree-cleanup.test.ts src/container-runtime.test.ts src/task-scheduler.test.ts`
2. Run: `npm run build`
3. Commit logical changes:
   - tests + module
   - integration wiring/config
