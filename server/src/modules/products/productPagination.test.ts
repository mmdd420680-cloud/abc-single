import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
  buildCursorKeysetFilter,
  decodeProductCursor,
  encodeProductCursor,
  queryInMemoryCursorPage,
  resolveCatalogSortMode,
} from './productCursor';

function makeSyntheticProducts(count: number) {
  const baseTime = new Date('2026-01-01T00:00:00.000Z').getTime();
  return Array.from({ length: count }, (_, idx) => {
    const idHex = idx.toString(16).padStart(24, '0');
    return {
      _id: idHex,
      id: idHex,
      name: `Product ${idx}`,
      // Deliberate ties on soldCount & createdAt to verify _id deterministic tie-breaking
      soldCount: Math.floor(idx / 5),
      ratingAverage: (idx % 5) + 0.5,
      reviewCount: idx % 17,
      _effectivePrice: 500 + (idx % 50) * 100,
      createdAt: new Date(baseTime + Math.floor(idx / 3) * 60_000),
      updatedAt: new Date(baseTime + Math.floor(idx / 2) * 60_000),
    };
  });
}

describe('productCursor pagination', () => {
  it('encodes and decodes opaque cursors safely and rejects tampered/mismatched cursors', () => {
    const id = new mongoose.Types.ObjectId();
    const cursor = encodeProductCursor(
      {
        _id: id,
        soldCount: 42,
        createdAt: new Date('2026-05-01T10:00:00.000Z'),
      },
      'popular',
    );
    assert.ok(cursor);

    const decoded = decodeProductCursor(cursor!, 'popular');
    assert.equal(decoded.mode, 'popular');
    assert.equal(decoded.values[0], 42);
    assert.ok(decoded.values[1] instanceof Date);
    assert.equal(String(decoded.values[2]), String(id));

    assert.throws(() => decodeProductCursor('not-valid-base64-json', 'popular'), /INVALID_CURSOR|Malformed|Invalid/);
    assert.throws(() => decodeProductCursor(cursor!, 'price_asc'), /sort order/);
  });

  it('builds valid MongoDB composite keyset $or filters including ascending price', () => {
    const id = new mongoose.Types.ObjectId();
    const cursor = encodeProductCursor(
      {
        _id: id,
        _effectivePrice: 1299,
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
      },
      'price_asc',
    );
    const decoded = decodeProductCursor(cursor!, 'price_asc');
    const filter = buildCursorKeysetFilter(decoded) as { $or: Array<Record<string, unknown>> };

    assert.equal(filter.$or.length, 3);
    assert.deepEqual(filter.$or[0], { _effectivePrice: { $gt: 1299 } });
    assert.equal(filter.$or[1]._effectivePrice, 1299);
    assert.ok('$lt' in (filter.$or[1].createdAt as Record<string, unknown>));
    assert.equal(String((filter.$or[2]._id as { $lt: unknown }).$lt), String(id));
  });

  it('returns exact catalog size for small 5-product catalogs with hasMore=false and no fake padding', () => {
    const five = makeSyntheticProducts(5);
    const page1 = queryInMemoryCursorPage({
      records: five,
      sort: 'popular',
      limit: 100,
    });
    assert.equal(page1.items.length, 5);
    assert.equal(page1.hasMore, false);
    assert.equal(page1.nextCursor, null);
    assert.equal(page1.total, 5);
  });

  it('traverses 250-product catalog cleanly across 100 -> 20 -> ... -> 200 session batches with zero duplicates', () => {
    type SyntheticProduct = ReturnType<typeof makeSyntheticProducts>[number];
    const catalog = makeSyntheticProducts(250);
    const collectedIds: string[] = [];

    const initial = queryInMemoryCursorPage<SyntheticProduct>({
      records: catalog,
      sort: 'popular',
      limit: 100,
    });
    assert.equal(initial.items.length, 100);
    assert.equal(initial.hasMore, true);
    assert.ok(initial.nextCursor);
    collectedIds.push(...initial.items.map((i) => i.id));

    let cursor: string | null = initial.nextCursor;
    for (let step = 0; step < 5; step += 1) {
      const next: ReturnType<typeof queryInMemoryCursorPage<SyntheticProduct>> = queryInMemoryCursorPage<SyntheticProduct>({
        records: catalog,
        sort: 'popular',
        cursor,
        limit: 20,
      });
      assert.equal(next.items.length, 20);
      assert.equal(next.hasMore, true);
      collectedIds.push(...next.items.map((i) => i.id));
      cursor = next.nextCursor;
    }

    // Reached 200 products cleanly with zero overlap and deterministic ordering across tied values
    assert.equal(collectedIds.length, 200);
    assert.equal(new Set(collectedIds).size, 200);
  });

  it('handles 100,000-record catalogs without duplicates across every supported sort mode', () => {
    const largeCatalog = makeSyntheticProducts(100_000);
    const sortModes = ['popular', 'newest', 'trending', 'rating', 'price_asc', 'price_desc'] as const;

    for (const sort of sortModes) {
      const start = performance.now();
      const first100 = queryInMemoryCursorPage({
        records: largeCatalog,
        sort: resolveCatalogSortMode(sort),
        limit: 100,
      });
      const next20 = queryInMemoryCursorPage({
        records: largeCatalog,
        sort: resolveCatalogSortMode(sort),
        cursor: first100.nextCursor,
        limit: 20,
      });
      const elapsed = performance.now() - start;

      assert.equal(first100.items.length, 100);
      assert.equal(first100.hasMore, true);
      assert.equal(next20.items.length, 20);
      assert.equal(next20.hasMore, true);

      const ids = [...first100.items, ...next20.items].map((item) => item.id);
      assert.equal(new Set(ids).size, 120, `Duplicate item detected under sort=${sort}`);
      assert.ok(elapsed < 2500, `Sort ${sort} took unexpectedly long: ${elapsed.toFixed(1)}ms`);
    }
  });
});
