import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const JOBS_2810 = ['digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs'];

let runsDir: string;
let config: { adapter: string; installed: string; beatEverySeconds: number; runsDir: string };

// Temp copy, so runs/ stays read-only and the nights below are fully known.
beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-'));
  writeFileSync(join(runsDir, '2026-10-28.jsonl'), readFileSync('runs/2026-10-28.jsonl', 'utf8'));
  writeFileSync(join(runsDir, '2026-10-30.jsonl'), '');
  writeFileSync(
    join(runsDir, '2026-10-31.jsonl'),
    [
      '{"at":"2026-10-31T01:00:00+01:00","job":"a/x","status":"retry","owner":"rook","error":"boom"}',
      '{"at":"2026-10-31T01:05:00+01:00","job":"a/x","status":"ok","owner":"rook"}',
      '{not json',
      '',
    ].join('\n'),
  );
  config = {
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir,
  };
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

describe('digest page', () => {
  it('lists every job of 2026-10-28 and renders a missing owner as a dash', async () => {
    const res = await createApp(config).request('/digest/2026-10-28');
    const html = await res.text();
    expect(res.status).toBe(200);
    for (const job of JOBS_2810) expect(html).toContain(job);
    expect(html).toContain('—');
  });

  it('lists the jobs in the same order as the JSON', async () => {
    const res = await createApp(config).request('/digest/2026-10-28');
    const html = await res.text();
    const positions = JOBS_2810.map((job) => html.indexOf(job));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('returns 404 for a night with no file', async () => {
    const res = await createApp(config).request('/digest/2000-01-01');
    expect(res.status).toBe(404);
  });

  it('says nothing ran for an empty night', async () => {
    const res = await createApp(config).request('/digest/2026-10-30');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('shows the job of a night with a bad line', async () => {
    const res = await createApp(config).request('/digest/2026-10-31');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('a/x');
  });
});

describe('digest JSON', () => {
  it('returns the rows of 2026-10-28 sorted by job, with one bad line', async () => {
    const res = await createApp(config).request('/api/digest/2026-10-28');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: { job: string }[]; badLines: number };
    expect(body.rows.map((r) => r.job)).toEqual(JOBS_2810);
    expect(body.badLines).toBe(1);
  });

  it('returns 404 for a night with no file', async () => {
    const res = await createApp(config).request('/api/digest/2000-01-01');
    expect(res.status).toBe(404);
  });

  it('returns no rows for an empty night', async () => {
    const res = await createApp(config).request('/api/digest/2026-10-30');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: unknown[]; badLines: number };
    expect(body.rows).toHaveLength(0);
    expect(body.badLines).toBe(0);
  });

  it('counts the bad line and folds the retry into one row', async () => {
    const res = await createApp(config).request('/api/digest/2026-10-31');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows: { job: string; retries: number; lastStatus: string; lastError: string | null }[];
      badLines: number;
    };
    expect(body.badLines).toBe(1);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({ job: 'a/x', retries: 1, lastStatus: 'ok', lastError: 'boom' });
  });
});
