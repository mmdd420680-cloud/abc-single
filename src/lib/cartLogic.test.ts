import test from 'node:test';
import assert from 'node:assert/strict';
import { configureStore } from '@reduxjs/toolkit';
import {
  addIdempotentCartLine,
  countUniqueCartLines,
  mergeCartLines,
  setCartLineQuantity,
  summarizeCartMetrics,
  type MergeableCartItem,
} from './pricingEngine';
import cartReducer, {
  addToCartAsync,
  selectCartLineCount,
  toggleCartItemSelectionAsync,
  updateCartQtyAsync,
} from '../features/cart/cartSlice';
import type { CartLine } from '../types/commerce';

function makeCartLine(overrides: Partial<CartLine> = {}): CartLine {
  return {
    productId: '507f1f77bcf86cd799439011',
    variantId: null,
    slug: 'macbook-air-m4',
    name: 'MacBook Air M4',
    sku: 'MBA-M4',
    imageUrl: '/assets/laptop.jpg',
    unitPrice: 120000,
    originalPrice: 140000,
    discountPercent: 14,
    quantity: 1,
    availableStock: 5,
    isAvailable: true,
    selected: true,
    ...overrides,
  };
}

test('Scenario A & B: Product card idempotent add inserts qty=1 once and ignores repeat clicks', () => {
  const first = addIdempotentCartLine<MergeableCartItem>([], {
    productId: 'p1',
    variantId: null,
    quantity: 1,
    maxStock: 10,
  });
  assert.equal(first.addedNewLine, true);
  assert.equal(first.items.length, 1);
  assert.equal(first.items[0].quantity, 1);
  assert.equal(countUniqueCartLines(first.items), 1);

  let state = first.items;
  for (let i = 0; i < 10; i += 1) {
    const next = addIdempotentCartLine<MergeableCartItem>(state, {
      productId: 'p1',
      variantId: null,
      quantity: 1,
      maxStock: 10,
    });
    assert.equal(next.addedNewLine, false);
    state = next.items;
  }

  assert.equal(state.length, 1);
  assert.equal(state[0].quantity, 1);
  assert.equal(countUniqueCartLines(state), 1);
});

test('Scenario C: PDP setCartLineQuantity sets exact quantity in [1, maxStock] without summing', () => {
  const step1 = setCartLineQuantity<MergeableCartItem>([], {
    productId: 'p1',
    variantId: 'v1',
    quantity: 3,
    maxStock: 5,
    selected: true,
  });
  assert.equal(step1.addedNewLine, true);
  assert.equal(step1.items[0].quantity, 3);
  assert.equal(countUniqueCartLines(step1.items), 1);

  // Explicit PDP update to qty=2 replaces 3 -> 2 (never 3 + 2 = 5)
  const step2 = setCartLineQuantity<MergeableCartItem>(step1.items, {
    productId: 'p1',
    variantId: 'v1',
    quantity: 2,
    maxStock: 5,
  });
  assert.equal(step2.addedNewLine, false);
  assert.equal(step2.items.length, 1);
  assert.equal(step2.items[0].quantity, 2);
  assert.equal(countUniqueCartLines(step2.items), 1);

  // Clamped above maxStock
  const step3 = setCartLineQuantity<MergeableCartItem>(step2.items, {
    productId: 'p1',
    variantId: 'v1',
    quantity: 99,
    maxStock: 4,
  });
  assert.equal(step3.items[0].quantity, 4);
});

test('Scenario D: Distinct variants count as distinct unique line items; navbar counter ignores unit sum', () => {
  let items = addIdempotentCartLine<MergeableCartItem>([], {
    productId: 'p1',
    variantId: 'v-midnight',
    quantity: 1,
    maxStock: 8,
  }).items;
  items = setCartLineQuantity<MergeableCartItem>(items, {
    productId: 'p1',
    variantId: 'v-silver',
    quantity: 4,
    maxStock: 8,
  }).items;
  items = setCartLineQuantity<MergeableCartItem>(items, {
    productId: 'p1',
    variantId: 'v-midnight',
    quantity: 5,
    maxStock: 8,
  }).items;

  assert.equal(items.length, 2);
  assert.equal(countUniqueCartLines(items), 2);

  const summary = summarizeCartMetrics({
    items: items.map((i) => ({ ...i, unitPrice: 1000, selected: true })),
  });
  assert.equal(summary.totalLineCount, 2);
  assert.equal(summary.selectedUnitsCount, 9);
});

test('Scenario E & F: mergeCartLines deduplicates matching lines, clamps stock, and preserves selected=false', () => {
  const merged = mergeCartLines<MergeableCartItem>(
    [
      { productId: 'p1', variantId: 'v1', quantity: 2, maxStock: 5, selected: false },
      { productId: 'p2', variantId: null, quantity: 1, maxStock: 3, selected: true },
    ],
    [
      { productId: 'p1', variantId: 'v1', quantity: 2, maxStock: 5, selected: true },
      { productId: 'p3', variantId: null, quantity: 2, maxStock: 4, selected: false },
    ],
  );

  assert.equal(countUniqueCartLines(merged), 3);
  const p1v1 = merged.find((i) => i.productId === 'p1' && i.variantId === 'v1');
  assert.equal(p1v1?.quantity, 4);
  assert.equal(p1v1?.selected, false);
  const p3 = merged.find((i) => i.productId === 'p3');
  assert.equal(p3?.selected, false);
});

test('Scenario G: cartSlice guest mode enforces idempotent card add, PDP set qty, and unique line selector', async () => {
  const store = configureStore({
    reducer: { cart: cartReducer },
  });

  const prodA = makeCartLine({ productId: 'pA', variantId: null, availableStock: 5, unitPrice: 1000 });
  const prodBVar = makeCartLine({ productId: 'pB', variantId: 'v1', availableStock: 5, unitPrice: 2000, quantity: 3 });

  // Product card click x5 stays qty=1 and unique line count=1
  for (let i = 0; i < 5; i += 1) {
    await store.dispatch(addToCartAsync({ item: prodA, isAuthenticated: false, mode: 'idempotent' }));
  }
  assert.equal(selectCartLineCount(store.getState()), 1);
  assert.equal(store.getState().cart.items[0].quantity, 1);

  // PDP add with mode='set' qty=3
  await store.dispatch(addToCartAsync({ item: prodBVar, isAuthenticated: false, mode: 'set' }));
  assert.equal(selectCartLineCount(store.getState()), 2);
  assert.equal(store.getState().cart.items[1].quantity, 3);
  assert.equal(store.getState().cart.subtotal, 1000 + 2000 * 3);

  // PDP re-add with mode='set' qty=2 sets to 2 (not 5)
  await store.dispatch(
    addToCartAsync({ item: { ...prodBVar, quantity: 2 }, isAuthenticated: false, mode: 'set' }),
  );
  assert.equal(selectCartLineCount(store.getState()), 2);
  assert.equal(store.getState().cart.items[1].quantity, 2);

  // Deselect prodBVar -> subtotal only includes prodA, badge stays 2 lines
  await store.dispatch(
    toggleCartItemSelectionAsync({
      productId: 'pB',
      variantId: 'v1',
      selected: false,
      isAuthenticated: false,
    }),
  );
  assert.equal(selectCartLineCount(store.getState()), 2);
  assert.equal(store.getState().cart.subtotal, 1000);

  // Setting qty=0 removes line and drops badge count to 1
  await store.dispatch(
    updateCartQtyAsync({
      productId: 'pB',
      variantId: 'v1',
      quantity: 0,
      isAuthenticated: false,
    }),
  );
  assert.equal(selectCartLineCount(store.getState()), 1);
});
