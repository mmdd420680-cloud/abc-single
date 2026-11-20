import { useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle, CheckCircle2, Copy, Globe, Lock, Save, XCircle } from 'lucide-react';
import { AdminLayout, PermissionGuard } from '../../../layouts/AdminLayout';
import { AdminPageHeader, ErrorBanner, LoadingCards } from '../../../components/admin/ui';
import { useAdminSettings } from './useAdminSettings';
import { useAppDispatch } from '../../../app/hooks';
import { showToast } from '../../../features/notifications/toastSlice';
import { useSeoMeta } from '../../../lib/useSeoMeta';

export function SecuritySettingsPage() {
  useSeoMeta({ title: 'Security Settings | NOVARA Admin', noIndex: true });
  const dispatch = useAppDispatch();
  const { config, integrations, oauthCallbacks, authWarnings, loading, saving, error, load, savePatch } =
    useAdminSettings();

  const [requireEmailVerification, setRequireEmailVerification] = useState(false);
  const [sessionTimeoutHours, setSessionTimeoutHours] = useState('72');
  const [maxLoginAttempts, setMaxLoginAttempts] = useState('10');
  const [maintenanceBypassAdmin, setMaintenanceBypassAdmin] = useState(true);

  useEffect(() => {
    const s = config?.securitySettings;
    if (!s) return;
    setRequireEmailVerification(Boolean(s.requireEmailVerification));
    setSessionTimeoutHours(String(s.sessionTimeoutHours ?? 72));
    setMaxLoginAttempts(String(s.maxLoginAttempts ?? 10));
    setMaintenanceBypassAdmin(Boolean(s.maintenanceBypassAdmin ?? true));
  }, [config]);

  const handleCopy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      dispatch(showToast({ variant: 'success', message: `${label} copied to clipboard.` }));
    } catch {
      dispatch(showToast({ variant: 'error', message: 'Unable to copy to clipboard.' }));
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await savePatch(
      {
        securitySettings: {
          requireEmailVerification,
          sessionTimeoutHours: Number(sessionTimeoutHours || 72),
          maxLoginAttempts: Number(maxLoginAttempts || 10),
          maintenanceBypassAdmin,
        },
      },
      'Security policies saved.',
    );
  };

  const googleConfigured = Boolean(integrations?.googleOAuth);
  const facebookConfigured = Boolean(integrations?.facebookOAuth);

  return (
    <AdminLayout>
      <PermissionGuard permission="settings.manage">
        <div className="space-y-5 max-w-[920px] mx-auto">
          <AdminPageHeader
            title="Security Settings"
            subtitle="Configure session expiry windows, brute-force attempt caps, OAuth provider readiness, and maintenance bypass policies."
            breadcrumbs={[{ label: 'System Settings' }, { label: 'Security Settings' }]}
          />

          {error && <ErrorBanner message={error} onRetry={load} />}
          {loading ? (
            <LoadingCards count={2} />
          ) : (
            <>
              <form
                onSubmit={handleSubmit}
                className="rounded-2xl border border-[#E4EAF5] dark:border-slate-800 bg-white dark:bg-[#0B1730] p-6 shadow-xs space-y-5"
              >
                <h2 className="font-display text-sm font-bold flex items-center gap-2">
                  <Lock className="h-4 w-4 text-[#145CFF]" /> Session & Authentication Controls
                </h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold">Session Expiration (Hours)</label>
                    <input
                      type="number"
                      min={1}
                      max={720}
                      value={sessionTimeoutHours}
                      onChange={(e) => setSessionTimeoutHours(e.target.value)}
                      className="w-full h-10 rounded-xl border border-[#E4EAF5] dark:border-slate-700 bg-[#F4F7FF] dark:bg-slate-900 px-3 font-mono-tabular text-xs"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold">Max Login Attempts</label>
                    <input
                      type="number"
                      min={3}
                      max={100}
                      value={maxLoginAttempts}
                      onChange={(e) => setMaxLoginAttempts(e.target.value)}
                      className="w-full h-10 rounded-xl border border-[#E4EAF5] dark:border-slate-700 bg-[#F4F7FF] dark:bg-slate-900 px-3 font-mono-tabular text-xs"
                    />
                  </div>
                </div>
                <div className="space-y-3">
                  <label className="flex items-center justify-between rounded-xl border border-[#E4EAF5] dark:border-slate-800 bg-[#F8FAFF] dark:bg-slate-900/50 p-3.5 text-xs font-semibold cursor-pointer">
                    <span>Require Email Verification Before Checkout</span>
                    <input
                      type="checkbox"
                      checked={requireEmailVerification}
                      onChange={(e) => setRequireEmailVerification(e.target.checked)}
                      className="h-4 w-4 rounded text-[#145CFF]"
                    />
                  </label>
                  <label className="flex items-center justify-between rounded-xl border border-[#E4EAF5] dark:border-slate-800 bg-[#F8FAFF] dark:bg-slate-900/50 p-3.5 text-xs font-semibold cursor-pointer">
                    <span>Allow Staff Bypass During Maintenance Mode</span>
                    <input
                      type="checkbox"
                      checked={maintenanceBypassAdmin}
                      onChange={(e) => setMaintenanceBypassAdmin(e.target.checked)}
                      className="h-4 w-4 rounded text-[#145CFF]"
                    />
                  </label>
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-xl bg-[#145CFF] px-6 py-2.5 text-xs font-semibold text-white hover:bg-[#0E47D9] disabled:opacity-50"
                  >
                    <Save className="h-4 w-4" />
                    {saving ? 'Saving...' : 'Save Security Settings'}
                  </button>
                </div>
              </form>

              <div className="rounded-2xl border border-[#E4EAF5] dark:border-slate-800 bg-white dark:bg-[#0B1730] p-6 shadow-xs space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="font-display text-sm font-bold flex items-center gap-2">
                      <Globe className="h-4 w-4 text-[#145CFF]" /> OAuth 2.0 Provider Status &amp; Authorized Callback URLs
                    </h2>
                    <p className="mt-0.5 text-xs text-[#64748B]">
                      Register these exact redirect URIs in Google Cloud Console and Meta for Developers. Credentials live exclusively in server environment variables.
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex items-center justify-between rounded-xl border border-[#E4EAF5] dark:border-slate-800 bg-[#F8FAFF] dark:bg-slate-900/50 p-3.5">
                    <div>
                      <div className="text-xs font-bold text-[#101B35] dark:text-white">Google OAuth 2.0 / OIDC</div>
                      <div className="text-[11px] text-[#64748B]">GOOGLE_CLIENT_ID &amp; GOOGLE_CLIENT_SECRET</div>
                    </div>
                    {googleConfigured ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-emerald-600">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Configured
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-bold text-amber-600">
                        <XCircle className="h-3.5 w-3.5" /> Not Configured
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between rounded-xl border border-[#E4EAF5] dark:border-slate-800 bg-[#F8FAFF] dark:bg-slate-900/50 p-3.5">
                    <div>
                      <div className="text-xs font-bold text-[#101B35] dark:text-white">Facebook Login OAuth 2.0</div>
                      <div className="text-[11px] text-[#64748B]">FACEBOOK_APP_ID &amp; FACEBOOK_APP_SECRET</div>
                    </div>
                    {facebookConfigured ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-emerald-600">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Configured
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-bold text-amber-600">
                        <XCircle className="h-3.5 w-3.5" /> Not Configured
                      </span>
                    )}
                  </div>
                </div>

                {authWarnings.length > 0 && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3.5 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-amber-700 dark:text-amber-300">
                      <AlertTriangle className="h-4 w-4" /> Runtime Configuration Warnings
                    </div>
                    <ul className="list-disc pl-5 text-[11px] text-[#64748B] dark:text-slate-300 space-y-0.5">
                      {authWarnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {oauthCallbacks && (
                  <div className="space-y-3">
                    {[
                      {
                        label: 'Google Dev Callback URL',
                        url: oauthCallbacks.google.devCallbackUrl,
                      },
                      {
                        label: 'Google Shared App Callback URL',
                        url: oauthCallbacks.google.sharedCallbackUrl,
                      },
                      {
                        label: 'Facebook Dev Callback URL',
                        url: oauthCallbacks.facebook.devCallbackUrl,
                      },
                      {
                        label: 'Facebook Shared App Callback URL',
                        url: oauthCallbacks.facebook.sharedCallbackUrl,
                      },
                    ].map((row) => (
                      <div
                        key={row.label}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl border border-[#E4EAF5] dark:border-slate-800 bg-[#F8FAFF] dark:bg-slate-900/40 px-3.5 py-2.5"
                      >
                        <div className="min-w-0">
                          <div className="text-[11px] font-bold text-[#101B35] dark:text-white">{row.label}</div>
                          <div className="truncate font-mono-tabular text-[11px] text-[#64748B] dark:text-slate-300">
                            {row.url}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCopy(row.label, row.url)}
                          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[#DCE6F7] dark:border-slate-700 bg-white dark:bg-[#0B1730] px-2.5 py-1.5 text-[11px] font-semibold text-[#145CFF] hover:bg-[#145CFF] hover:text-white transition-colors"
                        >
                          <Copy className="h-3.5 w-3.5" /> Copy URL
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </PermissionGuard>
    </AdminLayout>
  );
}
