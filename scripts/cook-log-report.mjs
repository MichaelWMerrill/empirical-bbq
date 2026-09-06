/*
 * Ad hoc read-side report for cook_sessions (cook-log-service's D1 database).
 *
 * Not run in CI, not wired into any build step, and does not write back to
 * anything — it only prints numbers for a human to look at before deciding
 * whether a calculator model needs recalibration (a manual, human-approved
 * step; this script never touches a model constant or a golden test).
 *
 * Usage:
 *   node scripts/cook-log-report.mjs           # local D1 (wrangler dev db)
 *   node scripts/cook-log-report.mjs --remote   # production D1
 *
 * Requires `wrangler` (run from the cook-log-service Worker's directory, so
 * it picks up that Worker's wrangler.jsonc and D1 binding).
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const WORKER_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'workers', 'cook-log-service');
const DATABASE_NAME = 'cook-log-db';

const remote = process.argv.includes('--remote');

const QUERY = `
  SELECT protein_type, model_version, predicted_cook_minutes, start_time, finish_time
  FROM cook_sessions
  WHERE finish_time IS NOT NULL
`;

function queryD1(sql) {
  const args = [
    'wrangler',
    'd1',
    'execute',
    DATABASE_NAME,
    remote ? '--remote' : '--local',
    '--json',
    `--command=${sql}`,
  ];
  const output = execFileSync('npx', args, { cwd: WORKER_DIR, encoding: 'utf8' });
  const parsed = JSON.parse(output);
  // `wrangler d1 execute --json` returns an array of { results, success, meta } per statement.
  return parsed[0]?.results ?? [];
}

function mean(values) {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function actualMinutes(row) {
  const started = Date.parse(row.start_time);
  const finished = Date.parse(row.finish_time);
  if (Number.isNaN(started) || Number.isNaN(finished) || finished <= started) return null;
  return (finished - started) / 60000;
}

function buildReport(rows) {
  const groups = new Map();
  for (const row of rows) {
    const actual = actualMinutes(row);
    if (actual === null) continue; // skip malformed/finished-before-started rows
    const key = `${row.protein_type} ${row.model_version}`;
    if (!groups.has(key)) groups.set(key, { protein_type: row.protein_type, model_version: row.model_version, predicted: [], actual: [] });
    const group = groups.get(key);
    group.predicted.push(row.predicted_cook_minutes);
    group.actual.push(actual);
  }

  return [...groups.values()]
    .map((g) => {
      const meanPredicted = mean(g.predicted);
      const meanActual = mean(g.actual);
      return {
        protein_type: g.protein_type,
        model_version: g.model_version,
        sessions: g.predicted.length,
        mean_predicted_min: Math.round(meanPredicted),
        median_predicted_min: Math.round(median(g.predicted)),
        mean_actual_min: Math.round(meanActual),
        median_actual_min: Math.round(median(g.actual)),
        mean_delta_pct: Number((((meanActual - meanPredicted) / meanPredicted) * 100).toFixed(1)),
      };
    })
    .sort((a, b) => a.protein_type.localeCompare(b.protein_type) || a.model_version.localeCompare(b.model_version));
}

const rows = queryD1(QUERY);
const report = buildReport(rows);

if (report.length === 0) {
  console.log(`No finished cook sessions found (${remote ? 'remote' : 'local'} database).`);
} else {
  console.table(report);
}
