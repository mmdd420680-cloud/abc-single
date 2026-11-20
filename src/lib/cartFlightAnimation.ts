export interface RectBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FlightTrajectory {
  startX: number;
  startY: number;
  startSize: number;
  endX: number;
  endY: number;
  endSize: number;
  deltaX: number;
  deltaY: number;
  midDeltaX: number;
  midDeltaY: number;
}

const MAX_ACTIVE_FLYERS = 4;
const activeFlyerCleanups = new Set<() => void>();
const badgePulseListeners = new Set<() => void>();

export function prefersReducedMotionEnabled(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function computeFlightTrajectory(sourceRect: RectBox, targetRect: RectBox): FlightTrajectory {
  const startSize = Math.max(44, Math.min(96, Math.min(sourceRect.width, sourceRect.height) * 0.42));
  const endSize = 20;

  const sourceCenterX = sourceRect.left + sourceRect.width / 2;
  const sourceCenterY = sourceRect.top + sourceRect.height / 2;
  const targetCenterX = targetRect.left + targetRect.width / 2;
  const targetCenterY = targetRect.top + targetRect.height / 2;

  const startX = sourceCenterX - startSize / 2;
  const startY = sourceCenterY - startSize / 2;
  const endX = targetCenterX - startSize / 2;
  const endY = targetCenterY - startSize / 2;

  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const arcLift = Math.min(72, Math.max(24, Math.abs(deltaX) * 0.12));

  return {
    startX,
    startY,
    startSize,
    endX,
    endY,
    endSize,
    deltaX,
    deltaY,
    midDeltaX: deltaX * 0.48,
    midDeltaY: deltaY * 0.42 - arcLift,
  };
}

export function subscribeCartBadgePulse(listener: () => void): () => void {
  badgePulseListeners.add(listener);
  return () => {
    badgePulseListeners.delete(listener);
  };
}

export function triggerCartBadgePulse(): void {
  for (const listener of badgePulseListeners) {
    try {
      listener();
    } catch {
      // Never let a listener break cart flows
    }
  }
}

function findVisibleNavbarCartTarget(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const candidates = document.querySelectorAll<HTMLElement>('[data-cart-target="navbar-cart"]');
  for (const el of candidates) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return el;
    }
  }
  return null;
}

export function flyProductImageToCart(options: {
  sourceElement?: HTMLElement | null;
  imageUrl?: string;
  label?: string;
}): void {
  try {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    if (prefersReducedMotionEnabled()) {
      triggerCartBadgePulse();
      return;
    }

    const sourceEl = options.sourceElement;
    const targetEl = findVisibleNavbarCartTarget();
    if (!sourceEl || !targetEl) {
      triggerCartBadgePulse();
      return;
    }

    const imgEl = sourceEl.querySelector('img');
    const sourceRect = (imgEl || sourceEl).getBoundingClientRect();
    const targetRect = targetEl.getBoundingClientRect();

    if (sourceRect.width <= 0 || sourceRect.height <= 0 || targetRect.width <= 0 || targetRect.height <= 0) {
      triggerCartBadgePulse();
      return;
    }

    // Cap concurrent animations so rapid multi-clicks cannot accumulate DOM nodes
    while (activeFlyerCleanups.size >= MAX_ACTIVE_FLYERS) {
      const oldestCleanup = activeFlyerCleanups.values().next().value;
      if (oldestCleanup) oldestCleanup();
      else break;
    }

    const trajectory = computeFlightTrajectory(sourceRect, targetRect);
    const hasUsableImage =
      Boolean(options.imageUrl?.trim()) &&
      (!imgEl || imgEl.complete === false || imgEl.naturalWidth > 0);

    const flyer = document.createElement('div');
    flyer.setAttribute('aria-hidden', 'true');
    flyer.dataset.cartFlyer = 'true';
    flyer.style.position = 'fixed';
    flyer.style.left = `${trajectory.startX}px`;
    flyer.style.top = `${trajectory.startY}px`;
    flyer.style.width = `${trajectory.startSize}px`;
    flyer.style.height = `${trajectory.startSize}px`;
    flyer.style.zIndex = '9999';
    flyer.style.pointerEvents = 'none';
    flyer.style.borderRadius = '14px';
    flyer.style.overflow = 'hidden';
    flyer.style.backgroundColor = '#ffffff';
    flyer.style.border = '1px solid rgba(17, 85, 238, 0.25)';
    flyer.style.boxShadow = '0 14px 30px rgba(15, 29, 58, 0.22)';
    flyer.style.display = 'flex';
    flyer.style.alignItems = 'center';
    flyer.style.justifyContent = 'center';
    flyer.style.willChange = 'transform, opacity';

    if (hasUsableImage && options.imageUrl) {
      const cloneImg = document.createElement('img');
      cloneImg.src = options.imageUrl;
      cloneImg.alt = '';
      cloneImg.style.width = '100%';
      cloneImg.style.height = '100%';
      cloneImg.style.objectFit = 'contain';
      cloneImg.style.padding = '4px';
      flyer.appendChild(cloneImg);
    } else {
      flyer.style.backgroundColor = '#1155EE';
      flyer.style.color = '#ffffff';
      flyer.style.fontWeight = '800';
      flyer.style.fontSize = '14px';
      flyer.textContent = '+1';
    }

    document.body.appendChild(flyer);

    let cleaned = false;
    let fallbackTimer: number | null = null;
    let animation: Animation | null = null;

    const cleanup = (triggerPulse: boolean) => {
      if (cleaned) return;
      cleaned = true;
      activeFlyerCleanups.delete(forceRemove);
      if (fallbackTimer !== null) {
        window.clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      if (animation && typeof animation.cancel === 'function') {
        try {
          animation.cancel();
        } catch {
          // Ignore cancel error
        }
      }
      flyer.remove();
      if (triggerPulse) {
        triggerCartBadgePulse();
      }
    };

    const forceRemove = () => cleanup(false);
    activeFlyerCleanups.add(forceRemove);

    const endScale = trajectory.endSize / trajectory.startSize;
    if (typeof flyer.animate === 'function') {
      animation = flyer.animate(
        [
          {
            transform: 'translate3d(0px, 0px, 0) scale(1)',
            opacity: 0.96,
          },
          {
            transform: `translate3d(${trajectory.midDeltaX}px, ${trajectory.midDeltaY}px, 0) scale(0.72)`,
            opacity: 0.95,
            offset: 0.45,
          },
          {
            transform: `translate3d(${trajectory.deltaX}px, ${trajectory.deltaY}px, 0) scale(${endScale})`,
            opacity: 0.25,
          },
        ],
        {
          duration: 520,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          fill: 'forwards',
        },
      );
      animation.onfinish = () => cleanup(true);
      animation.oncancel = () => cleanup(false);
      fallbackTimer = window.setTimeout(() => cleanup(true), 680);
    } else {
      cleanup(true);
    }
  } catch {
    triggerCartBadgePulse();
  }
}
