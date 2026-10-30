import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';

const tmp = mkdtempSync(join(tmpdir(), 'rig-read-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('readNight on runs/2026-10-28.jsonl', () => {
  const night = readNight('runs', '2026-10-28');
  const row = (job: string) => night?.rows.find((r) => r.job === job);

  it('has 5 jobs sorted by job and 1 bad line', () => {
    expect(night?.badLines).toBe(1);
    expect(night?.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
  });

  it('counts retries and keeps the last status and error', () => {
    expect(row('fixtures/refresh')).toMatchObject({
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
    expect(row('notes/backup')).toMatchObject({ lastStatus: 'fail', lastError: 'quota exceeded', owner: 'lane-07' });
  });

  it('keeps a null owner and the log offset', () => {
    expect(row('digest/render')).toEqual({
      job: 'digest/render',
      owner: null,
      runs: 1,
      retries: 0,
      lastStatus: 'ok',
      lastError: null,
      firstAt: '2026-10-29T05:41:09+01:00',
      lastAt: '2026-10-29T05:41:09+01:00',
    });
  });
});

describe('readNight edge cases', () => {
  it('returns null for a night with no file', () => {
    expect(readNight(tmp, '2026-01-01')).toBeNull();
  });

  it('reads an empty file as no rows and no bad lines', () => {
    writeFileSync(join(tmp, '2026-01-02.jsonl'), '');
    expect(readNight(tmp, '2026-01-02')).toEqual({ night: '2026-01-02', rows: [], badLines: 0 });
  });

  it('counts lines missing fields or with an unknown status as bad', () => {
    const lines = [
      '{"at":"2026-01-03T01:00:00+01:00","job":"a","status":"ok","owner":"x"}',
      '{"job":"a","status":"ok","owner":"x"}',
      '{"at":"2026-01-03T02:00:00+01:00","job":"a","status":"done","owner":"x"}',
      '42',
      '',
      '   ',
    ];
    writeFileSync(join(tmp, '2026-01-03.jsonl'), lines.join('\n') + '\n');
    const night = readNight(tmp, '2026-01-03');
    expect(night?.badLines).toBe(3);
    expect(night?.rows).toHaveLength(1);
  });

  it('rejects a night name that is not a date', () => {
    expect(readNight('runs', '../runs/2026-10-28')).toBeNull();
  });
});
