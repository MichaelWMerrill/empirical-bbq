import { describe, it, expect } from 'vitest';
import { handleCreateCookLog, handlePatchCookLog, MAX_WRITES_PER_DAY } from '../server/cookLogHandler';
import type { CookLogEnv, D1Database, D1PreparedStatement, D1Result } from '../server/types';

/**
 * Minimal in-memory D1 fake covering only the query shapes the handlers
 * actually issue (INSERT/UPDATE on cook_sessions, the rate-limit COUNT).
 */
class FakeD1 implements D1Database {
  rows: Record<string, unknown>[] = [];

  prepare(query: string): D1PreparedStatement {
    return new FakeStatement(this, query);
  }
}

class FakeStatement implements D1PreparedStatement {
  private values: unknown[] = [];

  constructor(
    private db: FakeD1,
    private query: string,
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.values = values;
    return this;
  }

  async run(): Promise<D1Result> {
    if (this.query.startsWith('INSERT INTO cook_sessions')) {
      const columns = [
        'id',
        'anon_client_id',
        'protein_type',
        'model_version',
        'weight_lb',
        'weight_source',
        'cook_method',
        'target_pit_temp_f',
        'ambient_temp_f',
        'altitude_ft',
        'start_time',
        'predicted_cook_minutes',
        'consented_at',
        'created_at',
        'updated_at',
      ];
      const row: Record<string, unknown> = {};
      columns.forEach((col, i) => (row[col] = this.values[i]));
      this.db.rows.push(row);
      return { success: true, meta: { changes: 1 } };
    }

    if (this.query.startsWith('UPDATE cook_sessions')) {
      const setClause = this.query.match(/SET (.+) WHERE/)?.[1] ?? '';
      const fieldNames = setClause.split(', ').map((s) => s.split(' = ')[0]);
      const id = this.values[this.values.length - 2];
      const anonClientId = this.values[this.values.length - 1];
      const row = this.db.rows.find((r) => r.id === id && r.anon_client_id === anonClientId);
      if (!row) return { success: true, meta: { changes: 0 } };
      fieldNames.forEach((field, i) => (row[field] = this.values[i]));
      return { success: true, meta: { changes: 1 } };
    }

    throw new Error(`FakeD1: unhandled run() query: ${this.query}`);
  }

  async first<T = unknown>(): Promise<T | null> {
    if (this.query.startsWith('SELECT COUNT(*)')) {
      const [anonClientId, since] = this.values as [string, string];
      const cnt = this.db.rows.filter(
        (r) => r.anon_client_id === anonClientId && (r.created_at as string) >= since,
      ).length;
      return { cnt } as T;
    }
    throw new Error(`FakeD1: unhandled first() query: ${this.query}`);
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    throw new Error('FakeD1: all() not implemented');
  }
}

function makeEnv(): CookLogEnv {
  return { DB: new FakeD1() };
}

function postRequest(body: unknown): Request {
  return new Request('https://example.com/api/cook-logs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function patchRequest(id: string, body: unknown): Request {
  return new Request(`https://example.com/api/cook-logs/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validCreateBody = {
  anon_client_id: 'client-1',
  protein_type: 'beef_brisket',
  model_version: '2026.3',
  weight_lb: 12,
  weight_source: 'scale',
  predicted_cook_minutes: 600,
  consented_at: '2026-09-06T12:00:00.000Z',
};

describe('handleCreateCookLog', () => {
  it('creates a session on a valid request (happy path)', async () => {
    const env = makeEnv();
    const res = await handleCreateCookLog(postRequest(validCreateBody), env);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(typeof body.id).toBe('string');
    expect(body.id.length).toBeGreaterThan(0);
  });

  it('rejects a request missing consented_at', async () => {
    const env = makeEnv();
    const { consented_at, ...rest } = validCreateBody;
    const res = await handleCreateCookLog(postRequest(rest), env);
    expect(res.status).toBe(400);
  });

  it('rejects an unrecognized enum value', async () => {
    const env = makeEnv();
    const res = await handleCreateCookLog(
      postRequest({ ...validCreateBody, protein_type: 'wagyu_ribeye' }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('rejects a weight outside the protein-specific range', async () => {
    const env = makeEnv();
    // beef_brisket weight_bounds is 4-18 lb (proteinRegistry.js); 40 is well outside it.
    const res = await handleCreateCookLog(postRequest({ ...validCreateBody, weight_lb: 40 }), env);
    expect(res.status).toBe(400);
  });

  it('rate limits after MAX_WRITES_PER_DAY writes from the same anon_client_id', async () => {
    const env = makeEnv();
    for (let i = 0; i < MAX_WRITES_PER_DAY; i++) {
      const res = await handleCreateCookLog(postRequest(validCreateBody), env);
      expect(res.status).toBe(201);
    }
    const res = await handleCreateCookLog(postRequest(validCreateBody), env);
    expect(res.status).toBe(429);
  });
});

describe('handlePatchCookLog', () => {
  it('updates a session on a valid request (happy path)', async () => {
    const env = makeEnv();
    const createRes = await handleCreateCookLog(postRequest(validCreateBody), env);
    const { id } = (await createRes.json()) as { id: string };

    const patchRes = await handlePatchCookLog(
      patchRequest(id, {
        anon_client_id: 'client-1',
        wrap_time: '2026-09-06T15:00:00.000Z',
        wrap_method: 'foil',
        final_internal_temp_f: 203,
      }),
      env,
      id,
    );

    expect(patchRes.status).toBe(200);
    const row = (env.DB as FakeD1).rows.find((r) => r.id === id)!;
    expect(row.wrap_method).toBe('foil');
    expect(row.final_internal_temp_f).toBe(203);
  });

  it('returns 404 when the id does not belong to the requesting anon_client_id', async () => {
    const env = makeEnv();
    const createRes = await handleCreateCookLog(postRequest(validCreateBody), env);
    const { id } = (await createRes.json()) as { id: string };

    const patchRes = await handlePatchCookLog(
      patchRequest(id, { anon_client_id: 'someone-else', wrap_method: 'foil' }),
      env,
      id,
    );
    expect(patchRes.status).toBe(404);
  });

  it('returns 404 for an id that does not exist', async () => {
    const env = makeEnv();
    const patchRes = await handlePatchCookLog(
      patchRequest('does-not-exist', { anon_client_id: 'client-1', wrap_method: 'foil' }),
      env,
      'does-not-exist',
    );
    expect(patchRes.status).toBe(404);
  });
});
