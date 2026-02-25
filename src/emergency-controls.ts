export type EmergencyAction = 'stop' | 'resume' | 'abort' | 'diagnose';

export function parseEmergencyCommand(
  content: string,
  triggerPattern: RegExp,
): { action: EmergencyAction; raw: string } | null {
  let text = content.trim();
  if (triggerPattern.test(text)) {
    text = text.replace(triggerPattern, '').trim();
  }
  if (!text.startsWith('/')) {
    return null;
  }

  const [cmd] = text.split(/\s+/, 1);
  const normalized = cmd.toLowerCase();

  if (normalized === '/stop') {
    return { action: 'stop', raw: text };
  }
  if (normalized === '/resume') {
    return { action: 'resume', raw: text };
  }
  if (normalized === '/abort' || normalized === '/clear') {
    return { action: 'abort', raw: text };
  }
  if (normalized === '/diagnose') {
    return { action: 'diagnose', raw: text };
  }

  return null;
}
