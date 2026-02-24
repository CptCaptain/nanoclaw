import { describe, expect, it } from 'vitest';
import fs from 'fs';

describe('container/entrypoint.sh', () => {
  const script = fs.readFileSync('container/entrypoint.sh', 'utf8');

  it('extracts restart budget check into a helper', () => {
    expect(script).toContain('check_restart_budget()');
    expect(script).toContain('check_restart_budget');
  });

  it('handles input disappearing during launch as clean completion', () => {
    expect(script).toContain('Input file disappeared during launch, treating turn as complete');
    expect(script).toContain('if [ ! -f /tmp/input.json ]; then');
  });
});
