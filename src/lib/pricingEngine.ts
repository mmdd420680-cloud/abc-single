export interface CartLineInput {
  productId: string;
  variantId?: string | null;
  quantity: number;
  unitPrice: number;
  categoryId?: string;
}

export interface ProductPriceInput {
  basePrice: number;
  salePrice?: number | null;
  flashSalePrice?: number | null;
  flashSaleStartsAt?: Date | string | null;
  flashSaleEndsAt?: Date | string | null;
}

export function resolveEffectiveUnitPrice(
  product: ProductPriceInput,
  now: Date = new Date(),
): {
  currentPrice: number;
  originalPrice: number | null;
  discountPercent: number;
  isFlashSaleActive: boolean;
} {
  const base = Math.max(0, Number(product.basePrice) || 0);
  let effective = base;
  let isFlashSaleActive = false;

  if (
    product.flashSalePrice != null &&
    product.flashSalePrice > 0 &&
    product.flashSalePrice < base
  ) {
    const start = product.flashSaleStartsAt ? new Date(product.flashSaleStartsAt) : null;
    const end = product.flashSaleEndsAt ? new Date(product.flashSaleEndsAt) : null;
    const started = !start || now.getTime() >= start.getTime();
    const notEnded = !end || now.getTime() <= end.getTime();
    if (started && notEnded) {
      effective = product.flashSalePrice;
      isFlashSaleActive = true;
    }
  }

  if (!isFlashSaleActive && product.salePrice != null && product.salePrice > 0 && product.salePrice < base) {
    effective = product.salePrice;
  }

  const hasDiscount = effective < base && base > 0;
  const discountPercent = hasDiscount ? Math.round(((base - effective) / base) * 100) : 0;

  return {
    currentPrice: effective,
    originalPrice: hasDiscount ? base : null,
    discountPercent,
    isFlashSaleActive,
  };
}

export interface CouponSpec {
  code: string;
  discountType: 'fixed' | 'percentage';
  discountValue: number;
  maxDiscountAmount?: number | null;
  minOrderAmount: number;
  startsAt?: Date | string | null;
  endsAt?: Date | string | null;
  isActive: boolean;
  usageLimit?: number | null;
  usedCount: number;
  perCustomerLimit?: number | null;
  customerUsedCount?: number;
  eligibleCategoryIds?: string[];
  eligibleProductIds?: string[];
}

export function evaluateCouponDiscount(
  coupon: CouponSpec,
  items: CartLineInput[],
  now: Date = new Date(),
): { valid: boolean; discountAmount: number; reason?: string } {
  if (!coupon.isActive) {
    return { valid: false, discountAmount: 0, reason: 'This coupon is currently inactive.' };
  }
  if (coupon.startsAt && now.getTime() < new Date(coupon.startsAt).getTime()) {
    return { valid: false, discountAmount: 0, reason: 'This coupon is not active yet.' };
  }
  if (coupon.endsAt && now.getTime() > new Date(coupon.endsAt).getTime()) {
    return { valid: false, discountAmount: 0, reason: 'This coupon has expired.' };
  }
  if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) {
    return { valid: false, discountAmount: 0, reason: 'Coupon usage limit has been reached.' };
  }
  if (
    coupon.perCustomerLimit != null &&
    coupon.customerUsedCount != null &&
    coupon.customerUsedCount >= coupon.perCustomerLimit
  ) {
    return { valid: false, discountAmount: 0, reason: 'You have already used this coupon the maximum number of times.' };
  }

  const cartSubtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  if (cartSubtotal < coupon.minOrderAmount) {
    return {
      valid: false,
      discountAmount: 0,
      reason: `Minimum order amount of ৳${coupon.minOrderAmount.toLocaleString()} is required.`,
    };
  }

  const hasCatFilter = Boolean(coupon.eligibleCategoryIds && coupon.eligibleCategoryIds.length > 0);
  const hasProdFilter = Boolean(coupon.eligibleProductIds && coupon.eligibleProductIds.length > 0);

  const eligibleSubtotal = items.reduce((sum, item) => {
    if (!hasCatFilter && !hasProdFilter) {
      return sum + item.unitPrice * item.quantity;
    }
    const matchesProd = hasProdFilter && coupon.eligibleProductIds!.includes(item.productId);
    const matchesCat = hasCatFilter && item.categoryId && coupon.eligibleCategoryIds!.includes(item.categoryId);
    if (matchesProd || matchesCat) {
      return sum + item.unitPrice * item.quantity;
    }
    return sum;
  }, 0);

  if (eligibleSubtotal <= 0) {
    return { valid: false, discountAmount: 0, reason: 'Coupon is not eligible for the items in your cart.' };
  }

  let discount = 0;
  if (coupon.discountType === 'fixed') {
    discount = Math.min(coupon.discountValue, eligibleSubtotal);
  } else {
    discount = Math.round((eligibleSubtotal * coupon.discountValue) / 100);
    if (coupon.maxDiscountAmount != null && coupon.maxDiscountAmount > 0) {
      discount = Math.min(discount, coupon.maxDiscountAmount);
    }
    discount = Math.min(discount, eligibleSubtotal);
  }

  return {
    valid: true,
    discountAmount: Math.max(0, Math.round(discount)),
  };
}

export interface MergeableCartItem {
  productId: string;
  variantId?: string | null;
  quantity: number;
  maxStock?: number;
  selected?: boolean;
}

function getCartLineKey(item: { productId: string; variantId?: string | null }): string {
  return `${item.productId}::${item.variantId ? String(item.variantId) : 'default'}`;
}

function clampCartQuantity(quantity: number, maxStock?: number): number {
  const safeQty = Math.max(1, Math.floor(Number(quantity) || 1));
  if (maxStock == null) return Math.min(99, safeQty);
  return Math.min(safeQty, Math.max(1, Math.floor(maxStock)));
}

/**
 * Product-Card / Quick-Add idempotent semantics:
 * - If (productId, variantId) does NOT exist in cart -> add with quantity = 1 (clamped to maxStock).
 * - If (productId, variantId) ALREADY exists in cart -> keep existing line and quantity unchanged.
 * - Never creates duplicate lines for identical (productId, variantId).
 */
export function addIdempotentCartLine<T extends MergeableCartItem>(
  existingItems: T[],
  incomingItem: T,
): { items: T[]; addedNewLine: boolean } {
  const incomingKey = getCartLineKey(incomingItem);
  const existingIndex = existingItems.findIndex((item) => getCartLineKey(item) === incomingKey);

  if (existingIndex !== -1) {
    const existing = existingItems[existingIndex];
    const limit = incomingItem.maxStock ?? existing.maxStock;
    const clampedQty = clampCartQuantity(existing.quantity, limit);
    if (clampedQty === existing.quantity) {
      return { items: existingItems.slice(), addedNewLine: false };
    }
    const next = existingItems.slice();
    next[existingIndex] = { ...existing, quantity: clampedQty };
    return { items: next, addedNewLine: false };
  }

  const clampedQty = clampCartQuantity(1, incomingItem.maxStock);
  return {
    items: [
      ...existingItems,
      {
        ...incomingItem,
        variantId: incomingItem.variantId || null,
        quantity: clampedQty,
        selected: incomingItem.selected !== false,
      },
    ],
    addedNewLine: true,
  };
}

/**
 * Product Detail Page (PDP) explicit quantity semantics:
 * - Sets the matching (productId, variantId) line to the user's selected quantity (clamped to [1, maxStock]).
 * - If not yet in cart, inserts a new line with that exact quantity.
 * - Preserves existing `selected` state on existing lines, or defaults to `true` for new lines.
 */
export function setCartLineQuantity<T extends MergeableCartItem>(
  existingItems: T[],
  incomingItem: T,
): { items: T[]; addedNewLine: boolean } {
  const incomingKey = getCartLineKey(incomingItem);
  const clampedQty = clampCartQuantity(incomingItem.quantity, incomingItem.maxStock);
  const existingIndex = existingItems.findIndex((item) => getCartLineKey(item) === incomingKey);

  if (existingIndex !== -1) {
    const next = existingItems.slice();
    const existing = next[existingIndex];
    next[existingIndex] = {
      ...existing,
      ...incomingItem,
      variantId: incomingItem.variantId || null,
      quantity: clampedQty,
      selected: existing.selected !== false,
    };
    return { items: next, addedNewLine: false };
  }

  return {
    items: [
      ...existingItems,
      {
        ...incomingItem,
        variantId: incomingItem.variantId || null,
        quantity: clampedQty,
        selected: incomingItem.selected !== false,
      },
    ],
    addedNewLine: true,
  };
}

/**
 * Cart navbar & summary badge counter MUST count unique (productId, variantId) line items,
 * never the sum of unit quantities.
 */
export function countUniqueCartLines(items: Array<{ productId: string; variantId?: string | null }>): number {
  if (!Array.isArray(items) || items.length === 0) return 0;
  const keys = new Set<string>();
  for (const item of items) {
    if (!item?.productId) continue;
    keys.add(getCartLineKey(item));
  }
  return keys.size;
}

export function mergeCartLines<T extends MergeableCartItem>(
  existingItems: T[],
  incomingItems: T[],
): T[] {
  const map = new Map<string, T>();

  for (const item of existingItems) {
    const key = getCartLineKey(item);
    const prev = map.get(key);
    const qty = prev ? prev.quantity + Math.max(1, Math.floor(item.quantity)) : item.quantity;
    const clamped = clampCartQuantity(qty, item.maxStock ?? prev?.maxStock);
    map.set(key, {
      ...item,
      variantId: item.variantId || null,
      quantity: clamped,
      selected: item.selected !== false,
    });
  }

  for (const item of incomingItems) {
    const key = getCartLineKey(item);
    const incomingQty = Math.max(1, Math.floor(item.quantity));
    const existing = map.get(key);
    if (existing) {
      const combined = existing.quantity + incomingQty;
      const limit = item.maxStock ?? existing.maxStock;
      const clamped = clampCartQuantity(combined, limit);
      map.set(key, {
        ...existing,
        quantity: clamped,
        selected: existing.selected !== false,
      });
    } else {
      const clamped = clampCartQuantity(incomingQty, item.maxStock);
      map.set(key, {
        ...item,
        variantId: item.variantId || null,
        quantity: clamped,
        selected: item.selected !== false,
      });
    }
  }

  return Array.from(map.values());
}

export interface DiscountRuleSpec {
  id?: string;
  name: string;
  ruleType: 'percentage' | 'fixed' | 'bulk';
  value: number;
  minQty?: number;
  minSpend?: number;
  isActive: boolean;
  startsAt?: Date | string | null;
  endsAt?: Date | string | null;
}

export function evaluateDiscountRules(
  rules: DiscountRuleSpec[],
  items: CartLineInput[],
  now: Date = new Date(),
): { discountAmount: number; appliedRuleName: string | null } {
  const subtotal = items.reduce((sum, item) => sum + Math.max(0, item.unitPrice) * Math.max(0, item.quantity), 0);
  const totalQty = items.reduce((sum, item) => sum + Math.max(0, item.quantity), 0);
  if (subtotal <= 0) {
    return { discountAmount: 0, appliedRuleName: null };
  }

  let bestDiscount = 0;
  let bestRuleName: string | null = null;

  for (const rule of rules) {
    if (!rule.isActive) continue;
    if (rule.startsAt && now.getTime() < new Date(rule.startsAt).getTime()) continue;
    if (rule.endsAt && now.getTime() > new Date(rule.endsAt).getTime()) continue;
    if (rule.minQty != null && totalQty < rule.minQty) continue;
    if (rule.minSpend != null && subtotal < rule.minSpend) continue;

    let amount = 0;
    if (rule.ruleType === 'fixed') {
      amount = Math.min(subtotal, Math.max(0, Math.round(rule.value)));
    } else {
      amount = Math.min(subtotal, Math.round((subtotal * Math.max(0, rule.value)) / 100));
    }

    if (amount > bestDiscount) {
      bestDiscount = amount;
      bestRuleName = rule.name;
    }
  }

  return { discountAmount: bestDiscount, appliedRuleName: bestRuleName };
}

export function calculateOrderTotals(params: {
  items: CartLineInput[];
  couponDiscount: number;
  shippingCharge: number;
  taxRate?: number;
  taxInclusive?: boolean;
}): {
  subtotal: number;
  discount: number;
  tax: number;
  shippingCharge: number;
  total: number;
} {
  const subtotal = Math.max(
    0,
    Math.round(params.items.reduce((acc, item) => acc + Math.max(0, item.unitPrice) * Math.max(0, item.quantity), 0)),
  );
  const discount = Math.min(subtotal, Math.max(0, Math.round(params.couponDiscount)));
  const taxableAmount = Math.max(0, subtotal - discount);
  const rate = params.taxRate && params.taxRate > 0 ? params.taxRate : 0;
  const tax = rate
    ? params.taxInclusive
      ? Math.round(taxableAmount - taxableAmount / (1 + rate))
      : Math.round(taxableAmount * rate)
    : 0;
  const shippingCharge = Math.max(0, Math.round(params.shippingCharge));
  const total = Math.max(0, taxableAmount + (params.taxInclusive ? 0 : tax) + shippingCharge);

  return {
    subtotal,
    discount,
    tax,
    shippingCharge,
    total,
  };
}

export interface CartSummaryLineInput {
  productId: string;
  variantId?: string | null;
  quantity: number;
  unitPrice: number;
  originalPrice?: number | null;
  selected?: boolean;
  isAvailable?: boolean;
}

export interface CartMetricsSummary {
  totalLineCount: number;
  selectedLineCount: number;
  selectedUnitsCount: number;
  allSelected: boolean;
  subtotal: number;
  originalSubtotal: number;
  productSavings: number;
  couponDiscount: number;
  totalSavings: number;
  shippingFee: number;
  freeShippingQualified: boolean;
  amountToFreeShipping: number;
  total: number;
}

export function summarizeCartMetrics(params: {
  items: CartSummaryLineInput[];
  couponDiscount?: number;
  freeShippingThreshold?: number;
  defaultShippingCharge?: number;
}): CartMetricsSummary {
  const items = Array.isArray(params.items) ? params.items : [];
  const selectedItems = items.filter((item) => item.selected !== false);
  const selectedUnitsCount = selectedItems.reduce((sum, item) => sum + Math.max(0, Math.floor(item.quantity || 0)), 0);

  const subtotal = Math.max(
    0,
    Math.round(selectedItems.reduce((sum, item) => sum + Math.max(0, item.unitPrice) * Math.max(0, item.quantity), 0)),
  );
  const originalSubtotal = Math.max(
    subtotal,
    Math.round(
      selectedItems.reduce((sum, item) => {
        const orig = item.originalPrice != null && item.originalPrice > item.unitPrice ? item.originalPrice : item.unitPrice;
        return sum + Math.max(0, orig) * Math.max(0, item.quantity);
      }, 0),
    ),
  );
  const productSavings = Math.max(0, originalSubtotal - subtotal);
  const couponDiscount = Math.min(subtotal, Math.max(0, Math.round(params.couponDiscount || 0)));
  const threshold = Math.max(0, Number(params.freeShippingThreshold ?? 0));
  const baseShipping = Math.max(0, Math.round(params.defaultShippingCharge ?? 0));

  const freeShippingQualified =
    selectedItems.length > 0 && (threshold === 0 ? baseShipping === 0 : subtotal >= threshold);
  const shippingFee =
    selectedItems.length === 0 ? 0 : freeShippingQualified ? 0 : baseShipping;
  const amountToFreeShipping =
    selectedItems.length === 0 || threshold <= 0 ? 0 : Math.max(0, threshold - subtotal);

  const total = Math.max(0, subtotal - couponDiscount + shippingFee);

  return {
    totalLineCount: items.length,
    selectedLineCount: selectedItems.length,
    selectedUnitsCount,
    allSelected: items.length > 0 && selectedItems.length === items.length,
    subtotal,
    originalSubtotal,
    productSavings,
    couponDiscount,
    totalSavings: productSavings + couponDiscount,
    shippingFee,
    freeShippingQualified,
    amountToFreeShipping,
    total,
  };
}

