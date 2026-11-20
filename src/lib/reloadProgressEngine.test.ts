import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceReloadProgress,
  computeTruthfulReadinessCeiling,
  isAppCriticallyReady,
  isEligibleFullPageLoad,
  type ReloadReadinessSignals,
} from './reloadProgressEngine';

describe('reloadProgressEngine', () => {
  const readySignals: ReloadReadinessSignals = {
    domInteractive: true,
    domComplete: true,
    authResolved: true,
    shellReady: true,
    routeSettled: true,
    failedOrOffline: false,
  };

  it('never reaches 100% while critical readiness signals remain incomplete', () => {
    assert.equal(
      computeTruthfulReadinessCeiling({
        ...readySignals,
        domInteractive: false,
        domComplete: false,
        authResolved: false,
        shellReady: false,
        routeSettled: false,
      }),
      10,
    );
    assert.equal(
      computeTruthfulReadinessCeiling({ ...readySignals, domComplete: false }),
      25,
    );
    assert.equal(
      computeTruthfulReadinessCeiling({ ...readySignals, authResolved: false }),
      45,
    );
    assert.equal(
      computeTruthfulReadinessCeiling({ ...readySignals, shellReady: false }),
      65,
    );
    assert.equal(
      computeTruthfulReadinessCeiling({ ...readySignals, routeSettled: false }),
      85,
    );
    assert.equal(computeTruthfulReadinessCeiling(readySignals), 100);

    // Even at 2900ms, incomplete auth holds progress <= 45%
    const stalledAuth = advanceReloadProgress({
      currentPercent: 25,
      elapsedMs: 2900,
      signals: { ...readySignals, authResolved: false },
    });
    assert.ok(stalledAuth.percent <= 45);
    assert.equal(stalledAuth.status, 'loading');
  });

  it('completes rapidly once all genuine readiness flags resolve', () => {
    assert.equal(isAppCriticallyReady(readySignals), true);

    const step1 = advanceReloadProgress({
      currentPercent: 10,
      elapsedMs: 250,
      signals: readySignals,
    });
    assert.equal(step1.percent, 85);
    assert.equal(step1.status, 'completing');

    const step2 = advanceReloadProgress({
      currentPercent: step1.percent,
      elapsedMs: 320,
      signals: readySignals,
    });
    assert.equal(step2.percent, 95);
    assert.equal(step2.status, 'completing');

    const step3 = advanceReloadProgress({
      currentPercent: step2.percent,
      elapsedMs: 390,
      signals: readySignals,
    });
    assert.equal(step3.percent, 100);
    assert.equal(step3.status, 'complete');
  });

  it('handles offline / timeout gracefully without faking 100% success', () => {
    const offlineState = advanceReloadProgress({
      currentPercent: 45,
      elapsedMs: 900,
      signals: { ...readySignals, failedOrOffline: true },
    });
    assert.equal(offlineState.status, 'error');
    assert.ok(offlineState.percent < 100);

    const timeoutState = advanceReloadProgress({
      currentPercent: 65,
      elapsedMs: 3000,
      signals: { ...readySignals, shellReady: false },
    });
    assert.equal(timeoutState.status, 'error');
    assert.ok(timeoutState.percent < 100);
  });

  it('identifies full browser loads/reloads as eligible', () => {
    assert.equal(isEligibleFullPageLoad('reload'), true);
    assert.equal(isEligibleFullPageLoad('navigate'), true);
    assert.equal(isEligibleFullPageLoad('back_forward'), true);
    assert.equal(isEligibleFullPageLoad('prerender'), false);
  });
});
