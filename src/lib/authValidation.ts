export interface RegistrationFieldErrors {
  name?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
}

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(email: string): string {
  return String(email || '').trim().toLowerCase();
}

export function normalizeFullName(name: string): string {
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ');
}

export function validateFullName(name: string): string | null {
  const cleaned = normalizeFullName(name);
  if (!cleaned) {
    return 'Full name is required.';
  }
  if (cleaned.length < 2) {
    return 'Full name must be at least 2 characters.';
  }
  if (cleaned.length > 100) {
    return 'Full name must not exceed 100 characters.';
  }
  if (!/[a-zA-Z\u0980-\u09FF]/.test(cleaned)) {
    return 'Please enter a valid full name.';
  }
  return null;
}

export function validateEmailAddress(email: string): string | null {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return 'Email address is required.';
  }
  if (normalized.length > 254 || !EMAIL_REGEX.test(normalized)) {
    return 'Please enter a valid email address.';
  }
  return null;
}

export interface PasswordRuleResult {
  minLength: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasNumber: boolean;
}

export function evaluatePasswordRules(password: string): PasswordRuleResult {
  const value = String(password || '');
  return {
    minLength: value.length >= 8,
    hasUppercase: /[A-Z]/.test(value),
    hasLowercase: /[a-z]/.test(value),
    hasNumber: /[0-9]/.test(value),
  };
}

export function validatePasswordStrength(password: string): string | null {
  const value = String(password || '');
  if (!value) {
    return 'Password is required.';
  }
  if (value.length < 8) {
    return 'Password must be at least 8 characters long.';
  }
  if (value.length > 128) {
    return 'Password must not exceed 128 characters.';
  }
  const rules = evaluatePasswordRules(value);
  if (!rules.hasUppercase || !rules.hasLowercase || !rules.hasNumber) {
    return 'Password must include uppercase, lowercase, and at least one number.';
  }
  return null;
}

export function validateConfirmPassword(password: string, confirmPassword: string): string | null {
  const confirm = String(confirmPassword || '');
  if (!confirm) {
    return 'Please confirm your password.';
  }
  if (String(password || '') !== confirm) {
    return 'Passwords do not match.';
  }
  return null;
}

export function validateRegistrationFields(input: {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
}): {
  valid: boolean;
  errors: RegistrationFieldErrors;
  normalized: { name: string; email: string };
} {
  const errors: RegistrationFieldErrors = {};

  const nameError = validateFullName(input.name);
  if (nameError) errors.name = nameError;

  const emailError = validateEmailAddress(input.email);
  if (emailError) errors.email = emailError;

  const passwordError = validatePasswordStrength(input.password);
  if (passwordError) errors.password = passwordError;

  const confirmError = validateConfirmPassword(input.password, input.confirmPassword);
  if (confirmError) errors.confirmPassword = confirmError;

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    normalized: {
      name: normalizeFullName(input.name),
      email: normalizeEmail(input.email),
    },
  };
}

export const OAUTH_BROADCAST_CHANNEL = 'novara_oauth_channel';
export const OAUTH_POPUP_WINDOW_FEATURES = 'width=520,height=640,scrollbars=yes,resizable=yes';

export function isTrustedOAuthOrigin(
  eventOrigin: string,
  currentOrigin: string,
  extraAllowedOrigins: Array<string | null | undefined> = [],
): boolean {
  if (!eventOrigin || eventOrigin === 'null' || !currentOrigin) {
    return false;
  }
  if (eventOrigin === currentOrigin) {
    return true;
  }
  return extraAllowedOrigins.some((candidate) => Boolean(candidate) && candidate === eventOrigin);
}

export function sanitizeAuthRedirectPath(rawPath?: string | null, fallback = '/account'): string {
  const value = String(rawPath || '').trim();
  if (!value.startsWith('/') || value.startsWith('//')) {
    return fallback;
  }
  const lower = value.toLowerCase();
  if (
    lower.startsWith('/login') ||
    lower.startsWith('/signin') ||
    lower.startsWith('/register') ||
    lower.startsWith('/signup') ||
    lower.startsWith('/forgot-password')
  ) {
    return fallback;
  }
  return value;
}

export type AuthProviderType = 'local' | 'google' | 'facebook';

export interface AuthSettingsConfig {
  authLogoUrl: string;
  brandNameOverride: string;
  showcaseTagline: string;
  loginTitle: string;
  loginSubtitle: string;
  registerTitle: string;
  registerSubtitle: string;
  enableGoogleLogin: boolean;
  enableFacebookLogin: boolean;
  googleButtonLabel: string;
  facebookButtonLabel: string;
}

export const DEFAULT_AUTH_SETTINGS: AuthSettingsConfig = {
  authLogoUrl: '',
  brandNameOverride: '',
  showcaseTagline: 'Verified Shopping Across Bangladesh',
  loginTitle: 'Sign in or create an account',
  loginSubtitle: 'Enter your email address to sign in or get started with your NOVARA account.',
  registerTitle: 'Create your account',
  registerSubtitle: 'Join NOVARA COMMERCE for faster checkout, order tracking, and saved addresses.',
  enableGoogleLogin: true,
  enableFacebookLogin: true,
  googleButtonLabel: 'Continue with Google',
  facebookButtonLabel: 'Continue with Facebook',
};

export function validateEmailFirstStep(email: string): {
  valid: boolean;
  normalizedEmail: string;
  error: string | null;
} {
  const normalizedEmail = normalizeEmail(email);
  const error = validateEmailAddress(normalizedEmail);
  return {
    valid: error === null,
    normalizedEmail,
    error,
  };
}

export interface MergedAuthBranding extends AuthSettingsConfig {
  effectiveBrandName: string;
  effectiveLogoUrl: string;
}

export function mergeAuthBrandingSettings(
  authSettings?: Partial<AuthSettingsConfig> | null,
  storeInfo?: { storeName?: string | null; logoUrl?: string | null; tagline?: string | null } | null,
): MergedAuthBranding {
  const merged: AuthSettingsConfig = {
    authLogoUrl: String(authSettings?.authLogoUrl ?? DEFAULT_AUTH_SETTINGS.authLogoUrl).trim(),
    brandNameOverride: String(authSettings?.brandNameOverride ?? DEFAULT_AUTH_SETTINGS.brandNameOverride).trim(),
    showcaseTagline:
      String(authSettings?.showcaseTagline ?? '').trim() ||
      String(storeInfo?.tagline ?? '').trim() ||
      DEFAULT_AUTH_SETTINGS.showcaseTagline,
    loginTitle: String(authSettings?.loginTitle ?? '').trim() || DEFAULT_AUTH_SETTINGS.loginTitle,
    loginSubtitle: String(authSettings?.loginSubtitle ?? '').trim() || DEFAULT_AUTH_SETTINGS.loginSubtitle,
    registerTitle: String(authSettings?.registerTitle ?? '').trim() || DEFAULT_AUTH_SETTINGS.registerTitle,
    registerSubtitle: String(authSettings?.registerSubtitle ?? '').trim() || DEFAULT_AUTH_SETTINGS.registerSubtitle,
    enableGoogleLogin:
      typeof authSettings?.enableGoogleLogin === 'boolean'
        ? authSettings.enableGoogleLogin
        : DEFAULT_AUTH_SETTINGS.enableGoogleLogin,
    enableFacebookLogin:
      typeof authSettings?.enableFacebookLogin === 'boolean'
        ? authSettings.enableFacebookLogin
        : DEFAULT_AUTH_SETTINGS.enableFacebookLogin,
    googleButtonLabel:
      String(authSettings?.googleButtonLabel ?? '').trim() || DEFAULT_AUTH_SETTINGS.googleButtonLabel,
    facebookButtonLabel:
      String(authSettings?.facebookButtonLabel ?? '').trim() || DEFAULT_AUTH_SETTINGS.facebookButtonLabel,
  };

  const effectiveBrandName =
    merged.brandNameOverride || String(storeInfo?.storeName ?? '').trim() || 'NOVARA COMMERCE';
  const effectiveLogoUrl = merged.authLogoUrl || String(storeInfo?.logoUrl ?? '').trim() || '';

  return {
    ...merged,
    effectiveBrandName,
    effectiveLogoUrl,
  };
}

export function buildBdPhoneSearchVariants(rawInput: string): string[] {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) return [];

  const variants = new Set<string>([trimmed]);
  const compact = trimmed.replace(/[\s()-]/g, '');
  if (compact) variants.add(compact);

  let local11 = '';
  if (/^\+?8801[3-9]\d{8}$/.test(compact)) {
    local11 = '0' + compact.replace(/^\+?880/, '');
  } else if (/^01[3-9]\d{8}$/.test(compact)) {
    local11 = compact;
  }

  if (local11) {
    variants.add(local11);
    variants.add(`+88${local11}`);
    variants.add(`88${local11}`);
    variants.add(`${local11.slice(0, 5)}-${local11.slice(5)}`);
  }

  return Array.from(variants);
}

export function safeClosePopupWindow(popup: { closed?: boolean; close?: () => void } | null | undefined): void {
  if (!popup) return;
  try {
    if (!popup.closed && typeof popup.close === 'function') {
      popup.close();
    }
  } catch {
    // Ignore cross-origin window close errors
  }
}

export function stepDropdownIndex(currentIndex: number, delta: 1 | -1, itemCount: number): number {
  if (itemCount <= 0) return -1;
  if (currentIndex < 0 || currentIndex >= itemCount) {
    return delta === 1 ? 0 : itemCount - 1;
  }
  return (currentIndex + delta + itemCount) % itemCount;
}

