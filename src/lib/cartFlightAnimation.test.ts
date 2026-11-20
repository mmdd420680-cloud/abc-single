import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeFlightTrajectory,
  flyProductImageToCart,
  prefersReducedMotionEnabled,
  subscribeCartBadgePulse,
  triggerCartBadgePulse,
} from './cartFlightAnimation';

test('computeFlightTrajectory calculates smooth arc midpoint and target delta geometry', () => {
  const trajectory = computeFlightTrajectory(
    { left: 100, top: 400, width: 240, height: 240 },
    { left: 1200, top: 24, width: 40, height: 40 },
  );

  assert.equal(trajectory.startSize, 96);
  assert.equal(trajectory.endSize, 20);
  assert.ok(trajectory.deltaX > 900);
  assert.ok(trajectory.deltaY < -350);
  // Midpoint rises above linear interpolation for a crisp curved flight arc
  const linearMidY = trajectory.deltaY * 0.42;
  assert.ok(trajectory.midDeltaY < linearMidY);
});

test('subscribeCartBadgePulse registers and unsubscribes pulse listeners without throwing on listener errors', () => {
  let count = 0;
  const unsub1 = subscribeCartBadgePulse(() => {
    count += 1;
  });
  const unsub2 = subscribeCartBadgePulse(() => {
    throw new Error('Synthetic listener failure');
  });

  triggerCartBadgePulse();
  assert.equal(count, 1);

  unsub1();
  unsub2();
  triggerCartBadgePulse();
  assert.equal(count, 1);
});

test('flyProductImageToCart and prefersReducedMotionEnabled safely degrade in non-DOM runtimes', () => {
  assert.equal(prefersReducedMotionEnabled(), false);

  let pulsed = 0;
  const unsub = subscribeCartBadgePulse(() => {
    pulsed += 1;
  });
  try {
    assert.doesNotThrow(() => {
      flyProductImageToCart({
        sourceElement: null,
        imageUrl: '/assets/sample.jpg',
        label: 'Sample Product',
      });
    });
    assert.equal(pulsed, 0);
  } finally {
    unsub();
  }
});
