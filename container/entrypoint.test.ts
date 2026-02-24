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

  it('launches node with stdin redirection and captures stderr', () => {
    expect(script).toContain('node /tmp/dist/index.js < /tmp/input.json');
    expect(script).toContain('2>"$launch_stderr"');
  });

  it('handles input disappearing during launch as clean completion', () => {
    expect(script).toContain('if [ "$EXIT_CODE" -ne 0 ]; then');
    expect(script).toContain('Input file disappeared during launch, treating turn as complete');
    expect(script).toContain('if [ ! -f /tmp/input.json ]; then');
  });

  it('replays stderr, logs exit code, and applies restart budget', () => {
    expect(script).toContain('cat "$launch_stderr" >&2');
    expect(script).toContain('Node exited with code $EXIT_CODE');
    expect(script).toContain('check_restart_budget');
  });
});
