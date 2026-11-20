import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest, ApiError, isAbortError } from '../services/api';
import type { CategoryItem, ProductItem } from '../types/commerce';
import {
  computeNextBatchLimit,
  createInfiniteScrollConfig,
  createScrollSampleState,
  dedupeMergeProducts,
  evaluateScrollSample,
  isPointerNearScrollbar,
  shouldTriggerNextBatch,
  type InfiniteScrollConfig,
} from '../lib/infiniteScrollEngine';

export interface UseInfiniteProductFeedParams {
  q?: string;
  category?: string;
  subCategory?: string;
  brand?: string;
  minPrice?: string;
  maxPrice?: string;
  inStock?: boolean;
  discount?: boolean;
  section?: string;
  sort?: string;
  attributeEntries?: Array<[string, string[]]>;
  enabled?: boolean;
  configOverrides?: Partial<InfiniteScrollConfig>;
}

interface ProductsCursorResponse {
  ok: true;
  products: ProductItem[];
  category?: CategoryItem | null;
  subcategories?: CategoryItem[];
  nextCursor?: string | null;
  hasMore?: boolean;
  total?: number;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore?: boolean;
    nextCursor?: string | null;
  };
}

export function useInfiniteProductFeed(params: UseInfiniteProductFeedParams) {
  const {
    q = '',
    category = '',
    subCategory = '',
    brand = '',
    minPrice = '',
    maxPrice = '',
    inStock = false,
    discount = false,
    section = '',
    sort = 'popular',
    attributeEntries = [],
    enabled = true,
    configOverrides,
  } = params;

  const config = useMemo(
    () => createInfiniteScrollConfig(configOverrides),
    [
      configOverrides?.initialBatchSize,
      configOverrides?.subsequentBatchSize,
      configOverrides?.maxLoadedProducts,
      configOverrides?.largeScrollJumpPx,
      configOverrides?.rapidVelocityPxPerMs,
      configOverrides?.jumpCooldownMs,
    ],
  );

  const attrSignature = useMemo(
    () =>
      attributeEntries
        .map(([code, vals]) => `${code}:${[...vals].sort().join(',')}`)
        .sort()
        .join('|'),
    [attributeEntries],
  );

  const filterSignature = useMemo(
    () =>
      JSON.stringify({
        q,
        category,
        subCategory,
        brand,
        minPrice,
        maxPrice,
        inStock,
        discount,
        section,
        sort,
        attrSignature,
        enabled,
      }),
    [q, category, subCategory, brand, minPrice, maxPrice, inStock, discount, section, sort, attrSignature, enabled],
  );

  const [products, setProducts] = useState<ProductItem[]>([]);
  const [categoryInfo, setCategoryInfo] = useState<CategoryItem | null>(null);
  const [subcategories, setSubcategories] = useState<CategoryItem[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState<boolean>(true);
  const [initialLoading, setInitialLoading] = useState<boolean>(Boolean(enabled));
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [initialError, setInitialError] = useState<string | null>(null);
  const [initialErrorCode, setInitialErrorCode] = useState<string | null>(null);
  const [nextBatchError, setNextBatchError] = useState<string | null>(null);
  const [fastScrollSuppressed, setFastScrollSuppressed] = useState<boolean>(false);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const epochRef = useRef<number>(0);
  const activeControllerRef = useRef<AbortController | null>(null);
  const fetchingInitialRef = useRef<boolean>(false);
  const fetchingNextRef = useRef<boolean>(false);
  const intersectingRef = useRef<boolean>(false);
  const productsRef = useRef<ProductItem[]>([]);
  const scrollStateRef = useRef(createScrollSampleState(0, 0));
  const cooldownTimerRef = useRef<number | null>(null);

  const stateMirrorRef = useRef({
    productsLength: 0,
    hasMore: true,
    nextCursor: null as string | null,
    initialLoading: true,
    loadingMore: false,
    nextBatchError: null as string | null,
    fastScrollSuppressed: false,
  });

  stateMirrorRef.current = {
    productsLength: products.length,
    hasMore,
    nextCursor,
    initialLoading,
    loadingMore,
    nextBatchError,
    fastScrollSuppressed,
  };

  const buildQueryParams = useCallback(
    (limit: number, cursor: string | null) => {
      const qs = new URLSearchParams();
      if (q) qs.set('q', q);
      if (category) qs.set('category', category);
      if (subCategory) qs.set('subCategory', subCategory);
      if (brand) qs.set('brand', brand);
      if (minPrice) qs.set('minPrice', minPrice);
      if (maxPrice) qs.set('maxPrice', maxPrice);
      if (inStock) qs.set('inStock', 'true');
      if (discount) qs.set('discount', 'true');
      if (section) qs.set('section', section);
      qs.set('sort', sort || 'popular');
      qs.set('limit', String(limit));
      if (cursor) {
        qs.set('cursor', cursor);
      }
      for (const [code, vals] of attributeEntries) {
        if (code && vals.length > 0) {
          qs.set(`attr_${code}`, vals.join(','));
        }
      }
      return qs.toString();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q, category, subCategory, brand, minPrice, maxPrice, inStock, discount, section, sort, attrSignature],
  );

  const fetchInitialBatch = useCallback(async () => {
    if (!enabled) {
      setInitialLoading(false);
      return;
    }

    activeControllerRef.current?.abort();
    const controller = new AbortController();
    activeControllerRef.current = controller;
    const requestEpoch = ++epochRef.current;

    fetchingInitialRef.current = true;
    fetchingNextRef.current = false;
    setInitialLoading(true);
    setLoadingMore(false);
    setInitialError(null);
    setInitialErrorCode(null);
    setNextBatchError(null);
    productsRef.current = [];
    setProducts([]);
    setNextCursor(null);
    setHasMore(true);
    setTotal(0);

    const limit = computeNextBatchLimit(0, config);

    try {
      const res = await apiRequest<ProductsCursorResponse>(
        `/api/products?${buildQueryParams(limit, null)}`,
        { signal: controller.signal },
      );

      if (controller.signal.aborted || epochRef.current !== requestEpoch) return;

      const incoming = Array.isArray(res?.products) ? res.products : [];
      const merged = dedupeMergeProducts([], incoming, config.maxLoadedProducts);
      const resolvedTotal = Number(res?.total ?? res?.pagination?.total ?? merged.length);
      const serverCursor = res?.nextCursor ?? res?.pagination?.nextCursor ?? null;
      const serverHasMore = Boolean(
        res?.hasMore ?? res?.pagination?.hasMore ?? (serverCursor && merged.length < resolvedTotal),
      );
      const canLoadMore = serverHasMore && Boolean(serverCursor) && merged.length < config.maxLoadedProducts;

      productsRef.current = merged;
      setProducts(merged);
      setCategoryInfo(res?.category ?? null);
      setSubcategories(Array.isArray(res?.subcategories) ? res.subcategories : []);
      setTotal(resolvedTotal);
      setNextCursor(canLoadMore ? serverCursor : null);
      setHasMore(canLoadMore);
    } catch (err) {
      if (isAbortError(err) || controller.signal.aborted || epochRef.current !== requestEpoch) return;
      const code = err instanceof ApiError ? err.code : 'NETWORK_ERROR';
      productsRef.current = [];
      setProducts([]);
      setTotal(0);
      setNextCursor(null);
      setHasMore(false);
      setInitialErrorCode(code);
      setInitialError(err instanceof Error ? err.message : 'Unable to fetch catalog products.');
    } finally {
      if (!controller.signal.aborted && epochRef.current === requestEpoch) {
        fetchingInitialRef.current = false;
        setInitialLoading(false);
      }
    }
  }, [enabled, config, buildQueryParams]);

  const fetchNextBatch = useCallback(
    async (forceManual = false) => {
      const mirror = stateMirrorRef.current;
      if (!enabled) return;
      if (fetchingInitialRef.current || fetchingNextRef.current) return;
      if (!mirror.hasMore || !mirror.nextCursor) return;
      if (!forceManual && mirror.nextBatchError) return;

      const nextLimit = computeNextBatchLimit(productsRef.current.length, config);
      if (nextLimit <= 0) {
        setHasMore(false);
        return;
      }

      const controller = new AbortController();
      activeControllerRef.current = controller;
      const requestEpoch = epochRef.current;
      const cursorUsed = mirror.nextCursor;

      fetchingNextRef.current = true;
      setLoadingMore(true);
      setNextBatchError(null);

      try {
        const res = await apiRequest<ProductsCursorResponse>(
          `/api/products?${buildQueryParams(nextLimit, cursorUsed)}`,
          { signal: controller.signal },
        );

        if (controller.signal.aborted || epochRef.current !== requestEpoch) return;

        const incoming = Array.isArray(res?.products) ? res.products : [];
        const previousList = productsRef.current;
        const merged = dedupeMergeProducts(previousList, incoming, config.maxLoadedProducts);
        const deduplicatedAdded = merged.length - previousList.length;
        const nextMergedLength = merged.length;

        productsRef.current = merged;
        setProducts(merged);

        const serverCursor = res?.nextCursor ?? res?.pagination?.nextCursor ?? null;
        const serverHasMore = Boolean(res?.hasMore ?? res?.pagination?.hasMore ?? Boolean(serverCursor));
        const withinCap = nextMergedLength < config.maxLoadedProducts;
        const madeProgress = incoming.length > 0 && deduplicatedAdded > 0;
        const canContinue = serverHasMore && Boolean(serverCursor) && withinCap && madeProgress;

        setNextCursor(canContinue ? serverCursor : null);
        setHasMore(canContinue);
      } catch (err) {
        if (isAbortError(err) || controller.signal.aborted || epochRef.current !== requestEpoch) return;
        setNextBatchError(err instanceof Error ? err.message : 'Unable to load additional products.');
      } finally {
        if (!controller.signal.aborted && epochRef.current === requestEpoch) {
          fetchingNextRef.current = false;
          setLoadingMore(false);
        }
      }
    },
    [enabled, config, buildQueryParams],
  );

  // Trigger initial load on filter/sort/category signature change
  useEffect(() => {
    void fetchInitialBatch();
    return () => {
      activeControllerRef.current?.abort();
    };
  }, [filterSignature, fetchInitialBatch]);

  // Passive rapid scroll / scrollbar drag detector
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    scrollStateRef.current = createScrollSampleState(window.scrollY, performance.now());

    const triggerCheckAfterCooldown = () => {
      const sentinelEl = sentinelRef.current;
      const rect = sentinelEl ? sentinelEl.getBoundingClientRect() : null;
      const mirror = stateMirrorRef.current;
      const withinIntentionalZone = rect !== null && rect.top >= -120 && rect.top <= window.innerHeight + 340;
      if (
        withinIntentionalZone &&
        intersectingRef.current &&
        !scrollStateRef.current.overshotSentinelIntoFooter &&
        shouldTriggerNextBatch({
          isInitialLoading: mirror.initialLoading,
          isFetchingNext: mirror.loadingMore,
          hasMore: mirror.hasMore,
          loadedCount: mirror.productsLength,
          sentinelIntersecting: true,
          isFastScrollSuppressed: false,
          hasNextBatchError: Boolean(mirror.nextBatchError),
          config,
        })
      ) {
        void fetchNextBatch(false);
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (isPointerNearScrollbar(e.clientX, window.innerWidth)) {
        scrollStateRef.current.scrollbarDragging = true;
        setFastScrollSuppressed(true);
      }
    };

    const clearScrollbarDrag = () => {
      if (!scrollStateRef.current.scrollbarDragging) return;
      scrollStateRef.current.scrollbarDragging = false;
      const now = performance.now();
      scrollStateRef.current.suppressedUntilMs = Math.max(
        scrollStateRef.current.suppressedUntilMs,
        now + config.jumpCooldownMs,
      );
      if (cooldownTimerRef.current !== null) window.clearTimeout(cooldownTimerRef.current);
      cooldownTimerRef.current = window.setTimeout(() => {
        setFastScrollSuppressed(scrollStateRef.current.overshotSentinelIntoFooter);
        triggerCheckAfterCooldown();
      }, config.jumpCooldownMs);
    };

    const onScroll = () => {
      const now = performance.now();
      const sentinelTop = sentinelRef.current ? sentinelRef.current.getBoundingClientRect().top : null;
      const evalResult = evaluateScrollSample(scrollStateRef.current, {
        scrollY: window.scrollY,
        nowMs: now,
        sentinelTopPx: sentinelTop,
        config,
      });
      scrollStateRef.current = evalResult.nextState;

      if (evalResult.suppressed) {
        setFastScrollSuppressed(true);
        if (cooldownTimerRef.current !== null) window.clearTimeout(cooldownTimerRef.current);
        const remainingWait = Math.max(60, evalResult.nextState.suppressedUntilMs - now);
        cooldownTimerRef.current = window.setTimeout(() => {
          const currentSuppressed =
            scrollStateRef.current.scrollbarDragging ||
            scrollStateRef.current.overshotSentinelIntoFooter ||
            performance.now() < scrollStateRef.current.suppressedUntilMs;
          setFastScrollSuppressed(currentSuppressed);
          if (!currentSuppressed) {
            triggerCheckAfterCooldown();
          }
        }, remainingWait);
      } else {
        setFastScrollSuppressed(false);
      }
    };

    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointerup', clearScrollbarDrag, { passive: true });
    window.addEventListener('pointercancel', clearScrollbarDrag, { passive: true });
    window.addEventListener('blur', clearScrollbarDrag);
    window.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', clearScrollbarDrag);
      window.removeEventListener('pointercancel', clearScrollbarDrag);
      window.removeEventListener('blur', clearScrollbarDrag);
      window.removeEventListener('scroll', onScroll);
      if (cooldownTimerRef.current !== null) {
        window.clearTimeout(cooldownTimerRef.current);
        cooldownTimerRef.current = null;
      }
    };
  }, [enabled, config, fetchNextBatch]);

  // IntersectionObserver for bottom sentinel
  useEffect(() => {
    const sentinelEl = sentinelRef.current;
    if (!enabled || !sentinelEl || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        const isVisible = Boolean(entry?.isIntersecting);
        intersectingRef.current = isVisible;
        if (!isVisible) return;

        const mirror = stateMirrorRef.current;
        if (
          shouldTriggerNextBatch({
            isInitialLoading: mirror.initialLoading,
            isFetchingNext: mirror.loadingMore,
            hasMore: mirror.hasMore,
            loadedCount: mirror.productsLength,
            sentinelIntersecting: true,
            isFastScrollSuppressed:
              mirror.fastScrollSuppressed ||
              scrollStateRef.current.scrollbarDragging ||
              scrollStateRef.current.overshotSentinelIntoFooter,
            hasNextBatchError: Boolean(mirror.nextBatchError),
            config,
          })
        ) {
          void fetchNextBatch(false);
        }
      },
      {
        root: null,
        rootMargin: '320px 0px',
        threshold: 0.01,
      },
    );

    observer.observe(sentinelEl);
    return () => observer.disconnect();
  }, [enabled, config, fetchNextBatch, products.length, hasMore]);

  const reachedSessionCap = products.length >= config.maxLoadedProducts;

  return {
    products,
    categoryInfo,
    subcategories,
    total,
    hasMore: hasMore && !reachedSessionCap,
    reachedSessionCap,
    initialLoading,
    loadingMore,
    initialError,
    initialErrorCode,
    nextBatchError,
    fastScrollSuppressed,
    sentinelRef,
    maxLoadedProducts: config.maxLoadedProducts,
    loadMoreManual: () => fetchNextBatch(true),
    retryInitial: () => fetchInitialBatch(),
    retryNextBatch: () => fetchNextBatch(true),
  };
}
