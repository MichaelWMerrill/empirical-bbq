/*
 * Validation for cook-log-service request bodies.
 *
 * Weight bounds come from ./weightBounds.ts — see that file for why they're
 * a kept-honest duplicate of PROTEINS[...].thermal.geometry.weight_bounds
 * rather than a direct import (this Worker's build can't reach outside its
 * own directory) and for the pork_ribs racks-not-pounds caveat.
 */
import { WEIGHT_BOUNDS } from './weightBounds';

export const PROTEIN_TYPES = ['beef_brisket', 'pork_shoulder', 'pork_ribs', 'turkey'] as const;
export const WEIGHT_SOURCES = ['scale', 'estimated'] as const;
export const COOK_METHODS = ['offset', 'pellet', 'kamado', 'oven', 'other'] as const;
export const WRAP_METHODS = ['unwrapped', 'foil', 'butcher_paper'] as const;

export type ProteinType = (typeof PROTEIN_TYPES)[number];
export type WeightSource = (typeof WEIGHT_SOURCES)[number];
export type CookMethod = (typeof COOK_METHODS)[number];
export type WrapMethod = (typeof WRAP_METHODS)[number];

export interface CreateCookSession {
  anon_client_id: string;
  protein_type: ProteinType;
  model_version: string;
  weight_lb: number;
  weight_source: WeightSource;
  predicted_cook_minutes: number;
  consented_at: string;
  start_time: string;
  cook_method: CookMethod | null;
  target_pit_temp_f: number | null;
  ambient_temp_f: number | null;
  altitude_ft: number | null;
}

export interface PatchCookSession {
  anon_client_id: string;
  cook_method?: CookMethod | null;
  target_pit_temp_f?: number | null;
  ambient_temp_f?: number | null;
  altitude_ft?: number | null;
  wrap_time?: string | null;
  wrap_method?: WrapMethod | null;
  stall_start_time?: string | null;
  stall_end_time?: string | null;
  finish_time?: string | null;
  final_internal_temp_f?: number | null;
  rest_minutes?: number | null;
}

export type ValidationResult<T> = { ok: true; data: T } | { ok: false; error: string };

const weightBoundsFor = (protein: ProteinType): { min: number; max: number } => WEIGHT_BOUNDS[protein];

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function optionalInt(body: Record<string, unknown>, field: string): ValidationResult<number | null> {
  const v = body[field];
  if (v === undefined || v === null) return { ok: true, data: null };
  if (!isFiniteNumber(v) || !Number.isInteger(v)) return { ok: false, error: `${field} must be an integer.` };
  return { ok: true, data: v };
}

function optionalEnum<T extends string>(
  body: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): ValidationResult<T | null> {
  const v = body[field];
  if (v === undefined || v === null) return { ok: true, data: null };
  if (typeof v !== 'string' || !allowed.includes(v as T)) {
    return { ok: false, error: `Unrecognized value for ${field}.` };
  }
  return { ok: true, data: v as T };
}

function optionalIsoString(body: Record<string, unknown>, field: string): ValidationResult<string | null> {
  const v = body[field];
  if (v === undefined || v === null) return { ok: true, data: null };
  if (!isNonEmptyString(v)) return { ok: false, error: `${field} must be an ISO 8601 string.` };
  return { ok: true, data: v };
}

export function validateCreateBody(body: unknown): ValidationResult<CreateCookSession> {
  if (typeof body !== 'object' || body === null) return { ok: false, error: 'Request body must be a JSON object.' };
  const b = body as Record<string, unknown>;

  if (!isNonEmptyString(b.anon_client_id)) return { ok: false, error: 'anon_client_id is required.' };
  if (!isNonEmptyString(b.consented_at)) return { ok: false, error: 'consented_at is required.' };
  if (!isNonEmptyString(b.model_version)) return { ok: false, error: 'model_version is required.' };

  if (typeof b.protein_type !== 'string' || !PROTEIN_TYPES.includes(b.protein_type as ProteinType)) {
    return { ok: false, error: 'Unrecognized value for protein_type.' };
  }
  const protein_type = b.protein_type as ProteinType;

  if (typeof b.weight_source !== 'string' || !WEIGHT_SOURCES.includes(b.weight_source as WeightSource)) {
    return { ok: false, error: 'Unrecognized value for weight_source.' };
  }
  const weight_source = b.weight_source as WeightSource;

  if (!isFiniteNumber(b.weight_lb)) return { ok: false, error: 'weight_lb must be a number.' };
  const { min, max } = weightBoundsFor(protein_type);
  if (b.weight_lb < min || b.weight_lb > max) {
    return { ok: false, error: `weight_lb must be between ${min} and ${max} for ${protein_type}.` };
  }

  if (!isFiniteNumber(b.predicted_cook_minutes) || !Number.isInteger(b.predicted_cook_minutes)) {
    return { ok: false, error: 'predicted_cook_minutes must be an integer.' };
  }

  const cookMethod = optionalEnum(b, 'cook_method', COOK_METHODS);
  if (!cookMethod.ok) return cookMethod;
  const targetPitTemp = optionalInt(b, 'target_pit_temp_f');
  if (!targetPitTemp.ok) return targetPitTemp;
  const ambientTemp = optionalInt(b, 'ambient_temp_f');
  if (!ambientTemp.ok) return ambientTemp;
  const altitude = optionalInt(b, 'altitude_ft');
  if (!altitude.ok) return altitude;
  const startTime = optionalIsoString(b, 'start_time');
  if (!startTime.ok) return startTime;

  return {
    ok: true,
    data: {
      anon_client_id: b.anon_client_id as string,
      protein_type,
      model_version: b.model_version as string,
      weight_lb: b.weight_lb as number,
      weight_source,
      predicted_cook_minutes: b.predicted_cook_minutes as number,
      consented_at: b.consented_at as string,
      start_time: startTime.data ?? new Date().toISOString(),
      cook_method: cookMethod.data,
      target_pit_temp_f: targetPitTemp.data,
      ambient_temp_f: ambientTemp.data,
      altitude_ft: altitude.data,
    },
  };
}

export function validatePatchBody(body: unknown): ValidationResult<PatchCookSession> {
  if (typeof body !== 'object' || body === null) return { ok: false, error: 'Request body must be a JSON object.' };
  const b = body as Record<string, unknown>;

  if (!isNonEmptyString(b.anon_client_id)) return { ok: false, error: 'anon_client_id is required.' };

  const data: PatchCookSession = { anon_client_id: b.anon_client_id as string };

  const cookMethod = optionalEnum(b, 'cook_method', COOK_METHODS);
  if (!cookMethod.ok) return cookMethod;
  if ('cook_method' in b) data.cook_method = cookMethod.data;

  const wrapMethod = optionalEnum(b, 'wrap_method', WRAP_METHODS);
  if (!wrapMethod.ok) return wrapMethod;
  if ('wrap_method' in b) data.wrap_method = wrapMethod.data;

  for (const field of ['target_pit_temp_f', 'ambient_temp_f', 'altitude_ft', 'final_internal_temp_f', 'rest_minutes'] as const) {
    const result = optionalInt(b, field);
    if (!result.ok) return result;
    if (field in b) data[field] = result.data;
  }

  for (const field of ['wrap_time', 'stall_start_time', 'stall_end_time', 'finish_time'] as const) {
    const result = optionalIsoString(b, field);
    if (!result.ok) return result;
    if (field in b) data[field] = result.data;
  }

  return { ok: true, data };
}
