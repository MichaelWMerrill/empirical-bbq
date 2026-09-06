/*
 * cook-log-service request handlers.
 *
 * POST /api/cook-logs        create a session at cook start
 * PATCH /api/cook-logs/:id   update a session as the cook progresses
 *
 * No read endpoint — aggregation runs separately (scripts/cook-log-report.mjs),
 * not as a public API. Logs never include request bodies (may carry cook
 * details); only status codes and error types are logged.
 */
import type { CookLogEnv } from './types';
import { validateCreateBody, validatePatchBody } from './validation';

/** Default per-anon_client_id write budget. Adjust here if 20/day proves too tight or too loose. */
export const MAX_WRITES_PER_DAY = 20;
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
    },
  });

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

async function isRateLimited(env: CookLogEnv, anonClientId: string): Promise<boolean> {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const row = await env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM cook_sessions WHERE anon_client_id = ? AND created_at >= ?',
  )
    .bind(anonClientId, since)
    .first<{ cnt: number }>();
  return (row?.cnt ?? 0) >= MAX_WRITES_PER_DAY;
}

export async function handleCreateCookLog(request: Request, env: CookLogEnv): Promise<Response> {
  const body = await parseJsonBody(request);
  if (body === undefined) return json({ ok: false, error: 'Invalid JSON body.' }, 400);

  const validated = validateCreateBody(body);
  if (!validated.ok) return json({ ok: false, error: validated.error }, 400);
  const data = validated.data;

  if (await isRateLimited(env, data.anon_client_id)) {
    return json({ ok: false, error: 'Rate limit exceeded. Try again tomorrow.' }, 429);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  try {
    await env.DB.prepare(
      `INSERT INTO cook_sessions (
        id, anon_client_id, protein_type, model_version, weight_lb, weight_source,
        cook_method, target_pit_temp_f, ambient_temp_f, altitude_ft, start_time,
        predicted_cook_minutes, consented_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        data.anon_client_id,
        data.protein_type,
        data.model_version,
        data.weight_lb,
        data.weight_source,
        data.cook_method,
        data.target_pit_temp_f,
        data.ambient_temp_f,
        data.altitude_ft,
        data.start_time,
        data.predicted_cook_minutes,
        data.consented_at,
        now,
        now,
      )
      .run();
  } catch (err) {
    console.error('cook-log create failed', err instanceof Error ? err.name : 'unknown');
    return json({ ok: false, error: 'Failed to create cook session.' }, 500);
  }

  return json({ id }, 201);
}

export async function handlePatchCookLog(request: Request, env: CookLogEnv, id: string): Promise<Response> {
  const body = await parseJsonBody(request);
  if (body === undefined) return json({ ok: false, error: 'Invalid JSON body.' }, 400);

  const validated = validatePatchBody(body);
  if (!validated.ok) return json({ ok: false, error: validated.error }, 400);
  const data = validated.data;

  const fieldNames = [
    'cook_method',
    'target_pit_temp_f',
    'ambient_temp_f',
    'altitude_ft',
    'wrap_time',
    'wrap_method',
    'stall_start_time',
    'stall_end_time',
    'finish_time',
    'final_internal_temp_f',
    'rest_minutes',
  ] as const;

  const setFields = fieldNames.filter((f) => f in data);
  const now = new Date().toISOString();

  const setClause = [...setFields.map((f) => `${f} = ?`), 'updated_at = ?'].join(', ');
  const values = [...setFields.map((f) => data[f] ?? null), now, id, data.anon_client_id];

  let result;
  try {
    result = await env.DB.prepare(
      `UPDATE cook_sessions SET ${setClause} WHERE id = ? AND anon_client_id = ?`,
    )
      .bind(...values)
      .run();
  } catch (err) {
    console.error('cook-log patch failed', err instanceof Error ? err.name : 'unknown');
    return json({ ok: false, error: 'Failed to update cook session.' }, 500);
  }

  const changes = (result.meta as { changes?: number }).changes ?? 0;
  if (changes === 0) {
    return json({ ok: false, error: 'Cook session not found.' }, 404);
  }

  return json({ ok: true });
}
