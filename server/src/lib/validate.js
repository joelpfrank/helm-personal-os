import { errors } from './errors.js';

export function intParam(value, name) {
  if (value === '' || value == null) throw errors.validation(`${name} required`);
  const n = Number(value);
  if (!Number.isInteger(n)) throw errors.validation(`${name} must be an integer`);
  return n;
}

export function requireString(body, key) {
  const v = body?.[key];
  if (typeof v !== 'string' || !v.trim()) throw errors.validation(`${key} required`);
  return v.trim();
}

export function optionalString(body, key) {
  if (!(key in (body || {}))) return undefined;
  const v = body[key];
  if (v == null) return null;
  if (typeof v !== 'string') throw errors.validation(`${key} must be a string`);
  return v;
}

export function optionalNumber(body, key) {
  if (!(key in (body || {}))) return undefined;
  const v = body[key];
  if (v == null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw errors.validation(`${key} must be a number`);
  return v;
}

export function optionalInt(body, key) {
  if (!(key in (body || {}))) return undefined;
  const v = body[key];
  if (v == null) return null;
  if (!Number.isInteger(v)) throw errors.validation(`${key} must be an integer`);
  return v;
}

export function optionalIntArray(body, key) {
  if (!(key in (body || {}))) return undefined;
  const v = body[key];
  if (!Array.isArray(v)) throw errors.validation(`${key} must be an array`);
  for (const x of v) {
    if (!Number.isInteger(x)) throw errors.validation(`${key}[] entries must be integers`);
  }
  return v;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
export function optionalColor(body, key) {
  const v = optionalString(body, key);
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (!HEX.test(v)) throw errors.validation(`${key} must be #RRGGBB hex`);
  return v.toLowerCase();
}

const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
export function optionalDate(body, key) {
  const v = optionalString(body, key);
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (!ISO.test(v)) throw errors.validation(`${key} must be ISO 8601 (YYYY-MM-DD or full datetime)`);
  return v;
}

export function rejectUnknownKeys(body, allowed) {
  if (!body) return;
  for (const k of Object.keys(body)) {
    if (!allowed.includes(k)) throw errors.validation(`unknown field: ${k}`);
  }
}
