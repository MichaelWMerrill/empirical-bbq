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
        'ambient_temp_min_f',
        'ambient_temp_max_f',
        'ambient_temp_avg_f',
        'dew_point_avg_f',
        'wind_avg_mph',
        'wind_gust_max_mph',
        'weather_hours_missing',
        'weather_source',
        'cut',
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

describe('weather fields and cut (create)', () => {
  const rowOf = (env: CookLogEnv) => (env.DB as FakeD1).rows[0];
  const manualWeather = {
    weather_source: 'manual',
    ambient_temp_min_f: 38,
    ambient_temp_max_f: 62,
    ambient_temp_avg_f: 50,
    wind_avg_mph: 8,
  };

  it('stores manual weather and the source, leaving the NWS-only columns null', async () => {
    const env = makeEnv();
    const res = await handleCreateCookLog(postRequest({ ...validCreateBody, altitude_ft: 5200, ...manualWeather }), env);
    expect(res.status).toBe(201);
    expect(rowOf(env)).toMatchObject({ ...manualWeather, altitude_ft: 5200, dew_point_avg_f: null, wind_gust_max_mph: null, weather_hours_missing: null });
  });

  it('keeps ambient_temp_f as a typed point value, separate from ambient_temp_avg_f', async () => {
    const env = makeEnv();
    await handleCreateCookLog(postRequest({ ...validCreateBody, ambient_temp_f: 71, weather_source: 'typed' }), env);
    expect(rowOf(env)).toMatchObject({ ambient_temp_f: 71, ambient_temp_avg_f: null, weather_source: 'typed' });
  });

  it('accepts a request with none of the new fields (older clients and queued requests)', async () => {
    const env = makeEnv();
    expect((await handleCreateCookLog(postRequest(validCreateBody), env)).status).toBe(201);
    expect(rowOf(env)).toMatchObject({ weather_source: null, cut: null, ambient_temp_avg_f: null });
  });

  it.each([
    ['ambient_temp_f', -41],
    ['ambient_temp_f', 131],
    ['ambient_temp_min_f', 200],
    ['ambient_temp_avg_f', -90.5],
    ['altitude_ft', -301],
    ['altitude_ft', 14501],
    ['wind_avg_mph', -1],
    ['wind_gust_max_mph', 151],
    ['dew_point_avg_f', 101],
    ['weather_hours_missing', 73],
  ])('rejects %s = %s as out of range', async (field, value) => {
    const res = await handleCreateCookLog(postRequest({ ...validCreateBody, [field]: value }), makeEnv());
    expect(res.status).toBe(400);
  });

  it('accepts the range boundaries', async () => {
    const res = await handleCreateCookLog(
      postRequest({ ...validCreateBody, ambient_temp_f: -40, altitude_ft: 14500, wind_avg_mph: 0, wind_gust_max_mph: 150 }),
      makeEnv(),
    );
    expect(res.status).toBe(201);
  });

  it('rejects a low above the high', async () => {
    const res = await handleCreateCookLog(postRequest({ ...validCreateBody, ambient_temp_min_f: 70, ambient_temp_max_f: 60 }), makeEnv());
    expect(res.status).toBe(400);
  });

  it('rejects a non-integer for an integer field and an unknown weather_source', async () => {
    expect((await handleCreateCookLog(postRequest({ ...validCreateBody, ambient_temp_min_f: 40.5 }), makeEnv())).status).toBe(400);
    expect((await handleCreateCookLog(postRequest({ ...validCreateBody, weather_source: 'station' }), makeEnv())).status).toBe(400);
  });

  it('accepts a cut that belongs to the protein and stores it', async () => {
    const env = makeEnv();
    const res = await handleCreateCookLog(postRequest({ ...validCreateBody, protein_type: 'pork_ribs', weight_lb: 3, cut: 'st_louis' }), env);
    expect(res.status).toBe(201);
    expect(rowOf(env).cut).toBe('st_louis');
  });

  it("rejects another protein's cut, an unknown cut, and any cut for brisket or turkey", async () => {
    const shoulder = { ...validCreateBody, protein_type: 'pork_shoulder', weight_lb: 8 };
    expect((await handleCreateCookLog(postRequest({ ...shoulder, cut: 'spare' }), makeEnv())).status).toBe(400);
    expect((await handleCreateCookLog(postRequest({ ...shoulder, cut: 'butt' }), makeEnv())).status).toBe(400);
    expect((await handleCreateCookLog(postRequest({ ...validCreateBody, cut: 'boneless' }), makeEnv())).status).toBe(400);
    expect((await handleCreateCookLog(postRequest({ ...validCreateBody, protein_type: 'turkey', weight_lb: 14, cut: 'bone_in' }), makeEnv())).status).toBe(400);
  });
});

describe('weather range checks (patch)', () => {
  it('range-checks ambient_temp_f and altitude_ft on update, and still accepts valid values', async () => {
    const env = makeEnv();
    const created = (await (await handleCreateCookLog(postRequest(validCreateBody), env)).json()) as { id: string };
    const patch = (body: unknown) => handlePatchCookLog(patchRequest(created.id, { anon_client_id: 'client-1', ...(body as object) }), env, created.id);
    expect((await patch({ ambient_temp_f: 500 })).status).toBe(400);
    expect((await patch({ altitude_ft: 99999 })).status).toBe(400);
    expect((await patch({ ambient_temp_f: 68, altitude_ft: 5200 })).status).toBe(200);
  });

  it('does not accept the new weather fields or cut on update (set at cook start only)', async () => {
    const env = makeEnv();
    const created = (await (await handleCreateCookLog(postRequest(validCreateBody), env)).json()) as { id: string };
    const res = await handlePatchCookLog(
      patchRequest(created.id, { anon_client_id: 'client-1', weather_source: 'manual', cut: 'spare', finish_time: '2026-09-06T20:00:00.000Z' }),
      env,
      created.id,
    );
    expect(res.status).toBe(200);
    const row = (env.DB as FakeD1).rows[0];
    expect(row.weather_source).toBeNull();
    expect(row.cut).toBeNull();
    expect(row.finish_time).toBe('2026-09-06T20:00:00.000Z');
  });
});
