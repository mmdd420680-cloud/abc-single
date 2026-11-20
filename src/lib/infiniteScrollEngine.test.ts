import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeNextBatchLimit,
  createInfiniteScrollConfig,
  createScrollSampleState,
  dedupeMergeProducts,
  evaluateScrollSample,
  isPointerNearScrollbar,
  shouldTriggerNextBatch,
} from './infiniteScrollEngine';

describe('infiniteScrollEngine', () => {
  it('follows 100 initial + 20 subsequent up to 200 session max by default', () => {
    const cfg = createInfiniteScrollConfig();
    assert.equal(computeNextBatchLimit(0, cfg), 100);
    assert.equal(computeNextBatchLimit(100, cfg), 20);
    assert.equal(computeNextBatchLimit(120, cfg), 20);
    assert.equal(computeNextBatchLimit(140, cfg), 20);
    assert.equal(computeNextBatchLimit(160, cfg), 20);
    assert.equal(computeNextBatchLimit(180, cfg), 20);
    assert.equal(computeNextBatchLimit(195, cfg), 5);
    assert.equal(computeNextBatchLimit(200, cfg), 0);
    assert.equal(computeNextBatchLimit(240, cfg), 0);
  });

  it('supports configurable initial batch size (e.g., 50)', () => {
    const cfg = createInfiniteScrollConfig({ initialBatchSize: 50 });
    assert.equal(computeNextBatchLimit(0, cfg), 50);
    assert.equal(computeNextBatchLimit(50, cfg), 20);
    assert.equal(computeNextBatchLimit(190, cfg), 10);
    assert.equal(computeNextBatchLimit(200, cfg), 0);
  });

  it('deduplicates repeated IDs and enforces 200-item view cap', () => {
    const batch1 = Array.from({ length: 100 }, (_, i) => ({ id: `p-${i}` }));
    const overlapping = [
      { id: 'p-98' },
      { id: 'p-99' },
      ...Array.from({ length: 20 }, (_, i) => ({ id: `p-${100 + i}` })),
    ];

    const merged = dedupeMergeProducts(batch1, overlapping, 200);
    assert.equal(merged.length, 120);
    assert.equal(new Set(merged.map((m) => m.id)).size, 120);

    const overflow = Array.from({ length: 120 }, (_, i) => ({ id: `p-${120 + i}` }));
    const capped = dedupeMergeProducts(merged, overflow, 200);
    assert.equal(capped.length, 200);
  });

  it('enforces single-flight concurrency, cap, error, and fast-scroll guards in shouldTriggerNextBatch', () => {
    const base = {
      isInitialLoading: false,
      isFetchingNext: false,
      hasMore: true,
      loadedCount: 100,
      sentinelIntersecting: true,
      isFastScrollSuppressed: false,
      hasNextBatchError: false,
    };

    assert.equal(shouldTriggerNextBatch(base), true);
    assert.equal(shouldTriggerNextBatch({ ...base, isInitialLoading: true }), false);
    assert.equal(shouldTriggerNextBatch({ ...base, isFetchingNext: true }), false);
    assert.equal(shouldTriggerNextBatch({ ...base, hasMore: false }), false);
    assert.equal(shouldTriggerNextBatch({ ...base, loadedCount: 0 }), false);
    assert.equal(shouldTriggerNextBatch({ ...base, loadedCount: 200 }), false);
    assert.equal(shouldTriggerNextBatch({ ...base, isFastScrollSuppressed: true }), false);
    assert.equal(shouldTriggerNextBatch({ ...base, hasNextBatchError: true }), false);
    assert.equal(shouldTriggerNextBatch({ ...base, sentinelIntersecting: false }), false);
  });

  it('detects scrollbar edge pointer clicks and rapid scroll jumps to keep footer reachable', () => {
    assert.equal(isPointerNearScrollbar(1430, 1440), true);
    assert.equal(isPointerNearScrollbar(1418, 1440), true);
    assert.equal(isPointerNearScrollbar(900, 1440), false);

    // Normal deliberate scroll (small delta over reasonable time) -> NOT suppressed
    let state = createScrollSampleState(0, 1000);
    const normalEval = evaluateScrollSample(state, {
      scrollY: 160,
      nowMs: 1120,
      sentinelTopPx: 250,
    });
    assert.equal(normalEval.isFastJump, false);
    assert.equal(normalEval.suppressed, false);

    // Large sudden jump down past sentinel into footer (e.g. scrollbar drag / End key)
    state = normalEval.nextState;
    const fastJumpToFooter = evaluateScrollSample(state, {
      scrollY: 3600,
      nowMs: 1200,
      sentinelTopPx: -480, // sentinel is now well above viewport because user is at footer
    });
    assert.equal(fastJumpToFooter.isFastJump, true);
    assert.equal(fastJumpToFooter.suppressed, true);
    assert.equal(fastJumpToFooter.nextState.overshotSentinelIntoFooter, true);

    // Even 800ms after stopping at footer, overshoot guard keeps auto-load paused until user scrolls back up
    const settledAtFooter = evaluateScrollSample(fastJumpToFooter.nextState, {
      scrollY: 3600,
      nowMs: 2100,
      sentinelTopPx: -480,
    });
    assert.equal(settledAtFooter.suppressed, true);

    // User deliberately scrolls back up into the product grid gently where sentinel is visible
    const scrolledBackUp = evaluateScrollSample(settledAtFooter.nextState, {
      scrollY: 3250,
      nowMs: 2500,
      sentinelTopPx: 140,
    });
    assert.equal(scrolledBackUp.nextState.overshotSentinelIntoFooter, false);
    assert.equal(scrolledBackUp.suppressed, false);
  });
});
