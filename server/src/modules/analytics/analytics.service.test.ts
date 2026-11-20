import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateProviderRegistrationsPure,
  resolveOriginalRegistrationProvider,
} from './analytics.service';

test('resolveOriginalRegistrationProvider prioritizes immutable initialAuthProvider over authProvider fallback', () => {
  assert.equal(resolveOriginalRegistrationProvider({ initialAuthProvider: 'google', authProvider: 'local' }), 'google');
  assert.equal(resolveOriginalRegistrationProvider({ initialAuthProvider: 'facebook', authProvider: 'google' }), 'facebook');
  assert.equal(resolveOriginalRegistrationProvider({ initialAuthProvider: 'local', authProvider: 'google' }), 'local');
  assert.equal(resolveOriginalRegistrationProvider({ authProvider: 'facebook' }), 'facebook');
  assert.equal(resolveOriginalRegistrationProvider({}), 'local');
});

test('aggregateProviderRegistrationsPure counts each user strictly once by origin while tracking multi-linked accounts and daily trends', () => {
  const fixedNow = new Date('2026-11-17T12:00:00.000Z');
  const todayIso = '2026-11-17T08:00:00.000Z';
  const yesterdayIso = '2026-11-16T15:30:00.000Z';

  const result = aggregateProviderRegistrationsPure(
    [
      // 1. Local email signup
      {
        initialAuthProvider: 'local',
        isVerified: true,
        hasPassword: true,
        oauthProviders: {},
        createdAt: yesterdayIso,
      },
      // 2. Google signup who later linked Facebook AND set password (must still count ONCE as googleUsers!)
      {
        initialAuthProvider: 'google',
        authProvider: 'facebook',
        isVerified: true,
        hasPassword: true,
        oauthProviders: { googleId: 'g-1', facebookId: 'f-1' },
        createdAt: todayIso,
      },
      // 3. Facebook signup with missing verification
      {
        initialAuthProvider: 'facebook',
        isVerified: false,
        hasPassword: false,
        oauthProviders: { facebookId: 'f-2' },
        createdAt: todayIso,
      },
      // 4. Local user who later linked Google (multi-linked = 2)
      {
        initialAuthProvider: 'local',
        isVerified: true,
        hasPassword: true,
        oauthProviders: { googleId: 'g-2' },
        createdAt: todayIso,
      },
    ],
    7,
    fixedNow,
  );

  assert.equal(result.summary.totalRegisteredUsers, 4);
  assert.equal(result.summary.localUsers, 2);
  assert.equal(result.summary.googleUsers, 1);
  assert.equal(result.summary.facebookUsers, 1);
  assert.equal(result.summary.verifiedUsers, 3);
  assert.equal(result.summary.multiLinkedUsers, 2);
  assert.equal(result.summary.localSharePct, 50);
  assert.equal(result.summary.googleSharePct, 25);
  assert.equal(result.summary.facebookSharePct, 25);

  const todayBucket = result.dailyTrends.find((b) => b.date === '2026-11-17');
  assert.ok(todayBucket);
  assert.deepEqual(
    {
      local: todayBucket.local,
      google: todayBucket.google,
      facebook: todayBucket.facebook,
      total: todayBucket.total,
    },
    { local: 1, google: 1, facebook: 1, total: 3 },
  );

  const yesterdayBucket = result.dailyTrends.find((b) => b.date === '2026-11-16');
  assert.ok(yesterdayBucket);
  assert.equal(yesterdayBucket.local, 1);
  assert.equal(yesterdayBucket.total, 1);
});

test('aggregateProviderRegistrationsPure returns 0% shares when user list is empty', () => {
  const res = aggregateProviderRegistrationsPure([], 7, new Date('2026-11-17T00:00:00.000Z'));
  assert.equal(res.summary.totalRegisteredUsers, 0);
  assert.equal(res.summary.localSharePct, 0);
  assert.equal(res.summary.googleSharePct, 0);
  assert.equal(res.summary.facebookSharePct, 0);
  assert.equal(res.dailyTrends.length, 7);
});
