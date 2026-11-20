export interface InfiniteScrollConfig {
  initialBatchSize: number;
  subsequentBatchSize: number;
  maxLoadedProducts: number;
  largeScrollJumpPx: number;
  rapidVelocityPxPerMs: number;
  jumpCooldownMs: number;
}

export const DEFAULT_INITIAL_BATCH_SIZE = 100;
export const DEFAULT_SUBSEQUENT_BATCH_SIZE = 20;
export const DEFAULT_MAX_LOADED_PRODUCTS = 200;

export const DEFAULT_INFINITE_SCROLL_CONFIG: InfiniteScrollConfig = {
  initialBatchSize: DEFAULT_INITIAL_BATCH_SIZE,
  subsequentBatchSize: DEFAULT_SUBSEQUENT_BATCH_SIZE,
  maxLoadedProducts: DEFAULT_MAX_LOADED_PRODUCTS,
  largeScrollJumpPx: 720,
  rapidVelocityPxPerMs: 3.0,
  jumpCooldownMs: 420,
};

export function createInfiniteScrollConfig(
  overrides?: Partial<InfiniteScrollConfig>,
): InfiniteScrollConfig {
  const initialBatchSize = Math.min(
    100,
    Math.max(1, Math.floor(overrides?.initialBatchSize ?? DEFAULT_INFINITE_SCROLL_CONFIG.initialBatchSize)),
  );
  const subsequentBatchSize = Math.min(
    100,
    Math.max(1, Math.floor(overrides?.subsequentBatchSize ?? DEFAULT_INFINITE_SCROLL_CONFIG.subsequentBatchSize)),
  );
  const maxLoadedProducts = Math.max(
    initialBatchSize,
    Math.floor(overrides?.maxLoadedProducts ?? DEFAULT_INFINITE_SCROLL_CONFIG.maxLoadedProducts),
  );
  return {
    initialBatchSize,
    subsequentBatchSize,
    maxLoadedProducts,
    largeScrollJumpPx: Math.max(200, overrides?.largeScrollJumpPx ?? DEFAULT_INFINITE_SCROLL_CONFIG.largeScrollJumpPx),
    rapidVelocityPxPerMs: Math.max(
      1,
      overrides?.rapidVelocityPxPerMs ?? DEFAULT_INFINITE_SCROLL_CONFIG.rapidVelocityPxPerMs,
    ),
    jumpCooldownMs: Math.max(100, overrides?.jumpCooldownMs ?? DEFAULT_INFINITE_SCROLL_CONFIG.jumpCooldownMs),
  };
}

/**
 * Computes how many items the next request should ask for given current loaded count.
 * Returns 0 once the per-session view cap (default 200) has been reached.
 */
export function computeNextBatchLimit(
  loadedCount: number,
  config: InfiniteScrollConfig = DEFAULT_INFINITE_SCROLL_CONFIG,
): number {
  const safeLoaded = Math.max(0, Math.floor(loadedCount));
  if (safeLoaded === 0) {
    return Math.min(config.initialBatchSize, config.maxLoadedProducts);
  }
  const remaining = config.maxLoadedProducts - safeLoaded;
  if (remaining <= 0) {
    return 0;
  }
  return Math.min(config.subsequentBatchSize, remaining);
}

/**
 * Deduplicates incoming catalog products against already loaded items by `id`,
 * while capping total client-held records to `maxLoadedProducts`.
 */
export function dedupeMergeProducts<T extends { id: string }>(
  existing: T[],
  incoming: T[],
  maxLoadedProducts: number = DEFAULT_MAX_LOADED_PRODUCTS,
): T[] {
  if (existing.length >= maxLoadedProducts) {
    return existing.slice(0, maxLoadedProducts);
  }

  const seen = new Set<string>(existing.map((item) => item.id));
  const merged = [...existing];

  for (const item of incoming) {
    if (!item || !item.id || seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
    if (merged.length >= maxLoadedProducts) break;
  }

  return merged;
}

export interface NextBatchTriggerInput {
  isInitialLoading: boolean;
  isFetchingNext: boolean;
  hasMore: boolean;
  loadedCount: number;
  sentinelIntersecting: boolean;
  isFastScrollSuppressed: boolean;
  hasNextBatchError: boolean;
  config?: InfiniteScrollConfig;
}

export function shouldTriggerNextBatch(input: NextBatchTriggerInput): boolean {
  const cfg = input.config ?? DEFAULT_INFINITE_SCROLL_CONFIG;
  if (input.isInitialLoading || input.isFetchingNext) return false;
  if (!input.hasMore) return false;
  if (input.hasNextBatchError) return false;
  if (input.loadedCount <= 0 || input.loadedCount >= cfg.maxLoadedProducts) return false;
  if (input.isFastScrollSuppressed) return false;
  return input.sentinelIntersecting;
}

export interface ScrollSampleState {
  lastScrollY: number;
  lastTimestampMs: number;
  suppressedUntilMs: number;
  scrollbarDragging: boolean;
  overshotSentinelIntoFooter: boolean;
}

export function createScrollSampleState(initialScrollY = 0, nowMs = 0): ScrollSampleState {
  return {
    lastScrollY: Math.max(0, initialScrollY),
    lastTimestampMs: nowMs,
    suppressedUntilMs: 0,
    scrollbarDragging: false,
    overshotSentinelIntoFooter: false,
  };
}

/**
 * Detects whether a pointerdown event targets the vertical scrollbar edge zone
 * (right-most 26px strip of viewport in LTR or left-most in RTL).
 */
export function isPointerNearScrollbar(
  clientX: number,
  viewportWidth: number,
  scrollbarHitWidthPx = 26,
): boolean {
  if (!Number.isFinite(clientX) || !Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    return false;
  }
  return clientX >= viewportWidth - scrollbarHitWidthPx;
}

export interface ScrollSampleEvaluation {
  nextState: ScrollSampleState;
  isFastJump: boolean;
  suppressed: boolean;
}

/**
 * Pure scroll telemetry analyzer:
 * Detects scrollbar dragging, large sudden jumps (PageDown/End/scrollbar drag),
 * or rapid scroll velocity, returning whether automatic infinite-scroll loading
 * should be suppressed right now so the user can freely reach the footer.
 */
export function evaluateScrollSample(
  prev: ScrollSampleState,
  params: {
    scrollY: number;
    nowMs: number;
    sentinelTopPx?: number | null;
    config?: InfiniteScrollConfig;
  },
): ScrollSampleEvaluation {
  const cfg = params.config ?? DEFAULT_INFINITE_SCROLL_CONFIG;
  const currentY = Math.max(0, params.scrollY);
  const deltaY = Math.abs(currentY - prev.lastScrollY);
  const elapsedMs = Math.max(1, params.nowMs - prev.lastTimestampMs);
  const velocityPxPerMs = deltaY / elapsedMs;

  const isLargeJump = deltaY >= cfg.largeScrollJumpPx;
  const isRapidVelocity = deltaY >= 180 && velocityPxPerMs >= cfg.rapidVelocityPxPerMs;
  const isFastJump = prev.scrollbarDragging || isLargeJump || isRapidVelocity;

  const suppressedUntilMs = isFastJump
    ? Math.max(prev.suppressedUntilMs, params.nowMs + cfg.jumpCooldownMs)
    : prev.suppressedUntilMs;

  // If user jumped/scrolled fast past the sentinel straight down into the footer
  // (sentinel sits well above the top of viewport), prevent trapped batch loading.
  let overshotSentinelIntoFooter = prev.overshotSentinelIntoFooter;
  if (typeof params.sentinelTopPx === 'number') {
    if (isFastJump && params.sentinelTopPx < -100) {
      overshotSentinelIntoFooter = true;
    } else if (params.sentinelTopPx >= -60 && !isFastJump && currentY < prev.lastScrollY) {
      // User deliberately scrolled back up toward the product grid
      overshotSentinelIntoFooter = false;
    } else if (params.sentinelTopPx > 40) {
      overshotSentinelIntoFooter = false;
    }
  }

  const nextState: ScrollSampleState = {
    lastScrollY: currentY,
    lastTimestampMs: params.nowMs,
    suppressedUntilMs,
    scrollbarDragging: prev.scrollbarDragging,
    overshotSentinelIntoFooter,
  };

  const suppressed =
    nextState.scrollbarDragging ||
    params.nowMs < nextState.suppressedUntilMs ||
    nextState.overshotSentinelIntoFooter;

  return {
    nextState,
    isFastJump,
    suppressed,
  };
}
