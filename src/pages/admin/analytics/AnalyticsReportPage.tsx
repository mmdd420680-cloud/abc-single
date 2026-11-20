import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, ChevronLeft, ChevronRight, Download, Search, ShieldCheck, Users } from 'lucide-react';
import { AdminLayout, PermissionGuard } from '../../../layouts/AdminLayout';
import { AdminPageHeader, ErrorBanner, LoadingCards } from '../../../components/admin/ui';
import {
  OrderStatusDonutChart,
  ProviderRegistrationTrendChart,
  SalesOverviewChart,
} from '../../../components/admin/AdminCharts';
import { UserAvatar } from '../../../components/ui/UserAvatar';
import { apiRequest, downloadAuthenticatedFile } from '../../../services/api';
import { useAppDispatch } from '../../../app/hooks';
import { showToast } from '../../../features/notifications/toastSlice';
import { useSeoMeta } from '../../../lib/useSeoMeta';

export type AnalyticsMetric = 'sales' | 'revenue' | 'products' | 'customers' | 'inventory';

const METRIC_META: Record<AnalyticsMetric, { title: string; subtitle: string }> = {
  sales: { title: 'Sales Analytics', subtitle: 'Order velocity, conversion breakdown by payment method, and regional demand.' },
  revenue: { title: 'Revenue Analytics', subtitle: 'Daily net revenue trajectory, discounts applied, and division revenue share.' },
  products: { title: 'Product Performance', subtitle: 'Top-performing SKUs ranked by units sold, ratings, and estimated gross revenue.' },
  customers: {
    title: 'Customer & Authentication Analytics',
    subtitle: 'Provider-wise registration origins, daily signup trends, linked methods, and top lifetime-value buyers.',
  },
  inventory: { title: 'Inventory Reports', subtitle: 'Catalog stock valuation by publish status and warehouse unit counts.' },
};

interface AnalyticsData {
  days: number;
  ordersByPayment: Array<{ _id: string; count: number; total: number }>;
  ordersByDivision: Array<{ _id: string; count: number; total: number }>;
  topProducts: Array<{
    id: string;
    name: string;
    sku: string;
    soldCount: number;
    availableStock: number;
    revenueEstimate: number;
    ratingAverage: number;
  }>;
  topCustomers: Array<{
    _id: string;
    customerName: string;
    customerEmail: string;
    orderCount: number;
    totalSpent: number;
  }>;
  inventorySummary: Array<{ _id: string; count: number; totalUnits: number; stockValue: number }>;
  dailyRevenue: Array<{ _id: string; orders: number; revenue: number; discount: number }>;
  wishlistSummary?: {
    totalActiveWishlists: number;
    totalSavedItems: number;
    topWishlistedProducts: Array<{
      id: string;
      name: string;
      slug: string;
      sku: string;
      wishlistCount: number;
      price: number;
      availableStock: number;
      imageUrl?: string;
    }>;
  };
}

interface ProviderStatsResponse {
  summary: {
    totalRegisteredUsers: number;
    localUsers: number;
    googleUsers: number;
    facebookUsers: number;
    localSharePct: number;
    googleSharePct: number;
    facebookSharePct: number;
    multiLinkedUsers: number;
    verifiedUsers: number;
  };
  dailyTrends: Array<{ date: string; label: string; local: number; google: number; facebook: number; total: number }>;
}

interface ProviderBreakdownUser {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  isVerified: boolean;
  initialAuthProvider: 'local' | 'google' | 'facebook';
  linkedProviders: {
    local: boolean;
    google: boolean;
    facebook: boolean;
  };
  createdAt: string;
  lastLoginAt: string | null;
}

interface ProviderBreakdownResponse {
  users: ProviderBreakdownUser[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

const ORIGIN_BADGE_MAP: Record<'local' | 'google' | 'facebook', { label: string; classes: string }> = {
  local: { label: 'Email / Password', classes: 'bg-slate-500/10 text-slate-700 dark:text-slate-200' },
  google: { label: 'Google', classes: 'bg-emerald-500/10 text-emerald-600' },
  facebook: { label: 'Facebook', classes: 'bg-blue-500/10 text-[#1877F2]' },
};

export function AnalyticsReportPage({ metric = 'sales' }: { metric?: AnalyticsMetric }) {
  const meta = METRIC_META[metric] || METRIC_META.sales;
  useSeoMeta({ title: `${meta.title} | NOVARA Admin`, noIndex: true });
  const dispatch = useAppDispatch();

  const [days, setDays] = useState(30);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [providerFilter, setProviderFilter] = useState<'' | 'local' | 'google' | 'facebook'>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);

  const [authStats, setAuthStats] = useState<ProviderStatsResponse | null>(null);
  const [breakdown, setBreakdown] = useState<ProviderBreakdownResponse | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{ ok: true } & AnalyticsData>(`/api/admin/reports/analytics?days=${days}`);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load analytics report.');
    } finally {
      setLoading(false);
    }
  }, [days]);

  const loadCustomerAuthAnalytics = useCallback(async () => {
    if (metric !== 'customers') return;
    setAuthLoading(true);
    try {
      const statsParams = new URLSearchParams({ days: String(days) });
      if (fromDate) statsParams.set('from', fromDate);
      if (toDate) statsParams.set('to', toDate);

      const listParams = new URLSearchParams({ page: String(page), limit: '10' });
      if (providerFilter) listParams.set('provider', providerFilter);
      if (searchQuery.trim()) listParams.set('q', searchQuery.trim());
      if (fromDate) listParams.set('from', fromDate);
      if (toDate) listParams.set('to', toDate);

      const [trendsRes, breakdownRes] = await Promise.all([
        apiRequest<{ ok: true } & ProviderStatsResponse>(
          `/api/admin/users/registration-trends?${statsParams.toString()}`,
        ),
        apiRequest<{ ok: true } & ProviderBreakdownResponse>(
          `/api/admin/users/provider-breakdown?${listParams.toString()}`,
        ),
      ]);
      setAuthStats({ summary: trendsRes.summary, dailyTrends: trendsRes.dailyTrends });
      setBreakdown({ users: breakdownRes.users, pagination: breakdownRes.pagination });
    } catch {
      // Fall back gracefully without hiding lifetime-value table
    } finally {
      setAuthLoading(false);
    }
  }, [metric, days, fromDate, toDate, providerFilter, searchQuery, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadCustomerAuthAnalytics();
  }, [loadCustomerAuthAnalytics]);

  const series = (data?.dailyRevenue || []).map((d) => ({
    date: d._id,
    label: d._id.slice(5),
    revenue: d.revenue,
    orders: d.orders,
  }));

  const paymentColors = ['#145CFF', '#10B981', '#F59E0B', '#6366F1'];
  const paymentTotal = Math.max(1, (data?.ordersByPayment || []).reduce((s, p) => s + p.count, 0));

  return (
    <AdminLayout>
      <PermissionGuard permission="reports.view">
        <div className="space-y-5 max-w-[1440px] mx-auto">
          <AdminPageHeader
            title={meta.title}
            subtitle={meta.subtitle}
            breadcrumbs={[{ label: 'Reports & Analytics' }, { label: meta.title }]}
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                  aria-label="Analytics period"
                  className="h-9 rounded-xl border border-[#E4EAF5] dark:border-slate-700 bg-white dark:bg-[#0B1730] px-3 text-xs font-semibold"
                >
                  <option value={7}>Last 7 Days</option>
                  <option value={30}>Last 30 Days</option>
                  <option value={90}>Last 90 Days</option>
                </select>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await downloadAuthenticatedFile('/api/admin/reports/sales-csv', 'novara-sales-report.csv');
                    } catch (err) {
                      dispatch(
                        showToast({
                          variant: 'error',
                          message: err instanceof Error ? err.message : 'Unable to export sales CSV.',
                        }),
                      );
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#145CFF] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0E47D9]"
                >
                  <Download className="h-3.5 w-3.5" /> Export Sales CSV
                </button>
              </div>
            }
          />

          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { to: '/admin/analytics/sales', key: 'sales', label: 'Sales Analytics' },
                { to: '/admin/analytics/revenue', key: 'revenue', label: 'Revenue Analytics' },
                { to: '/admin/analytics/products', key: 'products', label: 'Product Performance' },
                { to: '/admin/analytics/customers', key: 'customers', label: 'Customer Analytics' },
                { to: '/admin/analytics/inventory', key: 'inventory', label: 'Inventory Reports' },
              ] as const
            ).map((t) => (
              <Link
                key={t.key}
                to={t.to}
                className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  metric === t.key
                    ? 'bg-[#145CFF] text-white'
                    : 'border border-[#E4EAF5] dark:border-slate-800 bg-white dark:bg-[#0B1730] text-[#64748B] dark:text-slate-300'
                }`}
              >
                {t.label}
              </Link>
            ))}
          </div>

          {error && <ErrorBanner message={error} onRetry={load} />}
          {loading ? (
            <LoadingCards count={3} />
          ) : data ? (
            <div className="space-y-5">
              {(metric === 'sales' || metric === 'revenue') && (
                <div className="grid gap-5 lg:grid-cols-3">
                  <div className="lg:col-span-2 rounded-2xl border border-[#E4EAF5] dark:border-slate-800 bg-white dark:bg-[#0B1730] p-5 shadow-xs">
                    <h3 className="font-display text-sm font-bold mb-3 flex items-center gap-2">
                      <BarChart3 className="h-4 w-4 text-[#145CFF]" /> Daily Revenue Trend ({days}d)
                    </h3>
                    <SalesOverviewChart series={series} />
                  </div>
                  <div className="rounded-2xl border border-[#E4EAF5] dark:border-slate-800 bg-white dark:bg-[#0B1730] p-5 shadow-xs">
                    <h3 className="font-display text-sm font-bold mb-3">Payment Channel Mix</h3>
                    <OrderStatusDonutChart
                      totalOrders={data.ordersByPayment.reduce((s, p) => s + p.count, 0)}
                      segments={data.ordersByPayment.map((p, idx) => ({
                        key: p._id || 'other',
                        label: (p._id || 'Other').toUpperCase(),
                        count: p.count,
                        percent: Number(((p.count / paymentTotal) * 100).toFixed(1)),
                        color: paymentColors[idx % paymentColors.length],
                      }))}
                    />
                  </div>
                </div>
              )}

              {metric === 'sales' && (
                <div className="rounded-2xl border border-[#E4EAF5] dark:border-slate-800 bg-white dark:bg-[#0B1730] p-5 shadow-xs space-y-3">
                  <h3 className="font-display text-sm font-bold">Revenue by Bangladesh Division</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-[#E4EAF5] dark:border-slate-800 text-[#64748B]">
                        <tr>
                          <th className="py-2 pr-3">Division</th>
                          <th className="py-2 pr-3 text-center">Orders</th>
                          <th className="py-2 text-right">Total Revenue</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {data.ordersByDivision.map((d) => (
                          <tr key={d._id || 'unknown'}>
                            <td className="py-2.5 pr-3 font-semibold">{d._id || 'Unspecified'}</td>
                            <td className="py-2.5 pr-3 text-center font-mono-tabular">{d.count}</td>
                            <td className="py-2.5 text-right font-mono-tabular font-bold">
                              ৳{d.total.toLocaleString('en-IN')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {metric === 'products' && (
                <div className="rounded-2xl border border-[#E4EAF5] dark:border-slate-800 bg-white dark:bg-[#0B1730] p-5 shadow-xs space-y-3">
                  <h3 className="font-display text-sm font-bold">Top Performing Products</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-[#E4EAF5] dark:border-slate-800 text-[#64748B]">
                        <tr>
                          <th className="py-2 pr-3">Product & SKU</th>
                          <th className="py-2 pr-3 text-center">Units Sold</th>
                          <th className="py-2 pr-3 text-center">Available Stock</th>
                          <th className="py-2 pr-3 text-center">Rating</th>
                          <th className="py-2 text-right">Est. Revenue</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {data.topProducts.map((p) => (
                          <tr key={p.id}>
                            <td className="py-2.5 pr-3">
                              <Link to={`/admin/products/${p.id}`} className="font-semibold text-[#145CFF] hover:underline">
                                {p.name}
                              </Link>
                              <div className="font-mono-tabular text-[11px] text-[#64748B]">{p.sku}</div>
                            </td>
                            <td className="py-2.5 pr-3 text-center font-mono-tabular font-semibold">{p.soldCount}</td>
                            <td className="py-2.5 pr-3 text-center font-mono-tabular">{p.availableStock}</td>
                            <td className="py-2.5 pr-3 text-center font-mono-tabular">{p.ratingAverage.toFixed(1)}</td>
                            <td className="py-2.5 text-right font-mono-tabular font-bold">
                              ৳{p.revenueEstimate.toLocaleString('en-IN')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {data.wishlistSummary && (
                    <div className="mt-5 border-t border-[#E4EAF5] dark:border-slate-800 pt-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h4 className="font-display text-sm font-bold text-[#101B35] dark:text-white">
                          Top Wishlisted Products
                        </h4>
                        <div className="flex items-center gap-3 text-xs text-[#64748B]">
                          <span>
                            Active Wishlists:{' '}
                            <strong className="font-mono-tabular text-[#101B35] dark:text-white">
                              {data.wishlistSummary.totalActiveWishlists}
                            </strong>
                          </span>
                          <span>
                            Saved Items:{' '}
                            <strong className="font-mono-tabular text-[#145CFF]">
                              {data.wishlistSummary.totalSavedItems}
                            </strong>
                          </span>
                        </div>
                      </div>
                      {data.wishlistSummary.topWishlistedProducts.length === 0 ? (
                        <p className="text-xs text-[#64748B]">No saved wishlist items recorded yet.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs">
                            <thead className="border-b border-[#E4EAF5] dark:border-slate-800 text-[#64748B]">
                              <tr>
                                <th className="py-2 pr-3">Product &amp; SKU</th>
                                <th className="py-2 pr-3 text-center">Saved Count</th>
                                <th className="py-2 pr-3 text-center">Available Stock</th>
                                <th className="py-2 text-right">Current Price</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                              {data.wishlistSummary.topWishlistedProducts.map((w) => (
                                <tr key={w.id}>
                                  <td className="py-2.5 pr-3">
                                    <Link to={`/admin/products/${w.id}`} className="font-semibold text-[#145CFF] hover:underline">
                                      {w.name}
                                    </Link>
                                    <div className="font-mono-tabular text-[11px] text-[#64748B]">{w.sku}</div>
                                  </td>
                                  <td className="py-2.5 pr-3 text-center font-mono-tabular font-bold text-rose-600">
                                    {w.wishlistCount}
                                  </td>
                                  <td className="py-2.5 pr-3 text-center font-mono-tabular">{w.availableStock}</td>
                                  <td className="py-2.5 text-right font-mono-tabular font-bold">
                                    ৳{w.price.toLocaleString('en-IN')}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {metric === 'customers' && (
                <div className="space-y-5">
                  {authStats && (
                    <>
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                        <div className="rounded-2xl border border-[#E4EAF5] dark:border-slate-800 bg-white dark:bg-[#0B1730] p-4 shadow-xs">
                          <div className="flex items-center justify-between text-[11px] font-semibold uppercase text-[#64748B]">
                            <span>Total Registered Users</span>
                            <Users className="h-4 w-4 text-[#145CFF]" />
                          </div>
                          <div className="mt-1.5 font-display font-mono-tabular text-2xl font-bold text-[#101B35] dark:text-white">
                            {authStats.summary.totalRegisteredUsers.toLocaleString()}
                          </div>
                          <div className="mt-0.5 text-[11px] text-[#64748B]">
                            {authStats.summary.verifiedUsers.toLocaleString()} verified accounts
                          </div>
                        </div>

                        <div className="rounded-2xl border border-[#E4EAF5] dark:border-slate-800 bg-white dark:bg-[#0B1730] p-4 shadow-xs">
                          <div className="text-[11px] font-semibold uppercase text-[#64748B]">Email / Password</div>
                          <div className="mt-1.5 flex items-baseline justify-between">
                            <span className="font-display font-mono-tabular text-2xl font-bold text-[#145CFF]">
                              {authStats.summary.localUsers.toLocaleString()}
                            </span>
                            <span className="font-mono-tabular text-xs font-bold text-[#101B35] dark:text-slate-200">
                              {authStats.summary.localSharePct.toFixed(1)}%
                            </span>
                          </div>
                          <div className="mt-0.5 text-[11px] text-[#64748B]">Original email signups</div>
                        </div>

                        <div className="rounded-2xl border border-[#E4EAF5] dark:border-slate-800 bg-white dark:bg-[#0B1730] p-4 shadow-xs">
                          <div className="text-[11px] font-semibold uppercase text-[#64748B]">Google OAuth</div>
                          <div className="mt-1.5 flex items-baseline justify-between">
                            <span className="font-display font-mono-tabular text-2xl font-bold text-emerald-600">
                              {authStats.summary.googleUsers.toLocaleString()}
                            </span>
                            <span className="font-mono-tabular text-xs font-bold text-[#101B35] dark:text-slate-200">
                              {authStats.summary.googleSharePct.toFixed(1)}%
                            </span>
                          </div>
                          <div className="mt-0.5 text-[11px] text-[#64748B]">Original Google signups</div>
                        </div>

                        <div className="rounded-2xl border border-[#E4EAF5] dark:border-slate-800 bg-white dark:bg-[#0B1730] p-4 shadow-xs">
                          <div className="text-[11px] font-semibold uppercase text-[#64748B]">Facebook OAuth</div>
                          <div className="mt-1.5 flex items-baseline justify-between">
                            <span className="font-display font-mono-tabular text-2xl font-bold text-[#1877F2]">
                              {authStats.summary.facebookUsers.toLocaleString()}
                            </span>
                            <span className="font-mono-tabular text-xs font-bold text-[#101B35] dark:text-slate-200">
                              {authStats.summary.facebookSharePct.toFixed(1)}%
                            </span>
                          </div>
                          <div className="mt-0.5 text-[11px] text-[#64748B]">Original Facebook signups</div>
                        </div>

                        <div className="rounded-2xl border border-[#E4EAF5] dark:border-slate-800 bg-white dark:bg-[#0B1730] p-4 shadow-xs">
                          <div className="text-[11px] font-semibold uppercase text-[#64748B]">Multi-Provider Linked</div>
                          <div className="mt-1.5 font-display font-mono-tabular text-2xl font-bold text-indigo-600">
                            {authStats.summary.multiLinkedUsers.toLocaleString()}
                          </div>
                          <div className="mt-0.5 text-[11px] text-[#64748B]">2+ sign-in methods active</div>
                        </div>
                      </div>

                      <div className="grid gap-5 lg:grid-cols-3">
                        <div className="rounded-2xl border border-[#E4EAF5] dark:border-slate-800 bg-white dark:bg-[#0B1730] p-5 shadow-xs">
                          <h3 className="font-display text-sm font-bold mb-3">Registration Origin Share</h3>
                          <OrderStatusDonutChart
                            totalOrders={authStats.summary.totalRegisteredUsers}
                            centerLabel="Total Users"
                            segments={[
                              {
                                key: 'local',
                                label: 'Email / Password',
                                count: authStats.summary.localUsers,
                                percent: authStats.summary.localSharePct,
                                color: '#145CFF',
                              },
                              {
                                key: 'google',
                                label: 'Google OAuth',
                                count: authStats.summary.googleUsers,
                                percent: authStats.summary.googleSharePct,
                                color: '#10B981',
                              },
                              {
                                key: 'facebook',
                                label: 'Facebook OAuth',
                                count: authStats.summary.facebookUsers,
                                percent: authStats.summary.facebookSharePct,
                                color: '#1877F2',
                              },
                            ]}
                          />
                        </div>

                        <div className="lg:col-span-2 rounded-2xl border border-[#E4EAF5] dark:border-slate-800 bg-white dark:bg-[#0B1730] p-5 shadow-xs">
                          <h3 className="font-display text-sm font-bold mb-3 flex items-center gap-2">
                            <BarChart3 className="h-4 w-4 text-[#145CFF]" /> Daily Registration Trend by Provider ({days}d)
                          </h3>
                          <ProviderRegistrationTrendChart series={authStats.dailyTrends} />
                        </div>
                      </div>
                    </>
                  )}

                  <div className="rounded-2xl border border-[#E4EAF5] dark:border-slate-800 bg-white dark:bg-[#0B1730] p-5 shadow-xs space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="font-display text-sm font-bold">Provider Breakdown User Directory</h3>
                        <p className="text-xs text-[#64748B]">
                          Unique users categorized by immutable initial registration method with linked login methods shown separately.
                        </p>
                      </div>
                      <div className="flex w-full sm:w-auto flex-wrap items-center gap-2">
                        <div className="relative w-full sm:w-44">
                          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#64748B]" />
                          <input
                            value={searchQuery}
                            onChange={(e) => {
                              setSearchQuery(e.target.value);
                              setPage(1);
                            }}
                            placeholder="Search name or email"
                            className="h-9 w-full rounded-xl border border-[#E4EAF5] dark:border-slate-700 bg-[#F4F7FF] dark:bg-slate-900 pl-8 pr-3 text-xs"
                          />
                        </div>
                        <select
                          aria-label="Filter by provider"
                          value={providerFilter}
                          onChange={(e) => {
                            setProviderFilter(e.target.value as '' | 'local' | 'google' | 'facebook');
                            setPage(1);
                          }}
                          className="h-9 w-full sm:w-auto rounded-xl border border-[#E4EAF5] dark:border-slate-700 bg-white dark:bg-[#0B1730] px-2.5 text-xs font-semibold"
                        >
                          <option value="">All Providers</option>
                          <option value="local">Email / Password</option>
                          <option value="google">Google OAuth</option>
                          <option value="facebook">Facebook OAuth</option>
                        </select>
                        <input
                          type="date"
                          aria-label="From date"
                          value={fromDate}
                          onChange={(e) => {
                            setFromDate(e.target.value);
                            setPage(1);
                          }}
                          className="h-9 w-full sm:w-auto rounded-xl border border-[#E4EAF5] dark:border-slate-700 bg-white dark:bg-[#0B1730] px-2.5 text-xs"
                        />
                        <input
                          type="date"
                          aria-label="To date"
                          value={toDate}
                          onChange={(e) => {
                            setToDate(e.target.value);
                            setPage(1);
                          }}
                          className="h-9 w-full sm:w-auto rounded-xl border border-[#E4EAF5] dark:border-slate-700 bg-white dark:bg-[#0B1730] px-2.5 text-xs"
                        />
                      </div>
                    </div>

                    {authLoading && !breakdown ? (
                      <LoadingCards count={1} />
                    ) : breakdown && breakdown.users.length > 0 ? (
                      <>
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs">
                            <thead className="border-b border-[#E4EAF5] dark:border-slate-800 text-[#64748B]">
                              <tr>
                                <th className="py-2 pr-3">User</th>
                                <th className="py-2 pr-3">Original Signup</th>
                                <th className="py-2 pr-3">Linked Methods</th>
                                <th className="py-2 pr-3 text-center">Verification</th>
                                <th className="py-2 text-right">Registered</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                              {breakdown.users.map((u) => {
                                const originBadge = ORIGIN_BADGE_MAP[u.initialAuthProvider] || ORIGIN_BADGE_MAP.local;
                                return (
                                  <tr key={u.id}>
                                    <td className="py-2.5 pr-3">
                                      <div className="flex items-center gap-2.5">
                                        <UserAvatar user={{ name: u.name, email: u.email }} size="xs" />
                                        <div>
                                          <Link
                                            to={`/admin/customers/${u.id}`}
                                            className="font-semibold text-[#101B35] dark:text-white hover:text-[#145CFF]"
                                          >
                                            {u.name}
                                          </Link>
                                          <div className="text-[11px] text-[#64748B]">{u.email}</div>
                                        </div>
                                      </div>
                                    </td>
                                    <td className="py-2.5 pr-3">
                                      <span
                                        className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold ${originBadge.classes}`}
                                      >
                                        {originBadge.label}
                                      </span>
                                    </td>
                                    <td className="py-2.5 pr-3">
                                      <div className="flex flex-wrap gap-1">
                                        {u.linkedProviders.local && (
                                          <span className="rounded-md bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold">
                                            Email
                                          </span>
                                        )}
                                        {u.linkedProviders.google && (
                                          <span className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600">
                                            Google
                                          </span>
                                        )}
                                        {u.linkedProviders.facebook && (
                                          <span className="rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#1877F2]">
                                            Facebook
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="py-2.5 pr-3 text-center">
                                      {u.isVerified ? (
                                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
                                          <ShieldCheck className="h-3 w-3" /> Verified
                                        </span>
                                      ) : (
                                        <span className="inline-flex rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-600">
                                          Unverified
                                        </span>
                                      )}
                                    </td>
                                    <td className="py-2.5 text-right font-mono-tabular text-[11px] text-[#64748B]">
                                      {new Date(u.createdAt).toLocaleDateString()}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        <div className="flex items-center justify-between pt-2 text-xs text-[#64748B]">
                          <span>
                            Page {breakdown.pagination.page} of {breakdown.pagination.totalPages} (
                            {breakdown.pagination.total.toLocaleString()} total users)
                          </span>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={breakdown.pagination.page <= 1}
                              onClick={() => setPage((p) => Math.max(1, p - 1))}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#E4EAF5] dark:border-slate-700 disabled:opacity-40"
                              aria-label="Previous page"
                            >
                              <ChevronLeft className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              disabled={breakdown.pagination.page >= breakdown.pagination.totalPages}
                              onClick={() => setPage((p) => p + 1)}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#E4EAF5] dark:border-slate-700 disabled:opacity-40"
                              aria-label="Next page"
                            >
                              <ChevronRight className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-[#64748B] py-4 text-center">
                        No users match the selected authentication provider filters.
                      </p>
                    )}
                  </div>

                  <div className="rounded-2xl border border-[#E4EAF5] dark:border-slate-800 bg-white dark:bg-[#0B1730] p-5 shadow-xs space-y-3">
                    <h3 className="font-display text-sm font-bold">Top Customers by Lifetime Value</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="border-b border-[#E4EAF5] dark:border-slate-800 text-[#64748B]">
                          <tr>
                            <th className="py-2 pr-3">Customer</th>
                            <th className="py-2 pr-3 text-center">Orders</th>
                            <th className="py-2 text-right">Total Spent</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {data.topCustomers.map((c, idx) => (
                            <tr key={c._id || idx}>
                              <td className="py-2.5 pr-3">
                                <div className="font-semibold">{c.customerName}</div>
                                <div className="text-[11px] text-[#64748B]">{c.customerEmail}</div>
                              </td>
                              <td className="py-2.5 pr-3 text-center font-mono-tabular">{c.orderCount}</td>
                              <td className="py-2.5 text-right font-mono-tabular font-bold">
                                ৳{c.totalSpent.toLocaleString('en-IN')}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {metric === 'inventory' && (
                <div className="rounded-2xl border border-[#E4EAF5] dark:border-slate-800 bg-white dark:bg-[#0B1730] p-5 shadow-xs space-y-3">
                  <h3 className="font-display text-sm font-bold">Inventory Valuation Summary</h3>
                  <div className="grid gap-4 sm:grid-cols-3">
                    {data.inventorySummary.map((row) => (
                      <div key={row._id} className="rounded-xl border border-[#E4EAF5] dark:border-slate-800 bg-[#F8FAFF] dark:bg-slate-900/60 p-4">
                        <div className="text-xs font-semibold uppercase text-[#64748B]">{row._id} SKUs</div>
                        <div className="font-mono-tabular mt-1 text-xl font-bold text-[#101B35] dark:text-white">
                          ৳{row.stockValue.toLocaleString('en-IN')}
                        </div>
                        <div className="mt-1 text-xs text-[#64748B]">
                          {row.count} products · {row.totalUnits.toLocaleString('en-IN')} total units
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </PermissionGuard>
    </AdminLayout>
  );
}
