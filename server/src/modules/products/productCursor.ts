import mongoose from 'mongoose';
import { z } from 'zod';
import { AppError } from '../../middleware/error.middleware';

export type CatalogSortMode =
  | 'popular'
  | 'newest'
  | 'trending'
  | 'rating'
  | 'price_asc'
  | 'price_desc';

export interface CursorFieldDef {
  field: string;
  dir: 1 | -1;
  type: 'number' | 'date' | 'objectId';
}

export const SORT_MODE_FIELDS: Record<CatalogSortMode, CursorFieldDef[]> = {
  popular: [
    { field: 'soldCount', dir: -1, type: 'number' },
    { field: 'createdAt', dir: -1, type: 'date' },
    { field: '_id', dir: -1, type: 'objectId' },
  ],
  newest: [
    { field: 'createdAt', dir: -1, type: 'date' },
    { field: '_id', dir: -1, type: 'objectId' },
  ],
  trending: [
    { field: 'soldCount', dir: -1, type: 'number' },
    { field: 'ratingAverage', dir: -1, type: 'number' },
    { field: 'updatedAt', dir: -1, type: 'date' },
    { field: '_id', dir: -1, type: 'objectId' },
  ],
  rating: [
    { field: 'ratingAverage', dir: -1, type: 'number' },
    { field: 'reviewCount', dir: -1, type: 'number' },
    { field: 'soldCount', dir: -1, type: 'number' },
    { field: '_id', dir: -1, type: 'objectId' },
  ],
  price_asc: [
    { field: '_effectivePrice', dir: 1, type: 'number' },
    { field: 'createdAt', dir: -1, type: 'date' },
    { field: '_id', dir: -1, type: 'objectId' },
  ],
  price_desc: [
    { field: '_effectivePrice', dir: -1, type: 'number' },
    { field: 'createdAt', dir: -1, type: 'date' },
    { field: '_id', dir: -1, type: 'objectId' },
  ],
};

export function resolveCatalogSortMode(sort: string, section?: string): CatalogSortMode {
  const s = String(sort || '').trim().toLowerCase();
  const sec = String(section || '').trim().toLowerCase();
  if (s === 'newest' || s === 'latest' || sec === 'latest' || sec === 'new_arrivals') {
    return 'newest';
  }
  if (s === 'trending' || sec === 'trending') {
    return 'trending';
  }
  if (s === 'rating') {
    return 'rating';
  }
  if (s === 'price_asc') {
    return 'price_asc';
  }
  if (s === 'price_desc') {
    return 'price_desc';
  }
  return 'popular';
}

export function getDeterministicCatalogSortSpec(sort: string, section?: string): Record<string, 1 | -1> {
  const mode = resolveCatalogSortMode(sort, section);
  const spec: Record<string, 1 | -1> = {};
  for (const def of SORT_MODE_FIELDS[mode]) {
    spec[def.field] = def.dir;
  }
  return spec;
}

const cursorPayloadSchema = z.object({
  v: z.literal(1),
  mode: z.enum(['popular', 'newest', 'trending', 'rating', 'price_asc', 'price_desc']),
  vals: z.array(z.union([z.number().finite(), z.string().min(1).max(80)])).min(2).max(5),
});

export interface DecodedProductCursor {
  mode: CatalogSortMode;
  values: Array<number | Date | mongoose.Types.ObjectId | string>;
}

function serializeFieldValue(raw: unknown, type: CursorFieldDef['type']): number | string {
  if (type === 'number') {
    const num = Number(raw ?? 0);
    return Number.isFinite(num) ? num : 0;
  }
  if (type === 'date') {
    if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
      return raw.toISOString();
    }
    const parsed = raw ? new Date(String(raw)) : new Date(0);
    return Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString();
  }
  return String(raw ?? '');
}

export function encodeProductCursor(doc: Record<string, unknown>, mode: CatalogSortMode): string | null {
  const fields = SORT_MODE_FIELDS[mode];
  if (!doc || !doc._id) return null;

  const vals = fields.map((def) => {
    const raw = def.field === '_id' ? doc._id : doc[def.field];
    return serializeFieldValue(raw, def.type);
  });

  const json = JSON.stringify({ v: 1, mode, vals });
  return Buffer.from(json, 'utf8').toString('base64url');
}

export function decodeProductCursor(
  rawCursor: string,
  expectedMode: CatalogSortMode,
): DecodedProductCursor {
  const trimmed = String(rawCursor || '').trim();
  if (!trimmed || trimmed.length > 512) {
    throw new AppError(400, 'INVALID_CURSOR', 'Invalid pagination cursor.');
  }

  let parsedJson: unknown;
  try {
    const decoded = Buffer.from(trimmed, 'base64url').toString('utf8');
    parsedJson = JSON.parse(decoded);
  } catch {
    throw new AppError(400, 'INVALID_CURSOR', 'Malformed pagination cursor.');
  }

  const parsed = cursorPayloadSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new AppError(400, 'INVALID_CURSOR', 'Invalid pagination cursor structure.');
  }

  if (parsed.data.mode !== expectedMode) {
    throw new AppError(400, 'INVALID_CURSOR', 'Pagination cursor does not match active sort order.');
  }

  const fieldDefs = SORT_MODE_FIELDS[expectedMode];
  if (parsed.data.vals.length !== fieldDefs.length) {
    throw new AppError(400, 'INVALID_CURSOR', 'Pagination cursor field length mismatch.');
  }

  const typedValues = fieldDefs.map((def, idx) => {
    const rawVal = parsed.data.vals[idx];
    if (def.type === 'number') {
      if (typeof rawVal !== 'number' || !Number.isFinite(rawVal)) {
        throw new AppError(400, 'INVALID_CURSOR', 'Invalid numeric cursor value.');
      }
      return rawVal;
    }
    if (def.type === 'date') {
      const dt = new Date(String(rawVal));
      if (Number.isNaN(dt.getTime())) {
        throw new AppError(400, 'INVALID_CURSOR', 'Invalid timestamp cursor value.');
      }
      return dt;
    }
    const idStr = String(rawVal || '').trim();
    if (!idStr) {
      throw new AppError(400, 'INVALID_CURSOR', 'Invalid identifier cursor value.');
    }
    if (/^[a-f0-9]{24}$/i.test(idStr)) {
      return new mongoose.Types.ObjectId(idStr);
    }
    return idStr;
  });

  return {
    mode: expectedMode,
    values: typedValues,
  };
}

/**
 * Builds deterministic lexicographical keyset `$or` predicate for composite sort + `_id` tie-breaker.
 * Example for `(soldCount: -1, createdAt: -1, _id: -1)`:
 * $or: [
 *   { soldCount: { $lt: v0 } },
 *   { soldCount: v0, createdAt: { $lt: v1 } },
 *   { soldCount: v0, createdAt: v1, _id: { $lt: v2 } }
 * ]
 */
export function buildCursorKeysetFilter(cursor: DecodedProductCursor): Record<string, unknown> {
  const defs = SORT_MODE_FIELDS[cursor.mode];
  const branches: Array<Record<string, unknown>> = [];

  for (let i = 0; i < defs.length; i += 1) {
    const branch: Record<string, unknown> = {};
    for (let prev = 0; prev < i; prev += 1) {
      branch[defs[prev].field] = cursor.values[prev];
    }
    const currentDef = defs[i];
    const op = currentDef.dir === 1 ? '$gt' : '$lt';
    branch[currentDef.field] = { [op]: cursor.values[i] };
    branches.push(branch);
  }

  return { $or: branches };
}

function compareValues(a: unknown, b: unknown, type: CursorFieldDef['type'], dir: 1 | -1): number {
  let cmp = 0;
  if (type === 'number') {
    const na = Number(a ?? 0);
    const nb = Number(b ?? 0);
    cmp = na === nb ? 0 : na < nb ? -1 : 1;
  } else if (type === 'date') {
    const da = a instanceof Date ? a.getTime() : new Date(String(a ?? 0)).getTime();
    const db = b instanceof Date ? b.getTime() : new Date(String(b ?? 0)).getTime();
    cmp = da === db ? 0 : da < db ? -1 : 1;
  } else {
    const sa = String(a ?? '');
    const sb = String(b ?? '');
    cmp = sa === sb ? 0 : sa < sb ? -1 : 1;
  }
  return cmp * dir;
}

/**
 * Pure deterministic in-memory cursor evaluator used for unit-testing cursor semantics
 * identically to Mongo keyset queries over arbitrarily large datasets (5..100,000+ records).
 */
export function queryInMemoryCursorPage<T extends Record<string, unknown>>(params: {
  records: T[];
  sort: string;
  section?: string;
  cursor?: string | null;
  limit: number;
}): {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number;
} {
  const mode = resolveCatalogSortMode(params.sort, params.section);
  const defs = SORT_MODE_FIELDS[mode];
  const safeLimit = Math.min(100, Math.max(1, Math.floor(params.limit || 16)));

  const sorted = [...params.records].sort((a, b) => {
    for (const def of defs) {
      const av = def.field === '_id' ? a._id : a[def.field];
      const bv = def.field === '_id' ? b._id : b[def.field];
      const c = compareValues(av, bv, def.type, def.dir);
      if (c !== 0) return c;
    }
    return 0;
  });

  let startIdx = 0;
  if (params.cursor) {
    const decoded = decodeProductCursor(params.cursor, mode);
    startIdx = sorted.findIndex((item) => {
      for (let i = 0; i < defs.length; i += 1) {
        const def = defs[i];
        const iv = def.field === '_id' ? item._id : item[def.field];
        const cv = decoded.values[i];
        const cmp = compareValues(iv, cv, def.type, def.dir);
        if (cmp > 0) return true;
        if (cmp < 0) return false;
      }
      return false;
    });
    if (startIdx === -1) {
      return {
        items: [],
        nextCursor: null,
        hasMore: false,
        total: sorted.length,
      };
    }
  }

  const slicedPlusOne = sorted.slice(startIdx, startIdx + safeLimit + 1);
  const hasMore = slicedPlusOne.length > safeLimit;
  const items = hasMore ? slicedPlusOne.slice(0, safeLimit) : slicedPlusOne;
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? encodeProductCursor(last, mode) : null;

  return {
    items,
    nextCursor,
    hasMore,
    total: sorted.length,
  };
}
