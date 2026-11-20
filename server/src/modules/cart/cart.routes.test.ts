import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import mongoose from 'mongoose';
import { createExpressApp } from '../../app';
import { signAuthToken } from '../../middleware/auth.middleware';
import { escapeCsvCell, sanitizeUntrustedValue } from '../../middleware/security.middleware';
import { UserModel } from '../users/user.model';
import { ProductModel } from '../products/product.model';
import { CartModel } from './cart.model';
import { CouponModel, DiscountRuleModel } from '../coupons/coupon.model';
import { BlogPostModel } from '../cms/cms.model';
import { CategoryModel } from '../categories/category.model';

async function withMockedDbServer(fn: (baseUrl: string, token: string) => Promise<void>) {
  const userId = '507f1f77bcf86cd799439011';
  const origReadyStateDescriptor = Object.getOwnPropertyDescriptor(mongoose.connection, 'readyState');
  const origFindById = UserModel.findById;

  Object.defineProperty(mongoose.connection, 'readyState', {
    configurable: true,
    get: () => 1,
  });

  UserModel.findById = (async (id: unknown) =>
    String(id) === userId
      ? {
          _id: userId,
          role: 'customer',
          email: 'shopper@novara.test',
          status: 'active',
          customPermissions: [],
        }
      : null) as never;

  const app = createExpressApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const token = signAuthToken({ _id: userId, role: 'customer', email: 'shopper@novara.test' });

  try {
    await fn(`http://127.0.0.1:${port}`, token);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    UserModel.findById = origFindById;
    if (origReadyStateDescriptor) {
      Object.defineProperty(mongoose.connection, 'readyState', origReadyStateDescriptor);
    } else {
      delete (mongoose.connection as unknown as { readyState?: unknown }).readyState;
    }
  }
}

test('Security middleware strips Mongo operators/prototype keys and CSV exporter neutralizes formulas', () => {
  const clean = sanitizeUntrustedValue({
    email: 'user@novara.com',
    $gt: '',
    'nested.key': 'x',
    nested: {
      ok: 'yes',
      $where: '1==1',
      constructor: { prototype: { polluted: true } },
    },
  }) as Record<string, unknown>;

  assert.equal(clean.email, 'user@novara.com');
  assert.equal('$gt' in clean, false);
  assert.equal('nested.key' in clean, false);
  assert.deepEqual(clean.nested, { ok: 'yes' });

  assert.equal(escapeCsvCell('=CMD("calc")'), '"\'=CMD(""calc"")"');
  assert.equal(escapeCsvCell('+1+2'), '"\'+1+2"');
  assert.equal(escapeCsvCell('Safe Text'), '"Safe Text"');
});

test('HTTP correlation ID, expanded robots.txt, and XML-escaped sitemap.xml work as expected', async () => {
  const origProdFind = ProductModel.find;
  const origCatFind = CategoryModel.find;
  const origBlogFind = BlogPostModel.find;

  try {
    ProductModel.find = (() => ({
      select: () => ({
        limit: () => ({
          lean: async () => [{ slug: 'macbook&air', updatedAt: new Date('2026-11-17T00:00:00Z') }],
        }),
      }),
    })) as never;
    CategoryModel.find = (() => ({
      select: () => ({
        limit: () => ({
          lean: async () => [{ slug: 'laptops', updatedAt: new Date('2026-11-16T00:00:00Z') }],
        }),
      }),
    })) as never;
    BlogPostModel.find = (() => ({
      select: () => ({
        limit: () => ({
          lean: async () => [{ slug: 'smart-shopping', updatedAt: new Date('2026-11-15T00:00:00Z') }],
        }),
      }),
    })) as never;

    await withMockedDbServer(async (baseUrl) => {
      const robots = await fetch(`${baseUrl}/robots.txt`, {
        headers: { 'x-request-id': 'req-corr-12345' },
      });
      assert.equal(robots.headers.get('x-request-id'), 'req-corr-12345');
      const robotsText = await robots.text();
      assert.ok(robotsText.includes('Disallow: /admin'));
      assert.ok(robotsText.includes('Disallow: /checkout'));
      assert.ok(robotsText.includes('Disallow: /cart'));
      assert.ok(robotsText.includes('Disallow: /account'));

      const sitemap = await fetch(`${baseUrl}/sitemap.xml`);
      assert.equal(sitemap.status, 200);
      assert.ok(sitemap.headers.get('content-type')?.includes('application/xml'));
      const xml = await sitemap.text();
      assert.ok(xml.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'));
      assert.ok(xml.includes('/product/macbook&amp;air'));
      assert.ok(xml.includes('<lastmod>2026-11-17T00:00:00.000Z</lastmod>'));
    });
  } finally {
    ProductModel.find = origProdFind;
    CategoryModel.find = origCatFind;
    BlogPostModel.find = origBlogFind;
  }
});

test('Cart API routes enforce idempotent add, PDP set qty, uniqueItemCount, VersionError retry, and ObjectId checks', async () => {
  const prodId = '507f1f77bcf86cd799439021';
  const varA = '507f1f77bcf86cd799439031';
  const varB = '507f1f77bcf86cd799439032';

  const mockProduct = {
    _id: prodId,
    name: 'Novara Studio Headphones',
    slug: 'novara-studio-headphones',
    shortDescription: 'Wireless ANC',
    sku: 'NSH-1',
    categoryId: '507f1f77bcf86cd799439041',
    status: 'published',
    basePrice: 5000,
    salePrice: 4000,
    stockOnHand: 0,
    reservedStock: 0,
    manageInventory: true,
    allowBackorder: false,
    hasVariants: true,
    images: [{ url: '/assets/headphones.jpg' }],
    variants: [
      { _id: varA, title: 'Midnight', sku: 'NSH-MID', stockOnHand: 6, reservedStock: 0, isActive: true },
      { _id: varB, title: 'Silver', sku: 'NSH-SLV', stockOnHand: 4, reservedStock: 0, isActive: true },
    ],
  };

  let cartDocState: {
    userId: string;
    items: Array<{ productId: unknown; variantId?: string | null; quantity: number; selected?: boolean }>;
    couponCode: string | null;
    save: () => Promise<void>;
  } | null = null;

  let forceOneVersionError = false;

  const origCartFindOne = CartModel.findOne;
  const origCartCreate = CartModel.create;
  const origProdFindOne = ProductModel.findOne;
  const origProdFind = ProductModel.find;
  const origDiscountRuleFind = DiscountRuleModel.find;
  const origCouponFindOne = CouponModel.findOne;

  try {
    CartModel.findOne = (async () => cartDocState) as never;
    CartModel.create = (async (doc: { userId: string; items: []; couponCode: null }) => {
      cartDocState = {
        userId: String(doc.userId),
        items: [],
        couponCode: null,
        async save() {
          if (forceOneVersionError) {
            forceOneVersionError = false;
            const err = new Error('Version mismatch');
            err.name = 'VersionError';
            throw err;
          }
        },
      };
      return cartDocState;
    }) as never;

    ProductModel.findOne = (async (filter: { _id?: unknown }) =>
      String(filter._id) === prodId ? mockProduct : null) as never;
    ProductModel.find = (() => ({
      lean: async () => [mockProduct],
    })) as never;
    DiscountRuleModel.find = (() => ({
      lean: async () => [],
    })) as never;
    CouponModel.findOne = (() => ({
      lean: async () => null,
    })) as never;

    await withMockedDbServer(async (baseUrl, token) => {
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      };

      // Invalid ObjectId -> 400
      const badIdRes = await fetch(`${baseUrl}/api/account/cart/items`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ productId: 'not-an-objectid', quantity: 1 }),
      });
      assert.equal(badIdRes.status, 400);

      // Idempotent mode x3 keeps qty=1 and uniqueItemCount=1
      for (let i = 0; i < 3; i += 1) {
        const res = await fetch(`${baseUrl}/api/account/cart/items`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ productId: prodId, variantId: varA, quantity: 1, mode: 'idempotent' }),
        });
        assert.equal(res.status, 200);
        const body = (await res.json()) as {
          ok: boolean;
          cart: { uniqueItemCount: number; items: Array<{ quantity: number; variantId: string | null }> };
        };
        assert.equal(body.ok, true);
        assert.equal(body.cart.uniqueItemCount, 1);
        assert.equal(body.cart.items[0].quantity, 1);
      }

      // PDP mode='set' on varB sets qty=3, making uniqueItemCount=2
      const setRes = await fetch(`${baseUrl}/api/account/cart/items`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ productId: prodId, variantId: varB, quantity: 3, mode: 'set' }),
      });
      assert.equal(setRes.status, 200);
      const setBody = (await setRes.json()) as {
        cart: { uniqueItemCount: number; items: Array<{ variantId: string | null; quantity: number }> };
      };
      assert.equal(setBody.cart.uniqueItemCount, 2);
      assert.equal(setBody.cart.items.find((x) => x.variantId === varB)?.quantity, 3);

      // VersionError retry recovers cleanly and sets varB quantity=2
      forceOneVersionError = true;
      const retryRes = await fetch(`${baseUrl}/api/account/cart/items`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ productId: prodId, variantId: varB, quantity: 2, mode: 'set' }),
      });
      assert.equal(retryRes.status, 200);
      const retryBody = (await retryRes.json()) as {
        cart: { uniqueItemCount: number; items: Array<{ variantId: string | null; quantity: number }> };
      };
      assert.equal(retryBody.cart.uniqueItemCount, 2);
      assert.equal(retryBody.cart.items.find((x) => x.variantId === varB)?.quantity, 2);
    });
  } finally {
    CartModel.findOne = origCartFindOne;
    CartModel.create = origCartCreate;
    ProductModel.findOne = origProdFindOne;
    ProductModel.find = origProdFind;
    DiscountRuleModel.find = origDiscountRuleFind;
    CouponModel.findOne = origCouponFindOne;
  }
});
