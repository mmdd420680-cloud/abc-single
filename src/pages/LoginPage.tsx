import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Heart,
  Link2,
  Lock,
  LogIn,
  Mail,
  Package,
  ShieldCheck,
  User,
  Users,
} from 'lucide-react';
import { useAppDispatch, useAppSelector } from '../app/hooks';
import { completeOAuthSession, loginUser } from '../features/auth/authSlice';
import { showToast } from '../features/notifications/toastSlice';
import { ApiError, apiRequest } from '../services/api';
import type { UserProfile } from '../types/commerce';
import {
  DEFAULT_AUTH_SETTINGS,
  OAUTH_BROADCAST_CHANNEL,
  OAUTH_POPUP_WINDOW_FEATURES,
  isTrustedOAuthOrigin,
  mergeAuthBrandingSettings,
  sanitizeAuthRedirectPath,
  validateEmailAddress,
  validateEmailFirstStep,
  type AuthProviderType,
  type MergedAuthBranding,
} from '../lib/authValidation';
import { useSeoMeta } from '../lib/useSeoMeta';
import { AuthShowcasePanel } from '../components/auth/AuthShowcasePanel';

const LOGIN_FEATURES = [
  {
    icon: <Heart className="h-4 w-4" />,
    title: 'Synced Wishlist & Cart',
    description: 'Pick up right where you left off.',
  },
  {
    icon: <Package className="h-4 w-4" />,
    title: 'Live Order Tracking',
    description: 'Track deliveries across all 64 districts.',
  },
  {
    icon: <ShieldCheck className="h-4 w-4" />,
    title: 'Secure & Reliable',
    description: 'Your account and payments stay protected.',
  },
];

type LoginViewMode = 'email_step' | 'password_step' | 'forgot' | 'social_email_challenge' | 'oauth_link_challenge';

interface SocialEmailChallengeState {
  challengeToken: string;
  provider: 'facebook';
  name: string;
}

interface OAuthLinkChallengeState {
  pendingLinkToken: string;
  provider: 'google' | 'facebook';
  emailHint: string;
  existingHasPassword: boolean;
  existingInitialProvider: AuthProviderType | string;
}

export function LoginPage({ initialMode = 'login' }: { initialMode?: 'login' | 'forgot' }) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { user, loading } = useAppSelector((s) => s.auth);

  const [viewMode, setViewMode] = useState<LoginViewMode>(initialMode === 'forgot' ? 'forgot' : 'email_step');
  useEffect(() => {
    setViewMode((prev) => {
      if (initialMode === 'forgot') return 'forgot';
      if (prev === 'forgot') return 'email_step';
      return prev;
    });
  }, [initialMode]);

  const [branding, setBranding] = useState<MergedAuthBranding>(() =>
    mergeAuthBrandingSettings(DEFAULT_AUTH_SETTINGS, null),
  );

  useSeoMeta({
    title:
      viewMode === 'forgot'
        ? `Reset Password | ${branding.effectiveBrandName}`
        : `Sign In | ${branding.effectiveBrandName}`,
    description: branding.loginSubtitle,
  });

  const redirectParam = searchParams.get('redirect') || (location.state as { from?: string } | null)?.from || '';
  const redirectTarget = sanitizeAuthRedirectPath(redirectParam, '/');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [identifying, setIdentifying] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [forgotBusy, setForgotBusy] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [oauthBusy, setOauthBusy] = useState<'google' | 'facebook' | null>(null);
  const emailInputRef = useRef<HTMLInputElement | null>(null);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);
  const identifyLockRef = useRef(false);
  const popupTimerRef = useRef<number | null>(null);
  const oauthPopupRef = useRef<Window | null>(null);
  const expectedCallbackOriginRef = useRef<string | null>(null);
  const handledOAuthEventIdsRef = useRef<Set<string>>(new Set());

  const clearPopupTimer = () => {
    if (popupTimerRef.current !== null) {
      window.clearInterval(popupTimerRef.current);
      popupTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => clearPopupTimer();
  }, []);

  useEffect(() => {
    if (viewMode === 'password_step') {
      const raf = window.requestAnimationFrame(() => {
        passwordInputRef.current?.focus();
      });
      return () => window.cancelAnimationFrame(raf);
    }
    return undefined;
  }, [viewMode]);

  const [providers, setProviders] = useState({
    google: false,
    facebook: false,
    googleConfigured: false,
    facebookConfigured: false,
    emailVerificationRequired: false,
  });

  // Challenge states (missing Facebook email or explicit OAuth link confirmation)
  const [socialEmailChallenge, setSocialEmailChallenge] = useState<SocialEmailChallengeState | null>(null);
  const [challengeEmail, setChallengeEmail] = useState('');
  const [challengeName, setChallengeName] = useState('');
  const [challengeVerificationNotice, setChallengeVerificationNotice] = useState<string | null>(null);

  const [linkChallenge, setLinkChallenge] = useState<OAuthLinkChallengeState | null>(null);
  const [linkPassword, setLinkPassword] = useState('');
  const [challengeBusy, setChallengeBusy] = useState(false);

  const buildRegisterLink = () => {
    const qs = new URLSearchParams();
    if (redirectParam) qs.set('redirect', redirectTarget);
    if (email.trim()) qs.set('email', email.trim().toLowerCase());
    const serialized = qs.toString();
    return serialized ? `/register?${serialized}` : '/register';
  };

  useEffect(() => {
    const authError = searchParams.get('authError');
    const oauthAction = searchParams.get('oauthAction');
    const oauthChallenge = searchParams.get('oauthChallenge');
    const pendingLinkToken = searchParams.get('pendingLinkToken');
    const challengeProvider = searchParams.get('provider');
    const emailHint = searchParams.get('emailHint');
    const prefillEmail = searchParams.get('email');

    if (prefillEmail && !email) {
      setEmail(prefillEmail);
    }

    if (authError) {
      setErrorMsg(decodeURIComponent(authError).replace(/_/g, ' '));
    }

    if (oauthAction === 'email_required' && oauthChallenge) {
      setSocialEmailChallenge({
        challengeToken: oauthChallenge,
        provider: 'facebook',
        name: '',
      });
      setViewMode('social_email_challenge');
    } else if (oauthAction === 'link_required' && pendingLinkToken) {
      setLinkChallenge({
        pendingLinkToken,
        provider: challengeProvider === 'facebook' ? 'facebook' : 'google',
        emailHint: emailHint || 'your existing email',
        existingHasPassword: true,
        existingInitialProvider: 'local',
      });
      setViewMode('oauth_link_challenge');
    }
  }, [searchParams]);

  useEffect(() => {
    apiRequest<{
      ok: true;
      providers: {
        google: boolean;
        facebook: boolean;
        googleConfigured?: boolean;
        facebookConfigured?: boolean;
        emailVerificationRequired?: boolean;
      };
      branding?: MergedAuthBranding;
      authSettings?: Partial<MergedAuthBranding>;
    }>('/api/auth/providers')
      .then((res) => {
        setProviders({
          google: Boolean(res.providers.google),
          facebook: Boolean(res.providers.facebook),
          googleConfigured: Boolean(res.providers.googleConfigured ?? res.providers.google),
          facebookConfigured: Boolean(res.providers.facebookConfigured ?? res.providers.facebook),
          emailVerificationRequired: Boolean(res.providers.emailVerificationRequired),
        });
        if (res.branding) {
          setBranding(res.branding);
        } else if (res.authSettings) {
          setBranding(mergeAuthBrandingSettings(res.authSettings, null));
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const processOAuthPayload = async (data: Record<string, unknown>) => {
      const eventId = typeof data.eventId === 'string' ? data.eventId : '';
      if (eventId) {
        if (handledOAuthEventIdsRef.current.has(eventId)) return;
        handledOAuthEventIdsRef.current.add(eventId);
      }

      if (data.type === 'OAUTH_AUTH_SUCCESS' && data.user) {
        clearPopupTimer();
        setOauthBusy(null);
        try {
          if (oauthPopupRef.current && !oauthPopupRef.current.closed) {
            oauthPopupRef.current.close();
          }
        } catch {
          // Ignore cross-origin close errors
        }
        oauthPopupRef.current = null;
        await dispatch(
          completeOAuthSession({
            user: data.user as UserProfile,
            token: typeof data.token === 'string' ? data.token : undefined,
          }),
        );
        dispatch(
          showToast({
            variant: 'success',
            message: `Welcome back, ${(data.user as UserProfile).name}!`,
          }),
        );
        const dest = sanitizeAuthRedirectPath(
          typeof data.returnTo === 'string' ? data.returnTo : redirectTarget,
          redirectTarget,
        );
        navigate(dest, { replace: true });
      } else if (data.type === 'OAUTH_EMAIL_REQUIRED' && data.challengeToken) {
        clearPopupTimer();
        setOauthBusy(null);
        try {
          if (oauthPopupRef.current && !oauthPopupRef.current.closed) {
            oauthPopupRef.current.close();
          }
        } catch {
          // Ignore cross-origin close errors
        }
        oauthPopupRef.current = null;
        setErrorMsg(null);
        setSocialEmailChallenge({
          challengeToken: String(data.challengeToken),
          provider: 'facebook',
          name: String(data.name || ''),
        });
        setChallengeName(String(data.name || ''));
        setViewMode('social_email_challenge');
      } else if (data.type === 'OAUTH_LINK_REQUIRED' && data.pendingLinkToken) {
        clearPopupTimer();
        setOauthBusy(null);
        try {
          if (oauthPopupRef.current && !oauthPopupRef.current.closed) {
            oauthPopupRef.current.close();
          }
        } catch {
          // Ignore cross-origin close errors
        }
        oauthPopupRef.current = null;
        setErrorMsg(null);
        setLinkChallenge({
          pendingLinkToken: String(data.pendingLinkToken),
          provider: data.provider === 'facebook' ? 'facebook' : 'google',
          emailHint: String(data.emailHint || 'your account'),
          existingHasPassword: data.existingHasPassword !== false,
          existingInitialProvider: String(data.existingInitialProvider || 'local'),
        });
        setViewMode('oauth_link_challenge');
      } else if (data.type === 'OAUTH_AUTH_ERROR') {
        clearPopupTimer();
        setOauthBusy(null);
        try {
          if (oauthPopupRef.current && !oauthPopupRef.current.closed) {
            oauthPopupRef.current.close();
          }
        } catch {
          // Ignore cross-origin close errors
        }
        oauthPopupRef.current = null;
        setErrorMsg(String(data.error || 'Social authentication failed. Please try again.'));
      }
    };

    const onOAuthMessage = async (event: MessageEvent) => {
      if (!isTrustedOAuthOrigin(event.origin, window.location.origin, [expectedCallbackOriginRef.current])) {
        return;
      }
      if (!event.data || typeof event.data !== 'object') return;
      await processOAuthPayload(event.data as Record<string, unknown>);
    };

    window.addEventListener('message', onOAuthMessage);
    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        channel = new BroadcastChannel(OAUTH_BROADCAST_CHANNEL);
        channel.onmessage = (event) => {
          if (!event.data || typeof event.data !== 'object') return;
          void processOAuthPayload(event.data as Record<string, unknown>);
        };
      } catch {
        channel = null;
      }
    }

    return () => {
      window.removeEventListener('message', onOAuthMessage);
      if (channel) {
        try {
          channel.close();
        } catch {
          // Ignore close failures
        }
      }
    };
  }, [dispatch, navigate, redirectTarget]);

  const handleContinueEmail = async (e: FormEvent) => {
    e.preventDefault();
    if (identifyLockRef.current || identifying) return;
    setErrorMsg(null);
    setErrorCode(null);

    const rawEmail = email || emailInputRef.current?.value || '';
    if (rawEmail !== email) setEmail(rawEmail);

    const check = validateEmailFirstStep(rawEmail);
    if (!check.valid) {
      setErrorMsg(check.error || 'Please enter a valid email address.');
      return;
    }

    identifyLockRef.current = true;
    setIdentifying(true);
    try {
      const res = await apiRequest<{ ok: true; email: string }>('/api/auth/identify', {
        method: 'POST',
        body: JSON.stringify({ email: check.normalizedEmail }),
      });
      setEmail(res.email || check.normalizedEmail);
      setViewMode('password_step');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to validate your email address.');
    } finally {
      identifyLockRef.current = false;
      setIdentifying(false);
    }
  };

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setErrorCode(null);

    const currentEmail = email || emailInputRef.current?.value || '';
    const currentPassword = password || passwordInputRef.current?.value || '';
    const emailErr = validateEmailAddress(currentEmail);
    if (emailErr) {
      setErrorMsg(emailErr);
      setViewMode('email_step');
      return;
    }
    if (!currentPassword) {
      setErrorMsg('Please enter your password.');
      return;
    }

    const res = await dispatch(loginUser({ email: currentEmail, password: currentPassword }));
    if (loginUser.fulfilled.match(res)) {
      dispatch(showToast({ variant: 'success', message: `Welcome back, ${res.payload.name}!` }));
      navigate(redirectTarget, { replace: true });
    } else {
      setErrorMsg(res.payload?.message || 'Invalid email or password.');
      setErrorCode(res.payload?.code || null);
    }
  };

  const handleForgot = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const emailErr = validateEmailAddress(email);
    if (emailErr) {
      setErrorMsg(emailErr);
      return;
    }

    setForgotBusy(true);
    try {
      const res = await apiRequest<{ ok: true; message: string }>('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      dispatch(showToast({ variant: 'info', message: res.message }));
      setViewMode('password_step');
      if (location.pathname === '/forgot-password') {
        navigate('/login', { replace: true });
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to process password reset.');
    } finally {
      setForgotBusy(false);
    }
  };

  const handleCompleteSocialEmail = async (e: FormEvent) => {
    e.preventDefault();
    if (!socialEmailChallenge) return;
    setErrorMsg(null);
    const check = validateEmailFirstStep(challengeEmail);
    if (!check.valid) {
      setErrorMsg(check.error || 'Please enter a valid email address.');
      return;
    }

    setChallengeBusy(true);
    try {
      const res = await fetch('/api/auth/oauth/complete-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          challengeToken: socialEmailChallenge.challengeToken,
          email: check.normalizedEmail,
          name: challengeName.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok && res.status !== 409) {
        throw new Error(data.error || data.message || 'Unable to complete Facebook sign-in.');
      }
      if (data.status === 'authenticated' && data.user) {
        await dispatch(completeOAuthSession({ user: data.user as UserProfile, token: data.token }));
        dispatch(showToast({ variant: 'success', message: `Welcome, ${(data.user as UserProfile).name}!` }));
        navigate(redirectTarget, { replace: true });
        return;
      }
      if (data.status === 'link_required' && data.pendingLinkToken) {
        setLinkChallenge({
          pendingLinkToken: data.pendingLinkToken,
          provider: 'facebook',
          emailHint: data.emailHint || check.normalizedEmail,
          existingHasPassword: data.existingHasPassword !== false,
          existingInitialProvider: data.existingInitialProvider || 'local',
        });
        setViewMode('oauth_link_challenge');
        return;
      }
      if (data.status === 'verification_required') {
        setChallengeVerificationNotice(
          data.message || `Please verify ${check.normalizedEmail} via the verification link we sent to complete sign-in.`,
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to complete Facebook registration.');
    } finally {
      setChallengeBusy(false);
    }
  };

  const handleConfirmOAuthLink = async (e: FormEvent) => {
    e.preventDefault();
    if (!linkChallenge) return;
    setErrorMsg(null);
    if (!linkPassword) {
      setErrorMsg('Please enter your existing account password to verify ownership.');
      return;
    }

    setChallengeBusy(true);
    try {
      const res = await apiRequest<{
        ok: true;
        user: UserProfile;
        token: string;
        returnTo?: string;
      }>('/api/auth/oauth/confirm-link', {
        method: 'POST',
        body: JSON.stringify({
          linkToken: linkChallenge.pendingLinkToken,
          password: linkPassword,
        }),
      });
      await dispatch(completeOAuthSession({ user: res.user, token: res.token }));
      dispatch(
        showToast({
          variant: 'success',
          message: `${linkChallenge.provider === 'google' ? 'Google' : 'Facebook'} linked to your account.`,
        }),
      );
      navigate(sanitizeAuthRedirectPath(res.returnTo, redirectTarget), { replace: true });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Account verification failed.');
    } finally {
      setChallengeBusy(false);
    }
  };

  const handleResendVerification = async () => {
    if (!email.trim()) return;
    setResendBusy(true);
    try {
      const res = await apiRequest<{ ok: true; message: string }>('/api/auth/resend-verification', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      dispatch(showToast({ variant: 'success', message: res.message }));
    } catch (err) {
      dispatch(
        showToast({
          variant: 'warning',
          message: err instanceof Error ? err.message : 'Unable to resend verification email.',
        }),
      );
    } finally {
      setResendBusy(false);
    }
  };

  const handleOAuthClick = async (provider: 'google' | 'facebook') => {
    const enabled = provider === 'google' ? branding.enableGoogleLogin : branding.enableFacebookLogin;
    const configured = provider === 'google' ? providers.googleConfigured : providers.facebookConfigured;
    const providerLabel = provider === 'google' ? 'Google' : 'Facebook';

    if (!enabled) {
      const msg = `${providerLabel} sign-in is currently disabled by store administration.`;
      setErrorMsg(msg);
      return;
    }

    if (!configured) {
      const envHint =
        provider === 'google'
          ? 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET'
          : 'FACEBOOK_APP_ID and FACEBOOK_APP_SECRET';
      const msg = `${providerLabel} OAuth is not configured on the server yet (${envHint} required).`;
      setErrorMsg(msg);
      dispatch(showToast({ variant: 'warning', message: msg }));
      return;
    }

    clearPopupTimer();
    setOauthBusy(provider);
    setErrorMsg(null);
    try {
      const res = await apiRequest<{ ok: true; url: string; callbackOrigin?: string }>(
        `/api/auth/oauth/${provider}/url?returnTo=${encodeURIComponent(redirectTarget)}`,
      );
      expectedCallbackOriginRef.current = res.callbackOrigin || window.location.origin;
      const popup = window.open(
        res.url,
        `novara_${provider}_oauth`,
        OAUTH_POPUP_WINDOW_FEATURES,
      );
      if (!popup || popup.closed) {
        window.location.href = `/api/auth/oauth/${provider}?mode=redirect&returnTo=${encodeURIComponent(redirectTarget)}`;
        return;
      }
      oauthPopupRef.current = popup;
      popupTimerRef.current = window.setInterval(() => {
        try {
          if (popup.closed) {
            clearPopupTimer();
            oauthPopupRef.current = null;
            setOauthBusy(null);
          }
        } catch {
          clearPopupTimer();
          oauthPopupRef.current = null;
          setOauthBusy(null);
        }
      }, 450);
    } catch (err) {
      clearPopupTimer();
      oauthPopupRef.current = null;
      setOauthBusy(null);
      const message =
        err instanceof ApiError ? err.message : `Unable to initiate ${providerLabel} sign-in.`;
      setErrorMsg(message);
      dispatch(showToast({ variant: 'warning', message }));
    }
  };

  const showSocialButtons = branding.enableGoogleLogin || branding.enableFacebookLogin;

  const headingTitle =
    viewMode === 'forgot'
      ? 'Reset Password'
      : viewMode === 'social_email_challenge'
        ? 'Complete Facebook Sign-In'
        : viewMode === 'oauth_link_challenge'
          ? 'Link Social Provider'
          : viewMode === 'password_step'
            ? 'Enter Your Password'
            : branding.loginTitle;

  const headingSubtitle =
    viewMode === 'forgot'
      ? 'Enter your email address and we will send you a password reset link.'
      : viewMode === 'social_email_challenge'
        ? 'Facebook did not share an email address. Enter your email to finish creating or accessing your account.'
        : viewMode === 'oauth_link_challenge'
          ? 'Confirm ownership of your existing account before linking this social sign-in method.'
          : viewMode === 'password_step'
            ? 'Enter your password to sign in or return to change your email.'
            : branding.loginSubtitle;

  return (
    <div className="w-full overflow-hidden rounded-[24px] sm:rounded-[26px] border border-white/90 bg-white shadow-[0_26px_70px_-18px_rgba(17,85,238,0.22)]">
      <div className="grid grid-cols-1 lg:grid-cols-[46%_54%]">
        {/* LEFT COLUMN — DYNAMIC BRANDING & SHOWCASE */}
        <AuthShowcasePanel
          headlineTop="Welcome Back"
          headlineHighlight={`To ${branding.effectiveBrandName.split(' ')[0]}!`}
          subtitle="Sign in to track orders, manage your wishlist, and enjoy instant checkout."
          features={LOGIN_FEATURES}
          branding={branding}
        />

        {/* RIGHT COLUMN — EMAIL-FIRST SIGN IN & CHALLENGES */}
        <div className="flex flex-col justify-center bg-white px-5 py-6 sm:px-9 sm:py-7 lg:px-10 lg:py-8">
          <div className="inline-flex w-fit items-center gap-1.5 rounded-full bg-[#DCE9FF] px-3.5 py-1 text-xs font-semibold text-[#1155EE]">
            <Users className="h-3.5 w-3.5" />
            <span>Welcome to {branding.effectiveBrandName}</span>
          </div>

          <h1 className="font-display mt-2.5 text-[24px] sm:text-[28px] font-extrabold leading-tight tracking-tight text-[#0F1D3A]">
            {headingTitle}
          </h1>
          <p className="mt-1 text-[13.5px] text-[#3E5278]">{headingSubtitle}</p>

          {/* Already Logged In State Notice */}
          {user && viewMode !== 'oauth_link_challenge' && (
            <div className="mt-4 rounded-2xl border border-[#C7DAFF] bg-[#F2F7FF] p-3.5 text-sm text-[#0F1D3A]">
              <p className="font-semibold text-xs sm:text-sm">
                You are currently signed in as <span className="text-[#1155EE]">{user.email}</span>.
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <Link
                  to="/account"
                  className="rounded-lg bg-[#1155EE] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#0B44CC]"
                >
                  Go to My Account
                </Link>
                <Link
                  to="/shop"
                  className="rounded-lg border border-[#C7DAFF] bg-white px-3.5 py-1.5 text-xs font-semibold text-[#1155EE] hover:bg-blue-50"
                >
                  Continue Shopping
                </Link>
              </div>
            </div>
          )}

          {errorMsg && (
            <div
              role="alert"
              className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs leading-relaxed text-rose-800"
            >
              <div className="flex items-start gap-2.5">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                <div className="space-y-1.5">
                  <p className="font-medium">{errorMsg}</p>
                  {errorCode === 'EMAIL_NOT_VERIFIED' && (
                    <button
                      type="button"
                      disabled={resendBusy}
                      onClick={handleResendVerification}
                      className="text-xs font-semibold text-[#1155EE] underline hover:text-[#0B44CC]"
                    >
                      {resendBusy ? 'Sending verification link...' : 'Resend verification email'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* STEP 1: EMAIL-FIRST ENTRY */}
          {viewMode === 'email_step' && (
            <>
              <form onSubmit={handleContinueEmail} noValidate className="mt-5 space-y-4">
                <div>
                  <label
                    htmlFor="login-email"
                    className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-bold text-[#0F1D3A]"
                  >
                    <Mail className="h-3.5 w-3.5 text-[#0F1D3A]" />
                    <span>
                      Email Address <span className="text-[#0F1D3A]">*</span>
                    </span>
                  </label>
                  <div className="relative">
                    <ArrowRight className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#697B9B]" />
                    <input
                      ref={emailInputRef}
                      id="login-email"
                      name="email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      enterKeyHint="next"
                      required
                      value={email}
                      onChange={(e) => {
                        setErrorMsg(null);
                        setEmail(e.target.value);
                      }}
                      placeholder="name@example.com"
                      className="w-full rounded-xl border border-[#DCE7FB] bg-[#FBFCFF] py-3 pl-9 pr-3.5 text-sm text-[#0F1D3A] placeholder:text-[#5E7091] shadow-[0_2px_6px_rgba(17,85,238,0.03)] transition-colors focus:border-[#1155EE] focus:bg-white focus:outline-none focus:ring-3 focus:ring-[#1155EE]/12"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={identifying}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#2371FF] to-[#0D46E6] py-3 text-[14.5px] font-semibold text-white shadow-[0_12px_24px_-6px_rgba(17,85,238,0.45)] transition-all hover:from-[#1A63F0] hover:to-[#0A3AC7] disabled:cursor-not-allowed disabled:opacity-65"
                >
                  <span>{identifying ? 'Checking email...' : 'Continue'}</span>
                  {!identifying && <ArrowRight className="h-4 w-4" />}
                </button>
              </form>

              {showSocialButtons && (
                <>
                  <div className="my-5 flex items-center gap-3">
                    <span className="h-px flex-1 bg-[#E5EDFA]" />
                    <span className="text-xs font-medium text-[#3E5278]">or continue with</span>
                    <span className="h-px flex-1 bg-[#E5EDFA]" />
                  </div>

                  <div className={`grid grid-cols-1 gap-3 ${branding.enableGoogleLogin && branding.enableFacebookLogin ? 'sm:grid-cols-2' : ''}`}>
                    {branding.enableGoogleLogin && (
                      <button
                        type="button"
                        disabled={oauthBusy !== null}
                        onClick={() => handleOAuthClick('google')}
                        className="flex min-h-[44px] items-center justify-center gap-2.5 rounded-xl border border-[#DCE7FB] bg-white px-3.5 py-2.5 text-[13px] font-semibold text-[#162747] shadow-2xs transition-colors hover:border-[#AEC8FA] hover:bg-[#F6FAFF] disabled:opacity-60"
                      >
                        <svg className="h-[18px] w-[18px] shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                          <path
                            fill="#EA4335"
                            d="M12 5c1.6 0 3 .6 4.1 1.6l3.1-3.1C17.3 1.7 14.8 1 12 1 7.4 1 3.5 3.6 1.6 7.4l3.7 2.8C6.2 7.2 8.9 5 12 5z"
                          />
                          <path
                            fill="#4285F4"
                            d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.6l3.7 2.9c2.2-2 3.7-5 3.7-8.7z"
                          />
                          <path
                            fill="#FBBC05"
                            d="M5.3 14.8c-.2-.8-.4-1.8-.4-2.8s.2-2 .4-2.8L1.6 6.4C.6 8.1 0 10 0 12s.6 3.9 1.6 5.6l3.7-2.8z"
                          />
                          <path
                            fill="#34A853"
                            d="M12 23c3.2 0 6-1.1 8-2.9l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3.1 0-5.8-2.1-6.7-5l-3.7 2.8C3.5 20.4 7.4 23 12 23z"
                          />
                        </svg>
                        <span>{oauthBusy === 'google' ? 'Connecting...' : branding.googleButtonLabel}</span>
                      </button>
                    )}

                    {branding.enableFacebookLogin && (
                      <button
                        type="button"
                        disabled={oauthBusy !== null}
                        onClick={() => handleOAuthClick('facebook')}
                        className="flex min-h-[44px] items-center justify-center gap-2.5 rounded-xl border border-[#DCE7FB] bg-white px-3.5 py-2.5 text-[13px] font-semibold text-[#162747] shadow-2xs transition-colors hover:border-[#AEC8FA] hover:bg-[#F6FAFF] disabled:opacity-60"
                      >
                        <svg className="h-[18px] w-[18px] shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                          <circle cx="12" cy="12" r="11" fill="#1877F2" />
                          <path
                            fill="#FFFFFF"
                            d="M15.4 12.8l.4-2.6h-2.5V8.5c0-.7.3-1.4 1.5-1.4H16V4.9s-1-.2-2-.2c-2.1 0-3.5 1.3-3.5 3.6v1.9H8.2v2.6h2.3v6.5h2.8v-6.5h2.1z"
                          />
                        </svg>
                        <span>{oauthBusy === 'facebook' ? 'Connecting...' : branding.facebookButtonLabel}</span>
                      </button>
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {/* STEP 2: PASSWORD STEP AFTER EMAIL ENTRY */}
          {viewMode === 'password_step' && (
            <form onSubmit={handleLogin} noValidate className="mt-5 space-y-4">
              <div className="flex items-center justify-between gap-2 rounded-xl border border-[#DCE7FB] bg-[#F5F9FF] px-3.5 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <Mail className="h-4 w-4 shrink-0 text-[#1155EE]" />
                  <span className="truncate text-sm font-semibold text-[#0F1D3A]">{email}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg(null);
                    setErrorCode(null);
                    setViewMode('email_step');
                  }}
                  className="shrink-0 rounded-lg px-2 py-1 text-xs font-bold text-[#1155EE] hover:bg-[#E4EEFF]"
                >
                  Change
                </button>
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <label
                    htmlFor="login-password"
                    className="flex items-center gap-1.5 text-[12.5px] font-bold text-[#0F1D3A]"
                  >
                    <Lock className="h-3.5 w-3.5 text-[#0F1D3A]" />
                    <span>
                      Password <span className="text-[#0F1D3A]">*</span>
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMsg(null);
                      setViewMode('forgot');
                    }}
                    className="text-xs font-semibold text-[#1155EE] hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <input
                    ref={passwordInputRef}
                    id="login-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    enterKeyHint="done"
                    autoFocus
                    required
                    value={password}
                    onChange={(e) => {
                      setErrorMsg(null);
                      setPassword(e.target.value);
                    }}
                    placeholder="Enter your password"
                    className="w-full rounded-xl border border-[#DCE7FB] bg-[#FBFCFF] py-3 pl-3.5 pr-11 text-sm text-[#0F1D3A] placeholder:text-[#5E7091] shadow-[0_2px_6px_rgba(17,85,238,0.03)] transition-colors focus:border-[#1155EE] focus:bg-white focus:outline-none focus:ring-3 focus:ring-[#1155EE]/12"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#0F1D3A]/75 hover:text-[#1155EE]"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#2371FF] to-[#0D46E6] py-3 text-[14.5px] font-semibold text-white shadow-[0_12px_24px_-6px_rgba(17,85,238,0.45)] transition-all hover:from-[#1A63F0] hover:to-[#0A3AC7] disabled:cursor-not-allowed disabled:opacity-65"
              >
                <LogIn className="h-4 w-4" />
                <span>{loading ? 'Signing In...' : 'Sign In'}</span>
                {!loading && <ArrowRight className="h-4 w-4" />}
              </button>
            </form>
          )}

          {/* FORGOT PASSWORD VIEW */}
          {viewMode === 'forgot' && (
            <form onSubmit={handleForgot} noValidate className="mt-5 space-y-4">
              <div>
                <label
                  htmlFor="forgot-email"
                  className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-bold text-[#0F1D3A]"
                >
                  <Mail className="h-3.5 w-3.5 text-[#0F1D3A]" />
                  <span>
                    Account Email Address <span className="text-[#0F1D3A]">*</span>
                  </span>
                </label>
                <input
                  id="forgot-email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => {
                    setErrorMsg(null);
                    setEmail(e.target.value);
                  }}
                  placeholder="Enter your registered email"
                  className="w-full rounded-xl border border-[#DCE7FB] bg-[#FBFCFF] px-3.5 py-3 text-sm text-[#0F1D3A] placeholder:text-[#5E7091] shadow-[0_2px_6px_rgba(17,85,238,0.03)] transition-colors focus:border-[#1155EE] focus:bg-white focus:outline-none focus:ring-3 focus:ring-[#1155EE]/12"
                />
              </div>

              <button
                type="submit"
                disabled={forgotBusy}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#2371FF] to-[#0D46E6] py-3 text-[14.5px] font-semibold text-white shadow-[0_12px_24px_-6px_rgba(17,85,238,0.45)] transition-all hover:from-[#1A63F0] hover:to-[#0A3AC7] disabled:opacity-65"
              >
                <span>{forgotBusy ? 'Sending Link...' : 'Send Reset Link'}</span>
                {!forgotBusy && <ArrowRight className="h-4 w-4" />}
              </button>

              <button
                type="button"
                onClick={() => {
                  setErrorMsg(null);
                  setViewMode(email.trim() ? 'password_step' : 'email_step');
                  if (location.pathname === '/forgot-password') {
                    navigate('/login');
                  }
                }}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-[#DCE7FB] bg-white py-2.5 text-xs font-semibold text-[#0F1D3A] hover:border-[#AEC8FA] hover:bg-[#F6FAFF]"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Back to Sign In</span>
              </button>
            </form>
          )}

          {/* FACEBOOK MISSING-EMAIL CHALLENGE */}
          {viewMode === 'social_email_challenge' && socialEmailChallenge && (
            <div className="mt-5 space-y-4">
              {challengeVerificationNotice ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-800 space-y-2">
                  <div className="flex items-center gap-2 font-bold text-sm">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    <span>Verification Required</span>
                  </div>
                  <p>{challengeVerificationNotice}</p>
                </div>
              ) : (
                <form onSubmit={handleCompleteSocialEmail} noValidate className="space-y-4">
                  <div>
                    <label
                      htmlFor="fb-missing-email"
                      className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-bold text-[#0F1D3A]"
                    >
                      <Mail className="h-3.5 w-3.5 text-[#1155EE]" />
                      <span>Email Address *</span>
                    </label>
                    <input
                      id="fb-missing-email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      required
                      value={challengeEmail}
                      onChange={(e) => setChallengeEmail(e.target.value)}
                      placeholder="Enter your email address"
                      className="w-full rounded-xl border border-[#DCE7FB] bg-[#FBFCFF] px-3.5 py-2.5 text-sm text-[#0F1D3A]"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="fb-missing-name"
                      className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-bold text-[#0F1D3A]"
                    >
                      <User className="h-3.5 w-3.5 text-[#1155EE]" />
                      <span>Display Name</span>
                    </label>
                    <input
                      id="fb-missing-name"
                      type="text"
                      value={challengeName}
                      onChange={(e) => setChallengeName(e.target.value)}
                      placeholder="Your full name"
                      className="w-full rounded-xl border border-[#DCE7FB] bg-[#FBFCFF] px-3.5 py-2.5 text-sm text-[#0F1D3A]"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={challengeBusy}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1155EE] py-3 text-sm font-semibold text-white hover:bg-[#0B44CC] disabled:opacity-60"
                  >
                    <span>{challengeBusy ? 'Saving...' : 'Complete Facebook Sign-In'}</span>
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </form>
              )}

              <button
                type="button"
                onClick={() => {
                  setErrorMsg(null);
                  setChallengeVerificationNotice(null);
                  setViewMode('email_step');
                }}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-[#DCE7FB] bg-white py-2.5 text-xs font-semibold text-[#0F1D3A]"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Cancel &amp; Use Email Instead</span>
              </button>
            </div>
          )}

          {/* EXPLICIT SAFE ACCOUNT LINK CONFIRMATION */}
          {viewMode === 'oauth_link_challenge' && linkChallenge && (
            <div className="mt-5 space-y-4">
              <div className="rounded-2xl border border-[#C7DAFF] bg-[#F2F7FF] p-4 text-xs leading-relaxed text-[#0F1D3A] space-y-1.5">
                <div className="flex items-center gap-2 font-bold text-[#1155EE]">
                  <Link2 className="h-4 w-4" />
                  <span>Confirm Account Ownership</span>
                </div>
                <p>
                  An account already exists for <strong>{linkChallenge.emailHint}</strong>. For your security,{' '}
                  {linkChallenge.provider === 'google' ? 'Google' : 'Facebook'} is never auto-linked without verification.
                </p>
              </div>

              {linkChallenge.existingHasPassword ? (
                <form onSubmit={handleConfirmOAuthLink} noValidate className="space-y-4">
                  <div>
                    <label
                      htmlFor="link-confirm-password"
                      className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-bold text-[#0F1D3A]"
                    >
                      <Lock className="h-3.5 w-3.5 text-[#1155EE]" />
                      <span>Existing Account Password *</span>
                    </label>
                    <input
                      id="link-confirm-password"
                      type="password"
                      autoComplete="current-password"
                      required
                      value={linkPassword}
                      onChange={(e) => setLinkPassword(e.target.value)}
                      placeholder="Enter your password to link provider"
                      className="w-full rounded-xl border border-[#DCE7FB] bg-[#FBFCFF] px-3.5 py-2.5 text-sm text-[#0F1D3A]"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={challengeBusy}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1155EE] py-3 text-sm font-semibold text-white hover:bg-[#0B44CC] disabled:opacity-60"
                  >
                    <span>
                      {challengeBusy
                        ? 'Linking Account...'
                        : `Verify & Link ${linkChallenge.provider === 'google' ? 'Google' : 'Facebook'}`}
                    </span>
                  </button>
                </form>
              ) : (
                <p className="text-xs leading-relaxed text-slate-600">
                  Your existing account uses <strong>{linkChallenge.existingInitialProvider}</strong> authentication without
                  a password. Please sign in with {linkChallenge.existingInitialProvider}, then connect{' '}
                  {linkChallenge.provider === 'google' ? 'Google' : 'Facebook'} from{' '}
                  <strong>Account &rarr; Security</strong>.
                </p>
              )}

              <button
                type="button"
                onClick={() => {
                  setErrorMsg(null);
                  setLinkPassword('');
                  setViewMode('email_step');
                }}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-[#DCE7FB] bg-white py-2.5 text-xs font-semibold text-[#0F1D3A]"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Back to Sign In</span>
              </button>
            </div>
          )}

          {/* Create Account Footer Link */}
          <p className="mt-6 text-center text-[13px] text-[#3E5278]">
            New to {branding.effectiveBrandName}?{' '}
            <Link
              to={buildRegisterLink()}
              className="inline-flex items-center gap-1 font-semibold text-[#1155EE] hover:underline"
            >
              <span>Create Account</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
