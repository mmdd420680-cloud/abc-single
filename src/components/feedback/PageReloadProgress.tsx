import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { RefreshCw, ShoppingBag } from 'lucide-react';
import { useAppSelector } from '../../app/hooks';
import {
  advanceReloadProgress,
  isEligibleFullPageLoad,
  MAX_RELOAD_VISUAL_DURATION_MS,
  type ReloadProgressStatus,
  type ReloadReadinessSignals,
} from '../../lib/reloadProgressEngine';

const STOREFRONT_NON_LAYOUT_PREFIXES = ['/admin', '/login', '/signin', '/register', '/signup', '/forgot-password', '/verify-email', '/reset-password'];

function isStorefrontLayoutRoute(pathname: string): boolean {
  const lower = pathname.toLowerCase();
  return !STOREFRONT_NON_LAYOUT_PREFIXES.some((prefix) => lower === prefix || lower.startsWith(`${prefix}/`));
}

export function PageReloadProgress() {
  const location = useLocation();
  const initialPathnameRef = useRef<string>(location.pathname);

  const authInitialized = useAppSelector((s) => s.auth.initialized);
  const storefrontSettled = useAppSelector((s) => s.storefront.settled);

  const [eligible] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const navEntries =
      typeof performance !== 'undefined' && typeof performance.getEntriesByType === 'function'
        ? (performance.getEntriesByType('navigation') as PerformanceNavigationTiming[])
        : [];
    const navType = navEntries[0]?.type;
    return isEligibleFullPageLoad(navType);
  });

  const [visible, setVisible] = useState<boolean>(eligible);
  const [fadingOut, setFadingOut] = useState<boolean>(false);
  const [percent, setPercent] = useState<number>(1);
  const [status, setStatus] = useState<ReloadProgressStatus>('loading');
  const [stageLabel, setStageLabel] = useState<string>('Initializing NOVARA...');

  const [domInteractive, setDomInteractive] = useState<boolean>(() =>
    typeof document !== 'undefined' ? document.readyState !== 'loading' : true,
  );
  const [domComplete, setDomComplete] = useState<boolean>(() =>
    typeof document !== 'undefined' ? document.readyState === 'complete' : true,
  );
  const [routeSettled, setRouteSettled] = useState<boolean>(false);
  const [isOffline, setIsOffline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine === false : false,
  );

  const startedAtRef = useRef<number>(typeof performance !== 'undefined' ? performance.now() : Date.now());
  const percentRef = useRef<number>(1);
  const completedRef = useRef<boolean>(false);

  const expectsStorefrontShell = isStorefrontLayoutRoute(initialPathnameRef.current);
  const shellReady = expectsStorefrontShell ? storefrontSettled : true;

  // Listen once for genuine DOM & offline events during initial page bootstrap
  useEffect(() => {
    if (!eligible) return;

    const syncReadyState = () => {
      if (document.readyState === 'interactive' || document.readyState === 'complete') {
        setDomInteractive(true);
      }
      if (document.readyState === 'complete') {
        setDomInteractive(true);
        setDomComplete(true);
      }
    };

    syncReadyState();
    document.addEventListener('readystatechange', syncReadyState);
    window.addEventListener('load', syncReadyState);

    const onOffline = () => setIsOffline(true);
    const onOnline = () => setIsOffline(false);
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);

    return () => {
      document.removeEventListener('readystatechange', syncReadyState);
      window.removeEventListener('load', syncReadyState);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [eligible]);

  // Mark route settled on the first animation frames after auth + shell resolve
  useEffect(() => {
    if (!eligible || !authInitialized || !shellReady || routeSettled) return;
    let raf1 = 0;
    let raf2 = 0;
    raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        setRouteSettled(true);
      });
    });
    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
    };
  }, [eligible, authInitialized, shellReady, routeSettled]);

  // Drive truthful progress ticks within <= 3s visual budget
  useEffect(() => {
    if (!eligible || !visible || completedRef.current) return;

    let dismissTimer: number | null = null;
    const signals: ReloadReadinessSignals = {
      domInteractive,
      domComplete,
      authResolved: authInitialized,
      shellReady,
      routeSettled,
      failedOrOffline: isOffline,
    };

    const tick = () => {
      if (completedRef.current) return;
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const elapsedMs = Math.max(0, now - startedAtRef.current);
      const next = advanceReloadProgress({
        currentPercent: percentRef.current,
        elapsedMs,
        signals,
      });

      percentRef.current = next.percent;
      setPercent(next.percent);
      setStatus(next.status);
      setStageLabel(next.stageLabel);

      if (next.status === 'complete') {
        completedRef.current = true;
        setFadingOut(true);
        dismissTimer = window.setTimeout(() => {
          setVisible(false);
        }, 240);
      } else if (next.status === 'error' && elapsedMs >= MAX_RELOAD_VISUAL_DURATION_MS + 350) {
        completedRef.current = true;
        setFadingOut(true);
        dismissTimer = window.setTimeout(() => {
          setVisible(false);
        }, 240);
      }
    };

    tick();
    const intervalId = window.setInterval(tick, 70);

    return () => {
      window.clearInterval(intervalId);
      if (dismissTimer !== null) {
        window.clearTimeout(dismissTimer);
      }
    };
  }, [eligible, visible, domInteractive, domComplete, authInitialized, shellReady, routeSettled, isOffline]);

  if (!eligible || !visible) {
    return null;
  }

  return (
    <div
      data-testid="page-reload-progress"
      role="progressbar"
      aria-label="Loading NOVARA Commerce"
      aria-valuemin={1}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={`${percent}% — ${stageLabel}`}
      className={`fixed inset-0 z-[120] flex items-center justify-center bg-[#F6F8FC]/92 px-4 backdrop-blur-md transition-opacity duration-200 motion-reduce:transition-none ${
        fadingOut ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
    >
      <div className="w-full max-w-sm rounded-2xl border border-[#E4EAF5] bg-white/95 p-6 shadow-xl shadow-[#0B1730]/5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1155EE] text-white shadow-sm shadow-[#1155EE]/25">
              <ShoppingBag className="h-4.5 w-4.5" />
            </span>
            <div>
              <p className="font-display text-lg font-extrabold tracking-tight text-[#0B1730]">NOVARA</p>
              <p className="text-[11px] font-medium text-slate-500">Smart Technology &amp; Lifestyle</p>
            </div>
          </div>

          <span
            data-testid="reload-progress-percent"
            className="font-mono-tabular text-lg font-bold text-[#1155EE]"
          >
            {percent}%
          </span>
        </div>

        <div className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-[#E9F0FD]">
          <div
            className={`h-full origin-left rounded-full transition-transform duration-150 ease-out motion-reduce:transition-none ${
              status === 'error' ? 'bg-amber-500' : 'bg-[#1155EE]'
            }`}
            style={{ transform: `scaleX(${Math.max(0.01, percent / 100)})` }}
          />
        </div>

        <div className="mt-3 flex items-center justify-between gap-2 text-xs">
          <span className="truncate font-medium text-slate-600">{stageLabel}</span>
          {status === 'error' && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex shrink-0 items-center gap-1 font-semibold text-[#1155EE] hover:underline"
            >
              <RefreshCw className="h-3 w-3" />
              Reload
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
