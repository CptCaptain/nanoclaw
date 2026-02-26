import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { copyFileIfSourceNewer, syncAgentWorkSkills } from './container-runner.js';

describe('copyFileIfSourceNewer', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-sync-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('copies when source and target mtimes are equal but content differs', () => {
    const source = path.join(tmpDir, 'source.json');
    const target = path.join(tmpDir, 'target.json');

    fs.writeFileSync(source, '{"quota":2}');
    fs.writeFileSync(target, '{"quota":1}');

    const ts = new Date('2026-01-01T00:00:00.000Z');
    fs.utimesSync(source, ts, ts);
    fs.utimesSync(target, ts, ts);

    const copied = copyFileIfSourceNewer(source, target);

    expect(copied).toBe(true);
    expect(fs.readFileSync(target, 'utf-8')).toBe('{"quota":2}');
  });

  it('preserves source mtime on copied files', () => {
    const source = path.join(tmpDir, 'source.json');
    const target = path.join(tmpDir, 'nested', 'target.json');

    fs.writeFileSync(source, '{"quota":3}');
    const sourceTime = new Date('2026-01-02T12:34:56.789Z');
    fs.utimesSync(source, sourceTime, sourceTime);

    const copied = copyFileIfSourceNewer(source, target);

    expect(copied).toBe(true);
    const sourceStat = fs.statSync(source);
    const targetStat = fs.statSync(target);
    expect(Math.abs(targetStat.mtimeMs - sourceStat.mtimeMs)).toBeLessThan(1);
  });
});

describe('syncAgentWorkSkills', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-agentwork-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('copies skills from agentWorkSkillsDir into destSkillsDir', () => {
    const agentWorkSkillsDir = path.join(tmpDir, 'agent-work', 'skills');
    const destSkillsDir = path.join(tmpDir, 'dest-skills');

    fs.mkdirSync(path.join(agentWorkSkillsDir, 'my-custom-skill'), { recursive: true });
    fs.writeFileSync(path.join(agentWorkSkillsDir, 'my-custom-skill', 'SKILL.md'), '# Custom');

    syncAgentWorkSkills(agentWorkSkillsDir, destSkillsDir);

    expect(fs.existsSync(path.join(destSkillsDir, 'my-custom-skill', 'SKILL.md'))).toBe(true);
  });

  it('does nothing if agentWorkSkillsDir does not exist', () => {
    const agentWorkSkillsDir = path.join(tmpDir, 'nonexistent');
    const destSkillsDir = path.join(tmpDir, 'dest-skills');

    expect(() => syncAgentWorkSkills(agentWorkSkillsDir, destSkillsDir)).not.toThrow();
  });

  it('agent-work skills overwrite built-in skills with the same name', () => {
    const agentWorkSkillsDir = path.join(tmpDir, 'agent-work', 'skills');
    const destSkillsDir = path.join(tmpDir, 'dest-skills');

    // Pre-populate dest with a built-in skill
    fs.mkdirSync(path.join(destSkillsDir, 'my-skill'), { recursive: true });
    fs.writeFileSync(path.join(destSkillsDir, 'my-skill', 'SKILL.md'), '# Built-in');

    // agent-work has an override
    fs.mkdirSync(path.join(agentWorkSkillsDir, 'my-skill'), { recursive: true });
    fs.writeFileSync(path.join(agentWorkSkillsDir, 'my-skill', 'SKILL.md'), '# Override');

    syncAgentWorkSkills(agentWorkSkillsDir, destSkillsDir);

    expect(fs.readFileSync(path.join(destSkillsDir, 'my-skill', 'SKILL.md'), 'utf-8')).toBe('# Override');
  });
});
