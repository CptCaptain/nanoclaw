# Entrypoint Input-File Race Handling Design

## Context
`container/entrypoint.sh` runs a restart loop for the Node process and feeds stdin from `/tmp/input.json`.
`agent-runner` deletes `/tmp/input.json` after consumption. A race can occur between pre-launch file checks and shell redirection (`< /tmp/input.json`), causing noisy launch failures.

## Goals
- Treat missing `/tmp/input.json` as normal turn completion (`exit 0`) even before first launch.
- Handle TOCTOU disappearance between check and launch cleanly.
- Keep launch style simple (stdin redirection), not FD-preopen complexity.
- Improve script readability by extracting restart-budget logic.

## Non-Goals
- Changing restart threshold policy.
- Introducing new runtime dependencies.
- Backward-compatibility behavior changes beyond input-missing classification.

## Approaches Considered
1. **Pre-check only**: simple but still race-prone.
2. **Capture launch stderr and classify failures by current input-file state** (**chosen**): preserves redirection style while handling race.
3. **FD pre-open approach**: robust but less readable and not preferred.

## Chosen Design

### Control Flow
Per loop iteration:
1. If `/tmp/input.json` is missing at loop start, log and `exit 0`.
2. Launch `node /tmp/dist/index.js < /tmp/input.json` while capturing stderr to a temp file.
3. If launch exits non-zero:
   - If input file is now missing, log race-classified completion and `exit 0`.
   - Otherwise replay stderr and continue normal restart handling.
4. If launch succeeds/exits normally, continue normal restart handling.
5. Restart-budget check is delegated to a helper function; exits `1` on crash-loop threshold.

### Error Handling and Logging
- Explicit logs for:
  - missing input before launch
  - input disappearing during launch (TOCTOU path)
  - restart-threshold crash loop
- Preserve existing restart semantics for genuine process failures.

### Testing/Verification
- Shell syntax check for `container/entrypoint.sh`.
- Project build command (`npm run build`) to confirm no broader breakage.
- Optional manual scenario checks around missing input behavior.

## Acceptance Criteria
- No retry loop from missing input after turn completion.
- TOCTOU missing-file case exits cleanly with clear log.
- Non-input failures continue to use restart budget and threshold exit behavior.
- Script is simpler to scan due to extracted restart-budget function.
