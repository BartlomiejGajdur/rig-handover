import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, ReadNight, RunLine, RunStatus } from './types.js';

const STATUSES: readonly string[] = ['ok', 'retry', 'fail'] satisfies RunStatus[];

function isStatus(value: unknown): value is RunStatus {
  return typeof value === 'string' && STATUSES.includes(value);
}

// A line that is not valid JSON or misses at/job/status yields null.
function parseLine(text: string): RunLine | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.at !== 'string' || typeof obj.job !== 'string' || !isStatus(obj.status)) return null;
  const line: RunLine = {
    at: obj.at,
    job: obj.job,
    status: obj.status,
    owner: typeof obj.owner === 'string' ? obj.owner : null,
  };
  if (typeof obj.error === 'string') line.error = obj.error;
  return line;
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export const readNight: ReadNight = (runsDir, night) => {
  // Only YYYY-MM-DD names, so a route param can't escape runsDir.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) return null;
  const text = readText(join(runsDir, `${night}.jsonl`));
  if (text === null) return null;

  const rows = new Map<string, DigestRow>();
  let badLines = 0;
  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue;
    const line = parseLine(raw);
    if (line === null) {
      badLines++;
      continue;
    }
    const row = rows.get(line.job);
    if (row === undefined) {
      rows.set(line.job, {
        job: line.job,
        owner: line.owner,
        runs: 1,
        retries: line.status === 'retry' ? 1 : 0,
        lastStatus: line.status,
        lastError: line.error ?? null,
        firstAt: line.at,
        lastAt: line.at,
      });
      continue;
    }
    row.owner = line.owner;
    row.runs++;
    if (line.status === 'retry') row.retries++;
    row.lastStatus = line.status;
    if (line.error !== undefined) row.lastError = line.error;
    row.lastAt = line.at;
  }

  return {
    night,
    rows: [...rows.values()].sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0)),
    badLines,
  };
};
