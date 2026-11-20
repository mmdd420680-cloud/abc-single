import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Copy,
  Heart,
  Link2,
  Lock,
  MapPin,
  Monitor,
  Package,
  ShieldCheck,
  Star,
  TicketPercent,
  Trash2,
  Unlink,
  Wallet,
} from 'lucide-react';
import { useAppDispatch, useAppSelector } from '../../app/hooks';
import { logoutUser, openAuthModal, setUserProfile } from '../../features/auth/authSlice';
import { showToast } from '../../features/notifications/toastSlice';
import { selectWishlistCount } from '../../features/wishlist/wishlistSlice';
import { AccountLayout, type AccountNavKey } from '../../components/account/AccountLayout';
import { apiRequest } from '../../services/api';
import { formatStoreCurrency } from '../../lib/dateTime';
import {
  OAUTH_BROADCAST_CHANNEL,
  OAUTH_POPUP_WINDOW_FEATURES,
  isTrustedOAuthOrigin,
  safeClosePopupWindow,
} from '../../lib/authValidation';
import { useSeoMeta } from '../../lib/useSeoMeta';
import type { UserProfile } from '../../types/commerce';
import type {
  CouponItem,
  OrderRecord,
  SavedAddress,
  WalletTransactionItem,
} from '../../types/commerce';

interface AccountDashboardResponse {
  summary: {
    totalOrders: number;
    activeOrders: number;
    deliveredOrders: number;
    wishlistCount: number;
    reviewCount: number;
    addressCount: number;
    activeCouponsCount: number;
    walletBalance: number;
    walletTransactionsCount: number;
    totalSpent: number;
  };
  recentOrders: OrderRecord[];
}

interface AccountReviewItem {
  id: string;
  rating: number;
  title: string;
  comment: string;
  status: 'pending' | 'approved' | 'rejected';
  isVerifiedPurchase: boolean;
  createdAt: string;
  product: {
    id: string;
    name: string;
    slug: string;
    imageUrl?: string;
  } | null;
}

function CustomerAuthRequired({
  activeKey,
  title,
  subtitle,
}: {
  activeKey: AccountNavKey;
  title: string;
  subtitle: string;
}) {
  const dispatch = useAppDispatch();
  return (
    <div className="bg-[#F4F7FF] py-7 sm:py-9 min-h-[70vh]">
      <AccountLayout activeKey={activeKey}>
        <div className="rounded-2xl border border-[#DCE6F7] bg-white p-10 text-center shadow-xs">
          <Lock className="mx-auto h-12 w-12 text-[#1155EE]" />
          <h1 className="font-display mt-4 text-2xl font-extrabold text-[#0B1730]">{title}</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">{subtitle}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => dispatch(openAuthModal({ tab: 'login', returnUrl: window.location.pathname }))}
              className="rounded-full bg-[#1155EE] px-7 py-2.5 text-sm font-semibold text-white hover:bg-[#0B44CC]"
            >
              Sign In
            </button>
            <Link
              to="/register"
              className="rounded-full border border-[#C7DAFF] bg-[#F2F7FF] px-7 py-2.5 text-sm font-semibold text-[#1155EE] hover:bg-[#E5EFFF]"
            >
              Create Account
            </Link>
          </div>
        </div>
      </AccountLayout>
    </div>
  );
}

export function AccountDashboardPage() {
  useSeoMeta({ title: 'My Dashboard | NOVARA COMMERCE', noIndex: true });
  const { user } = useAppSelector((s) => s.auth);
  const currencyCfg = useAppSelector((s) => s.storefront.settings?.currencySettings);
  const wishlistCount = useAppSelector(selectWishlistCount);
  const [data, setData] = useState<AccountDashboardResponse | null>(null);
  const [defaultAddress, setDefaultAddress] = useState<SavedAddress | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    Promise.all([
      apiRequest<{ ok: true } & AccountDashboardResponse>('/api/account/dashboard'),
      apiRequest<{ ok: true; addresses: SavedAddress[] }>('/api/account/addresses').catch(() => null),
    ])
      .then(([dashRes, addrRes]) => {
        setData(dashRes);
        const addrs = addrRes?.addresses || [];
        setDefaultAddress(addrs.find((a) => a.isDefault) || addrs[0] || null);
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [user]);

  if (!user) {
    return (
      <CustomerAuthRequired
        activeKey="dashboard"
        title="My Account Dashboard"
        subtitle="Sign in to view your recent orders, wallet balance, saved addresses, and personalized activity."
      />
    );
  }

  return (
    <div className="bg-[#F4F7FF] py-7 sm:py-9 min-h-[70vh]">
      <AccountLayout activeKey="dashboard">
        <div className="space-y-5">
          {/* Welcome Banner */}
          <div className="rounded-2xl border border-[#DCE6F7] bg-gradient-to-r from-[#EEF4FF] via-white to-[#DCE9FF] p-6 shadow-xs">
            <h1 className="font-display text-2xl font-extrabold text-[#0B1730]">
              Welcome back, {user.name.split(' ')[0]}!
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Manage your orders, wishlist favorites, wallet balance, coupons, and account security in one place.
            </p>
          </div>

          {/* 4 Summary Cards */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              {
                label: 'Total Orders',
                value: loading ? '...' : (data?.summary?.totalOrders ?? 0).toLocaleString(),
                to: '/account/orders',
                icon: ClipboardList,
                tone: 'bg-blue-50 text-[#1155EE]',
              },
              {
                label: 'Saved Wishlist',
                value: wishlistCount.toLocaleString(),
                to: '/wishlist',
                icon: Heart,
                tone: 'bg-rose-50 text-rose-500',
              },
              {
                label: 'Wallet Balance',
                value: loading ? '...' : formatStoreCurrency(data?.summary?.walletBalance ?? user.walletBalance ?? 0, currencyCfg),
                to: '/account/wallet',
                icon: Wallet,
                tone: 'bg-emerald-50 text-emerald-600',
              },
              {
                label: 'Active Coupons',
                value: loading ? '...' : (data?.summary?.activeCouponsCount ?? 0).toLocaleString(),
                to: '/account/coupons',
                icon: TicketPercent,
                tone: 'bg-amber-50 text-amber-600',
              },
            ].map((card) => {
              const Icon = card.icon;
              return (
                <Link
                  key={card.label}
                  to={card.to}
                  className="rounded-2xl border border-[#DCE6F7] bg-white p-4 shadow-xs transition hover:border-[#1155EE]/50 hover:shadow-sm"
                >
                  <div className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${card.tone}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="font-mono-tabular mt-3 text-xl font-extrabold text-[#0B1730]">
                    {card.value}
                  </div>
                  <div className="text-xs font-medium text-slate-500">{card.label}</div>
                </Link>
              );
            })}
          </div>

          {/* Recent Orders & Default Address */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            <div className="lg:col-span-8 rounded-2xl border border-[#DCE6F7] bg-white p-5 shadow-xs">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-display text-base font-bold text-[#0B1730]">Recent Orders</h2>
                <Link to="/account/orders" className="text-xs font-semibold text-[#1155EE] hover:underline">
                  View All →
                </Link>
              </div>
              {loading ? (
                <div className="space-y-3">
                  <div className="h-14 animate-pulse rounded-xl bg-slate-100" />
                  <div className="h-14 animate-pulse rounded-xl bg-slate-100" />
                </div>
              ) : !data?.recentOrders?.length ? (
                <div className="py-8 text-center">
                  <Package className="mx-auto h-10 w-10 text-slate-300" />
                  <p className="mt-2 text-sm text-slate-500">You have not placed any orders yet.</p>
                  <Link
                    to="/shop"
                    className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#1155EE] px-5 py-2 text-xs font-semibold text-white"
                  >
                    Start Shopping <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {data.recentOrders.map((ord) => {
                    const itemCount = (ord.items || []).reduce((sum, item) => sum + Number(item.quantity || 1), 0);
                    return (
                      <div key={ord.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-xs">
                        <div>
                          <Link to={`/account/orders/${ord.id}`} className="font-mono-tabular font-bold text-[#1155EE] hover:underline">
                            #{ord.orderNumber}
                          </Link>
                          <div className="text-slate-500">
                            {new Date(ord.createdAt).toLocaleDateString()} · {itemCount} item{itemCount === 1 ? '' : 's'}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="rounded-md bg-[#EEF4FF] px-2.5 py-1 font-semibold uppercase text-[#1155EE]">
                            {ord.orderStatus.replace(/_/g, ' ')}
                          </span>
                          <span className="font-mono-tabular font-bold text-[#0B1730]">
                            {formatStoreCurrency(ord.total, currencyCfg)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="lg:col-span-4 rounded-2xl border border-[#DCE6F7] bg-white p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-base font-bold text-[#0B1730]">Default Address</h2>
                <Link to="/account/addresses" className="text-xs font-semibold text-[#1155EE] hover:underline">
                  Manage
                </Link>
              </div>
              {defaultAddress ? (
                <div className="rounded-xl border border-[#EBF1FC] bg-[#F8FAFF] p-3.5 text-xs space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-[#0B1730]">
                    <MapPin className="h-3.5 w-3.5 text-[#1155EE]" />
                    <span>{defaultAddress.label}</span>
                  </div>
                  <p className="font-semibold text-slate-700">{defaultAddress.recipientName}</p>
                  <p className="text-slate-500">{defaultAddress.phone}</p>
                  <p className="text-slate-500">
                    {defaultAddress.house}, {defaultAddress.area}, {defaultAddress.upazila},{' '}
                    {defaultAddress.district}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-slate-500">No default shipping address saved yet.</p>
              )}
            </div>
          </div>
        </div>
      </AccountLayout>
    </div>
  );
}

export function MyReviewsPage() {
  useSeoMeta({ title: 'My Reviews | NOVARA COMMERCE', noIndex: true });
  const { user } = useAppSelector((s) => s.auth);
  const [reviews, setReviews] = useState<AccountReviewItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    apiRequest<{ ok: true; reviews: AccountReviewItem[] }>('/api/account/reviews')
      .then((res) => setReviews(res.reviews || []))
      .catch(() => setReviews([]))
      .finally(() => setLoading(false));
  }, [user]);

  if (!user) {
    return (
      <CustomerAuthRequired
        activeKey="reviews"
        title="My Product Reviews"
        subtitle="Sign in to view all product ratings and reviews you have submitted."
      />
    );
  }

  return (
    <div className="bg-[#F4F7FF] py-7 sm:py-9 min-h-[70vh]">
      <AccountLayout activeKey="reviews">
        <div className="rounded-2xl border border-[#DCE6F7] bg-white p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h1 className="font-display text-xl font-extrabold text-[#0B1730]">My Reviews</h1>
              <p className="text-xs text-slate-500">Product reviews you have posted after verified deliveries.</p>
            </div>
            <Link to="/account/orders" className="text-xs font-semibold text-[#1155EE] hover:underline">
              Review an Order →
            </Link>
          </div>

          {loading ? (
            <div className="h-32 animate-pulse rounded-xl bg-slate-100" />
          ) : reviews.length === 0 ? (
            <div className="py-12 text-center">
              <Star className="mx-auto h-10 w-10 text-slate-300" />
              <p className="mt-2 font-display text-base font-bold text-[#0B1730]">No reviews submitted yet</p>
              <p className="mt-1 text-xs text-slate-500">
                Once your order is delivered, visit the product page to leave a verified review.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {reviews.map((rev) => (
                <div key={rev.id} className="rounded-xl border border-[#E6EEF9] bg-[#FBFCFF] p-4 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {rev.product?.slug ? (
                        <Link to={`/product/${rev.product.slug}`} className="text-sm font-bold text-[#0B1730] hover:text-[#1155EE]">
                          {rev.product.name}
                        </Link>
                      ) : (
                        <span className="text-sm font-bold text-[#0B1730]">{rev.title}</span>
                      )}
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase ${
                          rev.status === 'approved'
                            ? 'bg-emerald-50 text-emerald-700'
                            : rev.status === 'rejected'
                              ? 'bg-rose-50 text-rose-700'
                              : 'bg-amber-50 text-amber-700'
                        }`}
                      >
                        {rev.status}
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-400">
                      {new Date(rev.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <Star key={s} className={`h-3.5 w-3.5 ${s <= rev.rating ? 'fill-amber-400 text-amber-400' : 'text-slate-200'}`} />
                    ))}
                    <span className="ml-1 text-xs font-bold text-[#0B1730]">{rev.title}</span>
                  </div>
                  <p className="text-xs leading-relaxed text-slate-600">{rev.comment}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </AccountLayout>
    </div>
  );
}

export function MyCouponsPage() {
  useSeoMeta({ title: 'My Coupons | NOVARA COMMERCE', noIndex: true });
  const dispatch = useAppDispatch();
  const { user } = useAppSelector((s) => s.auth);
  const currencyCfg = useAppSelector((s) => s.storefront.settings?.currencySettings);
  const [coupons, setCoupons] = useState<CouponItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    apiRequest<{ ok: true; coupons: CouponItem[] }>('/api/account/coupons')
      .then((res) => setCoupons(res.coupons || []))
      .catch(() => setCoupons([]))
      .finally(() => setLoading(false));
  }, [user]);

  if (!user) {
    return (
      <CustomerAuthRequired
        activeKey="coupons"
        title="My Coupons & Offers"
        subtitle="Sign in to view available promo codes and personalized discount coupons."
      />
    );
  }

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      dispatch(showToast({ variant: 'success', message: `Coupon code "${code}" copied!` }));
    } catch {
      dispatch(showToast({ variant: 'info', message: `Use code ${code} in your cart.` }));
    }
  };

  return (
    <div className="bg-[#F4F7FF] py-7 sm:py-9 min-h-[70vh]">
      <AccountLayout activeKey="coupons">
        <div className="rounded-2xl border border-[#DCE6F7] bg-white p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h1 className="font-display text-xl font-extrabold text-[#0B1730]">My Coupons</h1>
              <p className="text-xs text-slate-500">Active promo codes ready to apply at checkout.</p>
            </div>
            <Link to="/cart" className="text-xs font-semibold text-[#1155EE] hover:underline">
              Apply in Cart →
            </Link>
          </div>

          {loading ? (
            <div className="h-32 animate-pulse rounded-xl bg-slate-100" />
          ) : coupons.length === 0 ? (
            <div className="py-12 text-center">
              <TicketPercent className="mx-auto h-10 w-10 text-slate-300" />
              <p className="mt-2 font-display text-base font-bold text-[#0B1730]">No active coupons right now</p>
              <Link to="/offers" className="mt-3 inline-block text-xs font-semibold text-[#1155EE] hover:underline">
                Browse Current Offers →
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {coupons.map((cp) => (
                <div
                  key={cp.id}
                  className="flex flex-col justify-between rounded-2xl border border-dashed border-[#A9C6FA] bg-[#F7FAFF] p-4 space-y-3"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono-tabular rounded-lg bg-[#1155EE] px-3 py-1 text-xs font-bold text-white">
                        {cp.code}
                      </span>
                      <button
                        type="button"
                        onClick={() => copyCode(cp.code)}
                        className="inline-flex items-center gap-1 rounded-lg border border-[#DCE6F7] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#0B1730] hover:text-[#1155EE]"
                      >
                        <Copy className="h-3 w-3" /> Copy
                      </button>
                    </div>
                    <p className="mt-2 text-sm font-bold text-[#0B1730]">
                      {cp.discountType === 'percentage'
                        ? `${cp.discountValue}% OFF`
                        : `${formatStoreCurrency(cp.discountValue, currencyCfg)} OFF`}
                    </p>
                    {cp.description && <p className="mt-0.5 text-xs text-slate-600">{cp.description}</p>}
                  </div>
                  <div className="flex items-center justify-between border-t border-[#DCE6F7] pt-2 text-[11px] text-slate-500">
                    <span>
                      Min order: {formatStoreCurrency(cp.minOrderAmount || 0, currencyCfg)}
                    </span>
                    {cp.endsAt && <span>Ends {new Date(cp.endsAt).toLocaleDateString()}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </AccountLayout>
    </div>
  );
}

export function MyWalletPage() {
  useSeoMeta({ title: 'My Wallet | NOVARA COMMERCE', noIndex: true });
  const { user } = useAppSelector((s) => s.auth);
  const currencyCfg = useAppSelector((s) => s.storefront.settings?.currencySettings);
  const [balance, setBalance] = useState(0);
  const [transactions, setTransactions] = useState<WalletTransactionItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    apiRequest<{ ok: true; balance: number; transactions: WalletTransactionItem[] }>('/api/account/wallet')
      .then((res) => {
        setBalance(res.balance || 0);
        setTransactions(res.transactions || []);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [user]);

  if (!user) {
    return (
      <CustomerAuthRequired
        activeKey="wallet"
        title="My NOVARA Wallet"
        subtitle="Sign in to view your store credit balance, cashback rewards, and refund history."
      />
    );
  }

  return (
    <div className="bg-[#F4F7FF] py-7 sm:py-9 min-h-[70vh]">
      <AccountLayout activeKey="wallet">
        <div className="space-y-5">
          <div className="rounded-2xl border border-[#DCE6F7] bg-gradient-to-r from-[#0B1730] to-[#1155EE] p-6 text-white shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-blue-200">
                  Available Wallet Balance
                </p>
                <p className="font-mono-tabular mt-1 text-3xl font-extrabold">
                  {loading ? '...' : formatStoreCurrency(balance, currencyCfg)}
                </p>
              </div>
              <Wallet className="h-10 w-10 text-blue-200/80" />
            </div>
          </div>

          <div className="rounded-2xl border border-[#DCE6F7] bg-white p-6 shadow-xs">
            <h2 className="font-display mb-4 text-base font-bold text-[#0B1730]">Transaction Ledger</h2>
            {loading ? (
              <div className="h-28 animate-pulse rounded-xl bg-slate-100" />
            ) : transactions.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">
                No wallet transactions yet. Refunds or loyalty credits will appear here automatically.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-100 text-slate-500">
                    <tr>
                      <th className="py-2 pr-3">Date</th>
                      <th className="py-2 pr-3">Description</th>
                      <th className="py-2 pr-3">Source</th>
                      <th className="py-2 pr-3 text-right">Amount</th>
                      <th className="py-2 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {transactions.map((tx) => (
                      <tr key={tx.id}>
                        <td className="py-2.5 pr-3 text-slate-500">{new Date(tx.createdAt).toLocaleDateString()}</td>
                        <td className="py-2.5 pr-3 font-medium text-[#0B1730]">{tx.description}</td>
                        <td className="py-2.5 pr-3 uppercase text-slate-500">{tx.referenceId || tx.type}</td>
                        <td
                          className={`py-2.5 pr-3 text-right font-mono-tabular font-bold ${
                            tx.type === 'credit' || tx.type === 'refund' ? 'text-emerald-600' : 'text-rose-600'
                          }`}
                        >
                          {tx.type === 'credit' || tx.type === 'refund' ? '+' : '-'}
                          {formatStoreCurrency(tx.amount, currencyCfg)}
                        </td>
                        <td className="py-2.5 text-right font-mono-tabular">
                          {formatStoreCurrency(tx.balanceAfter, currencyCfg)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </AccountLayout>
    </div>
  );
}

interface LinkedProvidersPayload {
  initialAuthProvider: 'local' | 'google' | 'facebook';
  authMethodCount: number;
  linkedProviders: {
    local: boolean;
    google: boolean;
    facebook: boolean;
  };
  providers: Array<{
    provider: 'google' | 'facebook';
    email?: string;
    name?: string;
    picture?: string;
    linkedAt?: string;
    lastUsedAt?: string;
  }>;
}

interface AuthSessionRecord {
  sessionId: string;
  provider: 'local' | 'google' | 'facebook';
  userAgent?: string;
  ipAddress?: string;
  isCurrent: boolean;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

export function AccountSecurityPage() {
  useSeoMeta({ title: 'Account Security | NOVARA COMMERCE', noIndex: true });
  const dispatch = useAppDispatch();
  const { user } = useAppSelector((s) => s.auth);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [socialNewPassword, setSocialNewPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const [linkedInfo, setLinkedInfo] = useState<LinkedProvidersPayload | null>(null);
  const [sessions, setSessions] = useState<AuthSessionRecord[]>([]);
  const [oauthStatus, setOauthStatus] = useState({ google: false, facebook: false });
  const [busyProvider, setBusyProvider] = useState<'google' | 'facebook' | null>(null);
  const [sessionsBusy, setSessionsBusy] = useState(false);
  const expectedCallbackOriginRef = useRef<string | null>(null);
  const handledOAuthEventIdsRef = useRef<Set<string>>(new Set());
  const popupTimerRef = useRef<number | null>(null);
  const oauthPopupRef = useRef<Window | null>(null);

  const clearPopupTimer = useCallback(() => {
    if (popupTimerRef.current !== null) {
      window.clearInterval(popupTimerRef.current);
      popupTimerRef.current = null;
    }
  }, []);

  const loadSecurityData = useCallback(async () => {
    if (!user) return;
    const [providersRes, linkedRes, sessionsRes] = await Promise.all([
      apiRequest<{
        ok: true;
        providers: { googleConfigured?: boolean; facebookConfigured?: boolean; google: boolean; facebook: boolean };
      }>('/api/auth/providers').catch(() => null),
      apiRequest<{ ok: true } & LinkedProvidersPayload>('/api/auth/linked-providers').catch(() => null),
      apiRequest<{ ok: true; sessions: AuthSessionRecord[] }>('/api/auth/sessions').catch(() => null),
    ]);
    if (providersRes) {
      setOauthStatus({
        google: Boolean(providersRes.providers.googleConfigured ?? providersRes.providers.google),
        facebook: Boolean(providersRes.providers.facebookConfigured ?? providersRes.providers.facebook),
      });
    }
    if (linkedRes) {
      setLinkedInfo({
        initialAuthProvider: linkedRes.initialAuthProvider,
        authMethodCount: linkedRes.authMethodCount,
        linkedProviders: linkedRes.linkedProviders,
        providers: linkedRes.providers || [],
      });
    }
    if (sessionsRes) {
      setSessions(sessionsRes.sessions || []);
    }
  }, [user]);

  useEffect(() => {
    loadSecurityData();
  }, [loadSecurityData]);

  useEffect(() => {
    const processLinkPayload = (data: Record<string, unknown>) => {
      const eventId = typeof data.eventId === 'string' ? data.eventId : '';
      if (eventId) {
        if (handledOAuthEventIdsRef.current.has(eventId)) return;
        handledOAuthEventIdsRef.current.add(eventId);
      }

      if (data.type === 'OAUTH_LINK_SUCCESS' && data.user) {
        clearPopupTimer();
        setBusyProvider(null);
        safeClosePopupWindow(oauthPopupRef.current);
        oauthPopupRef.current = null;
        dispatch(setUserProfile(data.user as UserProfile));
        dispatch(
          showToast({
            variant: 'success',
            message: `${data.provider === 'google' ? 'Google' : 'Facebook'} connected to your account.`,
          }),
        );
        loadSecurityData();
      } else if (data.type === 'OAUTH_AUTH_ERROR' || data.type === 'OAUTH_LINK_REQUIRED' || data.type === 'OAUTH_EMAIL_REQUIRED') {
        clearPopupTimer();
        setBusyProvider(null);
        safeClosePopupWindow(oauthPopupRef.current);
        oauthPopupRef.current = null;
        dispatch(
          showToast({
            variant: 'error',
            message: String(data.error || 'Unable to connect social provider.'),
          }),
        );
      }
    };

    const onMessage = (event: MessageEvent) => {
      if (!isTrustedOAuthOrigin(event.origin, window.location.origin, [expectedCallbackOriginRef.current])) {
        return;
      }
      if (!event.data || typeof event.data !== 'object') return;
      processLinkPayload(event.data as Record<string, unknown>);
    };
    window.addEventListener('message', onMessage);

    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        channel = new BroadcastChannel(OAUTH_BROADCAST_CHANNEL);
        channel.onmessage = (event) => {
          if (!event.data || typeof event.data !== 'object') return;
          processLinkPayload(event.data as Record<string, unknown>);
        };
      } catch {
        channel = null;
      }
    }

    return () => {
      clearPopupTimer();
      window.removeEventListener('message', onMessage);
      if (channel) {
        try {
          channel.close();
        } catch {
          // Ignore close failures
        }
      }
    };
  }, [clearPopupTimer, dispatch, loadSecurityData]);

  if (!user) {
    return (
      <CustomerAuthRequired
        activeKey="security"
        title="Security & Connected Accounts"
        subtitle="Sign in to manage your password, connected social providers, and active sessions."
      />
    );
  }

  const handlePasswordChange = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await apiRequest<{ ok: true; message: string }>('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      dispatch(showToast({ variant: 'success', message: res.message }));
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      dispatch(showToast({ variant: 'error', message: err instanceof Error ? err.message : 'Password update failed' }));
    } finally {
      setSaving(false);
    }
  };

  const handleSetPassword = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await apiRequest<{ ok: true; user: UserProfile; message: string }>('/api/auth/set-password', {
        method: 'POST',
        body: JSON.stringify({ newPassword: socialNewPassword }),
      });
      dispatch(setUserProfile(res.user));
      dispatch(showToast({ variant: 'success', message: res.message }));
      setSocialNewPassword('');
      loadSecurityData();
    } catch (err) {
      dispatch(showToast({ variant: 'error', message: err instanceof Error ? err.message : 'Unable to set password.' }));
    } finally {
      setSaving(false);
    }
  };

  const handleConnectProvider = async (provider: 'google' | 'facebook') => {
    const configured = provider === 'google' ? oauthStatus.google : oauthStatus.facebook;
    const label = provider === 'google' ? 'Google' : 'Facebook';
    if (!configured) {
      dispatch(
        showToast({
          variant: 'warning',
          message: `${label} OAuth credentials are not configured on the server yet.`,
        }),
      );
      return;
    }

    clearPopupTimer();
    setBusyProvider(provider);
    try {
      const res = await apiRequest<{ ok: true; url: string; callbackOrigin?: string }>(
        `/api/auth/oauth/${provider}/url?intent=link&returnTo=${encodeURIComponent('/account/security')}`,
      );
      expectedCallbackOriginRef.current = res.callbackOrigin || window.location.origin;
      const popup = window.open(res.url, `novara_link_${provider}`, OAUTH_POPUP_WINDOW_FEATURES);
      if (!popup || popup.closed) {
        setBusyProvider(null);
        window.location.href = `/api/auth/oauth/${provider}?intent=link&mode=redirect&returnTo=${encodeURIComponent('/account/security')}`;
        return;
      }
      oauthPopupRef.current = popup;
      popupTimerRef.current = window.setInterval(() => {
        if (popup.closed) {
          clearPopupTimer();
          oauthPopupRef.current = null;
          setBusyProvider(null);
        }
      }, 450);
    } catch (err) {
      clearPopupTimer();
      oauthPopupRef.current = null;
      setBusyProvider(null);
      dispatch(
        showToast({
          variant: 'error',
          message: err instanceof Error ? err.message : `Unable to connect ${label}.`,
        }),
      );
    }
  };

  const handleDisconnectProvider = async (provider: 'google' | 'facebook') => {
    setBusyProvider(provider);
    try {
      const res = await apiRequest<{ ok: true; user: UserProfile; message: string }>(
        `/api/auth/unlink/${provider}`,
        { method: 'DELETE' },
      );
      dispatch(setUserProfile(res.user));
      dispatch(showToast({ variant: 'info', message: res.message }));
      loadSecurityData();
    } catch (err) {
      dispatch(
        showToast({
          variant: 'error',
          message: err instanceof Error ? err.message : 'Unable to disconnect provider.',
        }),
      );
    } finally {
      setBusyProvider(null);
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    setSessionsBusy(true);
    try {
      await apiRequest(`/api/auth/sessions/${encodeURIComponent(sessionId)}/revoke`, { method: 'POST' });
      dispatch(showToast({ variant: 'info', message: 'Session revoked.' }));
      loadSecurityData();
    } catch (err) {
      dispatch(showToast({ variant: 'error', message: err instanceof Error ? err.message : 'Failed to revoke session.' }));
    } finally {
      setSessionsBusy(false);
    }
  };

  const handleLogoutOtherDevices = async () => {
    setSessionsBusy(true);
    try {
      const res = await apiRequest<{ ok: true; revokedCount: number }>('/api/auth/logout-all', {
        method: 'POST',
        body: JSON.stringify({ includeCurrent: false }),
      });
      dispatch(showToast({ variant: 'success', message: `Signed out ${res.revokedCount} other session(s).` }));
      loadSecurityData();
    } catch (err) {
      dispatch(showToast({ variant: 'error', message: err instanceof Error ? err.message : 'Action failed.' }));
    } finally {
      setSessionsBusy(false);
    }
  };

  const hasPasswordMethod = linkedInfo ? linkedInfo.linkedProviders.local : Boolean(user.linkedProviders?.local ?? true);
  const canUnlink = (linkedInfo?.authMethodCount ?? 1) > 1;

  return (
    <div className="bg-[#F4F7FF] py-7 sm:py-9 min-h-[70vh]">
      <AccountLayout activeKey="security">
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {/* Password Management */}
            {hasPasswordMethod ? (
              <form onSubmit={handlePasswordChange} className="rounded-2xl border border-[#DCE6F7] bg-white p-6 shadow-xs space-y-4">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-[#1155EE]" />
                  <h1 className="font-display text-lg font-bold text-[#0B1730]">Change Password</h1>
                </div>
                <div>
                  <label htmlFor="sec-current-pw" className="mb-1 block text-xs font-semibold text-slate-700">
                    Current Password
                  </label>
                  <input
                    id="sec-current-pw"
                    type="password"
                    required
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="sec-new-pw" className="mb-1 block text-xs font-semibold text-slate-700">
                    New Password (8+ chars, upper, lower, number)
                  </label>
                  <input
                    id="sec-new-pw"
                    type="password"
                    required
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-[#1155EE] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#0B44CC] disabled:opacity-60"
                >
                  {saving ? 'Updating...' : 'Update Password'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleSetPassword} className="rounded-2xl border border-[#DCE6F7] bg-white p-6 shadow-xs space-y-4">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-[#1155EE]" />
                  <h1 className="font-display text-lg font-bold text-[#0B1730]">Set Account Password</h1>
                </div>
                <p className="text-xs leading-relaxed text-slate-600">
                  Your account was created via social sign-in. Set a password if you also want to sign in with email
                  and password, or disconnect a social login later.
                </p>
                <div>
                  <label htmlFor="sec-set-pw" className="mb-1 block text-xs font-semibold text-slate-700">
                    New Password (8+ chars, upper, lower, number)
                  </label>
                  <input
                    id="sec-set-pw"
                    type="password"
                    required
                    minLength={8}
                    value={socialNewPassword}
                    onChange={(e) => setSocialNewPassword(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-[#1155EE] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#0B44CC] disabled:opacity-60"
                >
                  {saving ? 'Saving...' : 'Create Password'}
                </button>
              </form>
            )}

            {/* Account Verification & Connected Social Providers */}
            <div className="rounded-2xl border border-[#DCE6F7] bg-white p-6 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-base font-bold text-[#0B1730] flex items-center gap-2">
                  <Link2 className="h-4 w-4 text-[#1155EE]" /> Connected Sign-In Methods
                </h2>
                {linkedInfo && (
                  <span className="rounded-full bg-[#EEF4FF] px-2.5 py-0.5 text-[11px] font-semibold text-[#1155EE] capitalize">
                    Joined: {linkedInfo.initialAuthProvider === 'local' ? 'Email' : linkedInfo.initialAuthProvider}
                  </span>
                )}
              </div>

              <div className="rounded-xl border border-[#EBF1FC] bg-[#F8FAFF] p-3.5 text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Email Verification</span>
                  {user.isVerified ? (
                    <span className="inline-flex items-center gap-1 font-bold text-emerald-700">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Verified
                    </span>
                  ) : (
                    <span className="font-semibold text-amber-700">Unverified</span>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600">Account Email</span>
                  <span className="font-semibold text-[#0B1730]">{user.email}</span>
                </div>
              </div>

              <div className="space-y-2.5">
                {(['google', 'facebook'] as const).map((prov) => {
                  const isConnected = Boolean(linkedInfo?.linkedProviders[prov] ?? user.linkedProviders?.[prov]);
                  const label = prov === 'google' ? 'Google' : 'Facebook';
                  const detail = linkedInfo?.providers.find((p) => p.provider === prov);
                  return (
                    <div
                      key={prov}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#E6EEF9] px-3.5 py-2.5 text-xs"
                    >
                      <div>
                        <p className="font-bold text-[#0B1730]">{label}</p>
                        <p className="text-[11px] text-slate-500">
                          {isConnected ? detail?.email || 'Connected to your account' : 'Not connected'}
                        </p>
                      </div>
                      {isConnected ? (
                        <button
                          type="button"
                          disabled={!canUnlink || busyProvider !== null}
                          onClick={() => handleDisconnectProvider(prov)}
                          title={!canUnlink ? 'Add a password or another sign-in method before disconnecting.' : undefined}
                          className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-3 py-1.5 font-semibold text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Unlink className="h-3.5 w-3.5" />
                          <span>{busyProvider === prov ? 'Updating...' : 'Disconnect'}</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busyProvider !== null}
                          onClick={() => handleConnectProvider(prov)}
                          className="inline-flex items-center gap-1 rounded-lg border border-[#C7DAFF] bg-[#F2F7FF] px-3 py-1.5 font-semibold text-[#1155EE] hover:bg-[#E4EEFF] disabled:opacity-50"
                        >
                          <Link2 className="h-3.5 w-3.5" />
                          <span>{busyProvider === prov ? 'Connecting...' : `Connect ${label}`}</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {!canUnlink && (
                <p className="text-[11px] text-slate-500">
                  At least one active sign-in method is required so you never lose access to your account.
                </p>
              )}
            </div>
          </div>

          {/* Active Sessions */}
          <div className="rounded-2xl border border-[#DCE6F7] bg-white p-6 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-bold text-[#0B1730] flex items-center gap-2">
                  <Monitor className="h-4 w-4 text-[#1155EE]" /> Active Sessions
                </h2>
                <p className="text-xs text-slate-500">Devices currently signed in to your NOVARA account.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {sessions.length > 1 && (
                  <button
                    type="button"
                    disabled={sessionsBusy}
                    onClick={handleLogoutOtherDevices}
                    className="rounded-xl border border-slate-300 px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Sign Out Other Devices
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => dispatch(logoutUser())}
                  className="rounded-xl border border-rose-200 px-3.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                >
                  Sign Out Current Session
                </button>
              </div>
            </div>

            {sessions.length === 0 ? (
              <p className="text-xs text-slate-500">Your current authenticated browser session is active.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {sessions.map((s) => (
                  <div key={s.sessionId} className="flex flex-wrap items-center justify-between gap-3 py-3 text-xs">
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-[#0B1730] capitalize">{s.provider} sign-in</span>
                        {s.isCurrent && (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                            This Device
                          </span>
                        )}
                      </div>
                      <p className="truncate max-w-md text-[11px] text-slate-500">
                        {s.userAgent || 'Browser session'}
                        {s.ipAddress ? ` · IP ${s.ipAddress}` : ''}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        Last active {new Date(s.lastSeenAt).toLocaleString()}
                      </p>
                    </div>
                    {!s.isCurrent && (
                      <button
                        type="button"
                        disabled={sessionsBusy}
                        onClick={() => handleRevokeSession(s.sessionId)}
                        className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2.5 py-1 font-semibold text-rose-600 hover:bg-rose-50"
                      >
                        <Trash2 className="h-3 w-3" /> Revoke
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </AccountLayout>
    </div>
  );
}
