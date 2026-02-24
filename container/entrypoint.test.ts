import { describe, expect, it } from 'vitest';
import fs from 'fs';

describe('container/entrypoint.sh', () => {
  const script = fs.readFileSync('container/entrypoint.sh', 'utf8');

  it('extracts restart budget check into a helper', () => {
    expect(script).toContain('check_restart_budget()');
    expect(script).toContain('check_restart_budget');
  });

  it('keeps a pre-launch missing-input check that exits cleanly', () => {
    expect(script).toContain('Input file missing before launch, treating turn as complete');
    expect(script).toContain('if [ ! -f /tmp/input.json ]; then');
    expect(script).toContain('exit 0');
  });

  it('launches node with stderr redirected before stdin', () => {
    expect(script).toContain('if node /tmp/dist/index.js 2>"$launch_stderr" < /tmp/input.json; then');
    expect(script).not.toContain('if node /tmp/dist/index.js < /tmp/input.json 2>"$launch_stderr"; then');
  });

  it('treats input disappearing during launch as clean completion', () => {
    expect(script).toContain('if [ "$EXIT_CODE" -ne 0 ] && [ ! -f /tmp/input.json ]; then');
    expect(script).toContain('Input file disappeared during launch, treating turn as complete');
    expect(script).toContain('exit 0');
  });

  it('replays non-empty captured stderr regardless of exit code (except TOCTOU clean exit)', () => {
    expect(script).toContain('if [ -s "$launch_stderr" ]; then');
    expect(script).toContain('cat "$launch_stderr" >&2');

    const toctouIndex = script.indexOf('Input file disappeared during launch, treating turn as complete');
    const replayIndex = script.indexOf('if [ -s "$launch_stderr" ]; then');

    expect(toctouIndex).toBeGreaterThan(-1);
    expect(replayIndex).toBeGreaterThan(-1);
    expect(toctouIndex).toBeLessThan(replayIndex);
  });

  it('logs exit code and applies restart budget', () => {
    expect(script).toContain('Node exited with code $EXIT_CODE');
    expect(script).toContain('check_restart_budget');
  });
});
