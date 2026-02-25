import { describe, expect, it } from 'vitest';
import { parseEmergencyCommand } from './emergency-controls.js';

describe('parseEmergencyCommand', () => {
  const trigger = /^@Klaus\b/i;

  it('parses /stop with and without trigger prefix', () => {
    expect(parseEmergencyCommand('/stop', trigger)?.action).toBe('stop');
    expect(parseEmergencyCommand('@Klaus /stop now', trigger)?.action).toBe('stop');
  });

  it('maps /clear to abort', () => {
    expect(parseEmergencyCommand('/clear', trigger)?.action).toBe('abort');
  });

  it('returns null for non-emergency commands', () => {
    expect(parseEmergencyCommand('/model show', trigger)).toBeNull();
  });
});
