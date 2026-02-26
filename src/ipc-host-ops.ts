import { execFileSync } from 'child_process';
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
  for (const allowed of ALLOWED_COMMIT_PATHS) {
    if (allowed.endsWith('/')) {
      // Directory prefix: match the directory itself or anything inside it
      if (normalized === allowed.slice(0, -1) || normalized.startsWith(allowed)) return true;
    } else {
      // Exact file: only exact match
      if (normalized === allowed) return true;
    }
  }
  return false;
}

const PROTECTED_BRANCHES = new Set(['main', 'master']);

export async function handleGitPush(
  data: { branch: unknown },
  cwd: string = process.cwd(),
): Promise<HostOpResult> {
  const { branch } = data;

  if (typeof branch !== 'string' || !branch.trim()) {
    return { success: false, error: 'branch must be a non-empty string' };
  }
  if (PROTECTED_BRANCHES.has(branch.trim())) {
    return { success: false, error: `Cannot push to main/master branch via IPC. Use a feature branch.` };
  }

  try {
    const b = branch.trim();
    const output = execFileSync('git', ['push', 'origin', `HEAD:refs/heads/${b}`, '--set-upstream'], { cwd }).toString();
    logger.info({ branch: b }, 'IPC git_push succeeded');
    return { success: true, output };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.warn({ branch, error }, 'IPC git_push failed');
    return { success: false, error };
  }
}

export async function handleCreatePr(
  data: { title: unknown; body: unknown; branch: unknown; base: unknown },
  githubToken: string,
  githubRepo: string,
): Promise<HostOpResult> {
  if (!githubToken) return { success: false, error: 'GITHUB_TOKEN is not configured' };
  if (!githubRepo) return { success: false, error: 'GITHUB_REPO is not configured' };

  const { title, body, branch, base } = data;
  if (typeof title !== 'string' || !title.trim()) {
    return { success: false, error: 'title must be a non-empty string' };
  }
  if (typeof branch !== 'string' || !branch.trim()) {
    return { success: false, error: 'branch must be a non-empty string' };
  }
  const prBase = typeof base === 'string' && base.trim() ? base.trim() : 'main';

  try {
    const response = await fetch(`https://api.github.com/repos/${githubRepo}/pulls`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: title.trim(),
        body: typeof body === 'string' ? body : '',
        head: branch.trim(),
        base: prBase,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `GitHub API error ${response.status}: ${text}` };
    }

    const pr = await response.json() as { html_url: string; number: number };
    logger.info({ pr: pr.number, url: pr.html_url }, 'IPC create_pr succeeded');
    return { success: true, output: `PR #${pr.number}: ${pr.html_url}` };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.warn({ branch, error }, 'IPC create_pr failed');
    return { success: false, error };
  }
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
    try {
      execFileSync('git', ['add', '--', ...(paths as string[])], { cwd });
    } catch {
      // git add fails when pathspecs match no files; fall through to staged check
    }

    const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd }).toString().trim();
    if (!staged) {
      return { success: false, error: 'Nothing to commit — no changes staged in the specified paths.' };
    }

    const output = execFileSync('git', ['commit', '-m', message.trim()], { cwd }).toString();
    logger.info({ paths, message }, 'IPC git_commit succeeded');
    return { success: true, output };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.warn({ paths, message, error }, 'IPC git_commit failed');
    return { success: false, error };
  }
}

export interface DeployStep {
  name: string;
  file: string;
  args: string[];
}

interface DeployResult {
  success: boolean;
  steps?: Array<{ name: string; success: boolean; output?: string; error?: string }>;
  error?: string;
}

export async function handleDeployWithCommands(
  steps: DeployStep[],
  cwd: string,
): Promise<DeployResult> {
  const results: Array<{ name: string; success: boolean; output?: string; error?: string }> = [];

  for (const step of steps) {
    try {
      const output = execFileSync(step.file, step.args, { cwd, encoding: 'utf-8' });
      results.push({ name: step.name, success: true, output });
      logger.info({ step: step.name }, 'Deploy step succeeded');
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({ name: step.name, success: false, error });
      logger.error({ step: step.name, error }, 'Deploy step failed — aborting');
      return { success: false, steps: results };
    }
  }

  return { success: true, steps: results };
}

export async function handleDeploy(cwd: string = process.cwd()): Promise<DeployResult> {
  const steps: DeployStep[] = [
    { name: 'git_pull', file: 'git', args: ['pull', '--rebase', 'origin', 'main'] },
    { name: 'npm_install', file: 'npm', args: ['install'] },
    { name: 'migrations', file: 'echo', args: ['no migrations'] },
    { name: 'build', file: 'npm', args: ['run', 'build'] },
  ];

  const result = await handleDeployWithCommands(steps, cwd);

  if (result.success) {
    logger.info('Deploy pipeline succeeded — scheduling restart');
    setTimeout(() => process.exit(0), 500);
  }

  return result;
}
