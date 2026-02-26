import { execSync } from 'child_process';
import path from 'path';

import { logger } from './logger.js';

export const ALLOWED_COMMIT_PATHS = [
  'agent-work/',
  'container/skills/',
  'groups/main/CLAUDE.md',
];

export interface HostOpResult {
  success: boolean;
  output?: string;
  error?: string;
}

function isPathAllowed(filePath: string): boolean {
  const normalized = path.normalize(filePath);
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) return false;
  return ALLOWED_COMMIT_PATHS.some(
    (allowed) => normalized === allowed || normalized.startsWith(allowed),
  );
}

export async function handleGitCommit(
  data: { paths: unknown; message: unknown },
  cwd: string = process.cwd(),
): Promise<HostOpResult> {
  const { paths, message } = data;

  if (!Array.isArray(paths) || paths.length === 0) {
    return { success: false, error: 'paths must be a non-empty array' };
  }
  if (typeof message !== 'string' || !message.trim()) {
    return { success: false, error: 'message must be a non-empty string' };
  }

  for (const p of paths) {
    if (typeof p !== 'string' || !isPathAllowed(p)) {
      return {
        success: false,
        error: `Path not allowed: "${p}". Only agent-work/, container/skills/, and groups/main/CLAUDE.md may be committed via IPC.`,
      };
    }
  }

  try {
    const addArgs = paths.map((p) => `"${p}"`).join(' ');
    try {
      execSync(`git add ${addArgs}`, { cwd });
    } catch {
      // git add fails when pathspecs match no files; fall through to staged check
    }

    const staged = execSync('git diff --cached --name-only', { cwd }).toString().trim();
    if (!staged) {
      return { success: false, error: 'Nothing to commit — no changes staged in the specified paths.' };
    }

    const output = execSync(`git commit -m ${JSON.stringify(message.trim())}`, { cwd }).toString();
    logger.info({ paths, message }, 'IPC git_commit succeeded');
    return { success: true, output };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.warn({ paths, message, error }, 'IPC git_commit failed');
    return { success: false, error };
  }
}
