export interface ReloadReadinessSignals {
  domInteractive: boolean;
  domComplete: boolean;
  authResolved: boolean;
  shellReady: boolean;
  routeSettled: boolean;
  failedOrOffline: boolean;
}

export type ReloadProgressStatus = 'loading' | 'completing' | 'complete' | 'error';

export const RELOAD_STAGE_THRESHOLDS = [1, 10, 25, 45, 65, 85, 95, 100] as const;

export const MAX_RELOAD_VISUAL_DURATION_MS = 3000;

/**
 * Maps real application readiness signals to the highest *truthfully earned* percentage milestone.
 * Never returns 100 while critical startup readiness signals remain pending.
 */
export function computeTruthfulReadinessCeiling(signals: ReloadReadinessSignals): number {
  if (signals.failedOrOffline) {
    // Freeze below 100% if startup failed/offline instead of claiming fake 100% completion
    return signals.domInteractive ? 45 : 25;
  }
  if (!signals.domInteractive) return 10;
  if (!signals.domComplete) return 25;
  if (!signals.authResolved) return 45;
  if (!signals.shellReady) return 65;
  if (!signals.routeSettled) return 85;
  return 100;
}

export function isAppCriticallyReady(signals: ReloadReadinessSignals): boolean {
  return (
    !signals.failedOrOffline &&
    signals.domInteractive &&
    signals.domComplete &&
    signals.authResolved &&
    signals.shellReady &&
    signals.routeSettled
  );
}

/**
 * Advances displayed percentage smoothly toward the earned ceiling over elapsed time,
 * capping total visual duration to ~<=3s while allowing immediate completion once ready.
 */
export function advanceReloadProgress(params: {
  currentPercent: number;
  elapsedMs: number;
  signals: ReloadReadinessSignals;
}): {
  percent: number;
  status: ReloadProgressStatus;
  stageLabel: string;
} {
  const { currentPercent, elapsedMs, signals } = params;
  const ceiling = computeTruthfulReadinessCeiling(signals);
  const ready = isAppCriticallyReady(signals);

  if (signals.failedOrOffline) {
    return {
      percent: Math.max(10, Math.min(currentPercent, ceiling)),
      status: 'error',
      stageLabel: 'Connection interrupted — continuing',
    };
  }

  // Force safe graceful resolution if critical flags haven't arrived within max 3s safety window
  if (elapsedMs >= MAX_RELOAD_VISUAL_DURATION_MS && !ready) {
    return {
      percent: Math.max(currentPercent, Math.min(95, ceiling)),
      status: 'error',
      stageLabel: 'Storefront taking longer than usual...',
    };
  }

  let nextPercent = currentPercent;
  if (ready) {
    // Once truthfully ready, sweep cleanly across remaining staging steps toward 100%
    if (currentPercent < 85) {
      nextPercent = Math.min(95, Math.max(currentPercent + 20, 85));
    } else if (currentPercent < 95) {
      nextPercent = 95;
    } else {
      nextPercent = 100;
    }
  } else {
    // Never pass ceiling while genuine tasks are still pending
    const timeDrivenTarget = Math.min(
      ceiling,
      Math.max(1, Math.round((elapsedMs / MAX_RELOAD_VISUAL_DURATION_MS) * 95)),
    );
    nextPercent = Math.min(ceiling, Math.max(currentPercent, timeDrivenTarget));
  }

  const clamped = Math.max(1, Math.min(100, Math.round(nextPercent)));

  if (clamped >= 100 && ready) {
    return {
      percent: 100,
      status: 'complete',
      stageLabel: 'Storefront ready',
    };
  }

  let stageLabel = 'Initializing NOVARA...';
  if (clamped >= 85) {
    stageLabel = 'Finalizing storefront layout...';
  } else if (clamped >= 65) {
    stageLabel = 'Preparing catalog experience...';
  } else if (clamped >= 45) {
    stageLabel = 'Syncing account & navigation...';
  } else if (clamped >= 25) {
    stageLabel = 'Loading styles & storefront assets...';
  }

  return {
    percent: clamped,
    status: ready ? 'completing' : 'loading',
    stageLabel,
  };
}

/**
 * Determines whether the initial full-page reload progress overlay should activate
 * on mount. Only eligible on genuine browser document load/reload, never on in-app
 * React Router navigation or UI state interactions.
 */
export function isEligibleFullPageLoad(navigationType?: string): boolean {
  if (!navigationType) return true;
  return navigationType === 'reload' || navigationType === 'navigate' || navigationType === 'back_forward';
}
