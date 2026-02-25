import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { copyFileIfSourceNewer } from './container-runner.js';

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
