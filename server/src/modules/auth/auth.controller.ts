import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { UserModel } from '../users/user.model';
import { HomepageConfigModel } from '../cms/cms.model';
import { isDatabaseReady } from '../../database/connection';
import { type AuthenticatedRequest } from '../../middleware/auth.middleware';
import { AppError } from '../../middleware/error.middleware';
import { env, getOAuthCallbackCatalog, integrations } from '../../config/env';
import { sendTransactionalEmail } from '../../services/email.service';
import {
  DEFAULT_AUTH_SETTINGS,
  OAUTH_BROADCAST_CHANNEL,
  mergeAuthBrandingSettings,
  sanitizeAuthRedirectPath,
} from '../../../../src/lib/authValidation';
import {
  changePasswordSchema,
  completeSocialEmailSchema,
  confirmOAuthLinkSchema,
  forgotPasswordSchema,
  identifyEmailSchema,
  loginSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  setPasswordSchema,
  updateProfileSchema,
  verifyEmailSchema,
} from './auth.validation';
import {
  completeFacebookMissingEmail,
  confirmOAuthLinkAccount,
  getLinkedProvidersForUser,
  listUserSessions,
  loginWithEmailPassword,
  registerCustomerAccount,
  resendCustomerVerification,
  resolveOrChallengeOAuthUser,
  revokeAllUserSessions,
  revokeUserSession,
  serializeUser,
  setPasswordForSocialUser,
  unlinkProviderForUser,
  verifyCustomerEmail,
} from './auth.service';
import {
  buildFacebookAuthorizationUrl,
  buildGoogleAuthorizationUrl,
  consumeAndVerifyOAuthStateToken,
  createOAuthStateToken,
  exchangeAndVerifyFacebookCode,
  exchangeAndVerifyGoogleCode,
  generatePkcePair,
  resolveCanonicalOrigin,
  resolveOAuthCallbackUrl,
  signPendingSocialEmailToken,
  type OAuthIntent,
  type OAuthMode,
  type OAuthProvider,
} from './oauth.service';

const OAUTH_STATE_COOKIE = 'novara_oauth_state';

export function getAuthCookieOptions(req: Request) {
  const isHttps =
    env.COOKIE_SECURE ||
    req.secure ||
    req.get('x-forwarded-proto') === 'https';

  return {
    httpOnly: true,
    sameSite: (isHttps ? 'none' : 'lax') as 'none' | 'lax',
    secure: isHttps,
    path: '/',
  };
}

export function setAuthCookie(req: Request, res: Response, token: string, timeoutHours = 168): void {
  res.cookie('novara_token', token, {
    ...getAuthCookieOptions(req),
    maxAge: Math.min(720, Math.max(1, timeoutHours)) * 60 * 60 * 1000,
  });
}

function getClientIp(req: Request): string {
  const forwarded = req.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || req.ip || '';
}

export type OAuthCallbackPayload =
  | {
      type: 'OAUTH_AUTH_SUCCESS';
      provider: OAuthProvider;
      user: ReturnType<typeof serializeUser>;
      token: string;
      returnTo?: string;
    }
  | {
      type: 'OAUTH_LINK_SUCCESS';
      provider: OAuthProvider;
      user: ReturnType<typeof serializeUser>;
      token: string;
      returnTo?: string;
    }
  | {
      type: 'OAUTH_EMAIL_REQUIRED';
      provider: 'facebook';
      challengeToken: string;
      name: string;
      picture?: string;
      returnTo?: string;
    }
  | {
      type: 'OAUTH_LINK_REQUIRED';
      provider: OAuthProvider;
      pendingLinkToken: string;
      emailHint: string;
      existingHasPassword: boolean;
      existingInitialProvider: string;
      returnTo?: string;
    }
  | {
      type: 'OAUTH_AUTH_ERROR';
      provider: OAuthProvider;
      error: string;
    };

export function buildOAuthCallbackHtml(
  payload: OAuthCallbackPayload,
  options?: { targetOrigin?: string; mode?: OAuthMode },
): string {
  const enrichedPayload = {
    ...payload,
    eventId: crypto.randomBytes(12).toString('hex'),
  };
  const serialized = JSON.stringify(enrichedPayload).replace(/</g, '\\u003c');
  const mode: OAuthMode = options?.mode === 'redirect' ? 'redirect' : 'popup';
  const rawOrigin = String(options?.targetOrigin || '').trim();
  const targetOrigin = /^https?:\/\/[^/]+$/i.test(rawOrigin) ? rawOrigin.replace(/\/$/, '') : '';

  const isSuccess = payload.type === 'OAUTH_AUTH_SUCCESS' || payload.type === 'OAUTH_LINK_SUCCESS';
  const titleText = isSuccess
    ? 'Authentication successful'
    : payload.type === 'OAUTH_EMAIL_REQUIRED' || payload.type === 'OAUTH_LINK_REQUIRED'
      ? 'Additional step required'
      : 'Authentication cancelled';

  const fallbackPath = isSuccess
    ? sanitizeAuthRedirectPath(payload.returnTo, payload.type === 'OAUTH_LINK_SUCCESS' ? '/account/security' : '/')
    : payload.type === 'OAUTH_EMAIL_REQUIRED'
      ? `/login?oauthChallenge=${encodeURIComponent(payload.challengeToken)}&oauthAction=email_required`
      : payload.type === 'OAUTH_LINK_REQUIRED'
        ? `/login?pendingLinkToken=${encodeURIComponent(payload.pendingLinkToken)}&oauthAction=link_required&provider=${payload.provider}&emailHint=${encodeURIComponent(payload.emailHint)}`
        : `/login?authError=${encodeURIComponent(payload.error || 'oauth_failed')}`;

  const fallbackUrl = targetOrigin ? `${targetOrigin}${fallbackPath}` : fallbackPath;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>NOVARA Authentication</title>
  </head>
  <body style="font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f4f8ff;color:#0f1d3a;">
    <div style="text-align:center;padding:28px;max-width:360px;background:#fff;border-radius:20px;border:1px solid #dce7fb;box-shadow:0 16px 40px -12px rgba(17,85,238,0.18);">
      <p style="font-weight:700;font-size:16px;margin:0 0 8px;">${titleText}</p>
      <p id="novara-oauth-status" style="font-size:13px;color:#475569;margin:0 0 16px;">Returning you to NOVARA COMMERCE...</p>
      <div id="novara-oauth-actions" style="display:none;gap:8px;justify-content:center;flex-wrap:wrap;">
        <button id="novara-close-btn" type="button" style="cursor:pointer;border:none;border-radius:10px;background:#1155ee;color:#fff;font-weight:600;font-size:13px;padding:9px 16px;">Close Window</button>
        <a id="novara-continue-link" href="${fallbackUrl}" style="display:inline-block;border-radius:10px;border:1px solid #cbd5e1;background:#fff;color:#0f1d3a;text-decoration:none;font-weight:600;font-size:13px;padding:8px 14px;">Continue</a>
      </div>
    </div>
    <script>
      (function () {
        var msg = ${serialized};
        var mode = ${JSON.stringify(mode)};
        var configuredTargetOrigin = ${JSON.stringify(targetOrigin)};
        var targetOrigin = configuredTargetOrigin || window.location.origin;
        var fallbackUrl = ${JSON.stringify(fallbackUrl)};
        var deliveredToOpener = false;

        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(msg, targetOrigin);
            deliveredToOpener = true;
          }
        } catch (_err) {}

        try {
          if (typeof BroadcastChannel !== 'undefined' && window.location.origin === targetOrigin) {
            var ch = new BroadcastChannel(${JSON.stringify(OAUTH_BROADCAST_CHANNEL)});
            ch.postMessage(msg);
            setTimeout(function () {
              try { ch.close(); } catch (_e) {}
            }, 250);
          }
        } catch (_err) {}

        var closeBtn = document.getElementById('novara-close-btn');
        if (closeBtn) {
          closeBtn.addEventListener('click', function () {
            try { window.close(); } catch (_e) {}
          });
        }

        if (mode === 'redirect' && !deliveredToOpener) {
          window.location.replace(fallbackUrl);
          return;
        }

        try {
          window.close();
        } catch (_e) {}

        setTimeout(function () {
          try { window.close(); } catch (_e) {}
        }, 120);

        setTimeout(function () {
          var statusEl = document.getElementById('novara-oauth-status');
          var actionsEl = document.getElementById('novara-oauth-actions');
          if (statusEl) {
            statusEl.textContent = deliveredToOpener
              ? 'Authentication completed. You may close this window.'
              : 'Authentication completed. Your main NOVARA tab has been updated — you may close this window.';
          }
          if (actionsEl) {
            actionsEl.style.display = 'flex';
          }
        }, 420);
      })();
    </script>
  </body>
</html>`;
}

export async function getAuthProviders(req: Request, res: Response): Promise<void> {
  let rawAuthSettings = null;
  let rawStoreInfo = null;
  let requireEmailVerification = false;

  if (isDatabaseReady()) {
    try {
      const cfg = await HomepageConfigModel.findOne({ key: 'main' })
        .select('authSettings storeInfo securitySettings')
        .lean();
      rawAuthSettings = cfg?.authSettings || null;
      rawStoreInfo = cfg?.storeInfo || null;
      requireEmailVerification = Boolean(cfg?.securitySettings?.requireEmailVerification);
    } catch {
      // Fallback cleanly to defaults if DB query fails
    }
  }

  const branding = mergeAuthBrandingSettings(rawAuthSettings, rawStoreInfo);
  const origin = resolveCanonicalOrigin(req);
  const callbacks = getOAuthCallbackCatalog(origin);

  res.json({
    ok: true,
    providers: {
      emailPassword: true,
      google: integrations.googleOAuth && branding.enableGoogleLogin,
      facebook: integrations.facebookOAuth && branding.enableFacebookLogin,
      googleConfigured: integrations.googleOAuth,
      facebookConfigured: integrations.facebookOAuth,
      emailVerificationRequired: integrations.resend || requireEmailVerification,
    },
    branding,
    authSettings: {
      ...DEFAULT_AUTH_SETTINGS,
      ...(rawAuthSettings || {}),
    },
    callbacks,
  });
}

export async function identifyEmailController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = identifyEmailSchema.parse(req.body);
    // Avoid user-existence oracle: validate & normalize email cleanly and return non-enumerating guidance
    res.json({
      ok: true,
      email: parsed.email,
      step: 'credentials',
    });
  } catch (err) {
    next(err);
  }
}

export async function registerController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = registerSchema.parse(req.body);
    const result = await registerCustomerAccount(parsed, {
      originUrl: resolveCanonicalOrigin(req),
      userAgent: req.get('user-agent'),
      ipAddress: getClientIp(req),
    });
    if (result.token) {
      setAuthCookie(req, res, result.token, result.sessionTimeoutHours);
    }
    res.status(201).json({
      ok: true,
      user: result.user,
      token: result.token || undefined,
      requiresVerification: result.requiresVerification,
      message: result.requiresVerification
        ? 'Account created! Please check your email to verify your address before signing in.'
        : 'Account created and signed in.',
    });
  } catch (err) {
    next(err);
  }
}

export async function loginController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = loginSchema.parse(req.body);
    const result = await loginWithEmailPassword({
      ...parsed,
      userAgent: req.get('user-agent'),
      ipAddress: getClientIp(req),
    });
    setAuthCookie(req, res, result.token, result.sessionTimeoutHours);
    res.json({ ok: true, user: result.user, token: result.token });
  } catch (err) {
    next(err);
  }
}

export async function adminLoginController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = loginSchema.parse(req.body);
    const result = await loginWithEmailPassword({
      ...parsed,
      requireAdminStaff: true,
      userAgent: req.get('user-agent'),
      ipAddress: getClientIp(req),
    });
    setAuthCookie(req, res, result.token, result.sessionTimeoutHours);
    res.json({ ok: true, user: result.user, token: result.token });
  } catch (err) {
    next(err);
  }
}

export async function logoutController(req: AuthenticatedRequest, res: Response): Promise<void> {
  if (req.user && req.sessionId) {
    await revokeUserSession(String(req.user._id), req.sessionId).catch(() => undefined);
  }
  res.clearCookie('novara_token', getAuthCookieOptions(req));
  res.json({ ok: true });
}

export function meController(req: AuthenticatedRequest, res: Response): void {
  res.json({ ok: true, user: serializeUser(req.user!) });
}

export async function verifyEmailController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const source = req.method === 'GET' ? req.query : req.body;
    const parsed = verifyEmailSchema.parse(source);
    const result = await verifyCustomerEmail(parsed, {
      userAgent: req.get('user-agent'),
      ipAddress: getClientIp(req),
    });
    setAuthCookie(req, res, result.token, result.sessionTimeoutHours);
    res.json({
      ok: true,
      user: result.user,
      token: result.token,
      message: 'Your email address has been verified and your account is now active.',
    });
  } catch (err) {
    next(err);
  }
}

export async function resendVerificationController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = resendVerificationSchema.parse(req.body);
    const result = await resendCustomerVerification(parsed.email, resolveCanonicalOrigin(req));
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
}

export async function updateProfileController(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = updateProfileSchema.parse(req.body);
    const user = req.user!;
    user.name = parsed.name;
    const parts = parsed.name.split(' ');
    user.givenName = parts[0] || '';
    user.familyName = parts.length > 1 ? parts.slice(1).join(' ') : '';
    if (parsed.phone !== undefined) user.phone = parsed.phone;
    if (parsed.avatarUrl !== undefined) {
      user.avatarUrl = parsed.avatarUrl;
      user.avatarSources = {
        ...user.avatarSources,
        uploaded: parsed.avatarUrl,
      };
    }
    if (parsed.notificationPrefs) user.notificationPrefs = parsed.notificationPrefs;
    await user.save();
    res.json({ ok: true, user: serializeUser(user) });
  } catch (err) {
    next(err);
  }
}

export async function changePasswordController(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = changePasswordSchema.parse(req.body);
    const user = await UserModel.findById(req.user!._id).select('+passwordHash');
    if (!user || !user.passwordHash) {
      throw new AppError(400, 'NO_PASSWORD_SET', 'This account does not have a password yet. Use Set Password instead.');
    }
    const valid = await bcrypt.compare(parsed.currentPassword, user.passwordHash);
    if (!valid) {
      throw new AppError(401, 'INVALID_PASSWORD', 'Current password is incorrect.');
    }
    user.passwordHash = await bcrypt.hash(parsed.newPassword, 12);
    await user.save();
    res.json({ ok: true, message: 'Password updated successfully.' });
  } catch (err) {
    next(err);
  }
}

export async function setPasswordController(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = setPasswordSchema.parse(req.body);
    const user = await setPasswordForSocialUser(String(req.user!._id), parsed.newPassword);
    res.json({ ok: true, user, message: 'Password created! You can now sign in with email and password as well.' });
  } catch (err) {
    next(err);
  }
}

export async function forgotPasswordController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email } = forgotPasswordSchema.parse(req.body);
    const user = await UserModel.findOne({ email });
    if (user) {
      const rawToken = crypto.randomBytes(24).toString('hex');
      user.resetTokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      user.resetTokenExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
      await user.save();

      const origin = resolveCanonicalOrigin(req);
      const resetUrl = `${origin}/reset-password?token=${rawToken}&email=${encodeURIComponent(user.email)}`;
      await sendTransactionalEmail({
        to: user.email,
        template: 'password_reset',
        subject: 'Reset your NOVARA COMMERCE password',
        html: `<p>Click the link below to reset your password (valid for 30 minutes):</p><p><a href="${resetUrl}">Reset Password</a></p>`,
      });
    }
    res.json({
      ok: true,
      message: 'If an account matches that email, password reset instructions have been sent.',
    });
  } catch (err) {
    next(err);
  }
}

export async function resetPasswordController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = resetPasswordSchema.parse(req.body);
    const tokenHash = crypto.createHash('sha256').update(parsed.token).digest('hex');

    const user = await UserModel.findOne({
      email: parsed.email,
      resetTokenHash: tokenHash,
      resetTokenExpiresAt: { $gt: new Date() },
    }).select('+resetTokenHash +resetTokenExpiresAt');

    if (!user) {
      throw new AppError(400, 'INVALID_RESET_TOKEN', 'Reset link is invalid or has expired.');
    }

    user.passwordHash = await bcrypt.hash(parsed.newPassword, 12);
    user.resetTokenHash = undefined;
    user.resetTokenExpiresAt = undefined;
    await user.save();

    res.json({ ok: true, message: 'Your password has been reset. You can now sign in.' });
  } catch (err) {
    next(err);
  }
}

export async function completeSocialEmailController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = completeSocialEmailSchema.parse(req.body);
    const result = await completeFacebookMissingEmail({
      ...parsed,
      originUrl: resolveCanonicalOrigin(req),
      userAgent: req.get('user-agent'),
      ipAddress: getClientIp(req),
    });

    if (result.status === 'authenticated') {
      setAuthCookie(req, res, result.token, result.sessionTimeoutHours);
      res.json({
        ok: true,
        status: 'authenticated',
        user: result.user,
        token: result.token,
        returnTo: result.returnTo,
      });
      return;
    }

    if (result.status === 'link_required') {
      res.status(409).json({
        ok: true,
        status: 'link_required',
        provider: result.provider,
        pendingLinkToken: result.pendingLinkToken,
        emailHint: result.emailHint,
        existingHasPassword: result.existingHasPassword,
        existingInitialProvider: result.existingInitialProvider,
      });
      return;
    }

    res.status(201).json({
      ok: true,
      status: 'verification_required',
      user: result.user,
      message: result.message,
    });
  } catch (err) {
    next(err);
  }
}

export async function confirmOAuthLinkController(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = confirmOAuthLinkSchema.parse(req.body);
    const result = await confirmOAuthLinkAccount({
      linkToken: parsed.linkToken,
      password: parsed.password,
      authenticatedUserId: req.user ? String(req.user._id) : undefined,
      userAgent: req.get('user-agent'),
      ipAddress: getClientIp(req),
    });
    setAuthCookie(req, res, result.token, result.sessionTimeoutHours);
    res.json({
      ok: true,
      user: result.user,
      token: result.token,
      returnTo: result.returnTo,
    });
  } catch (err) {
    next(err);
  }
}

export async function getLinkedProvidersController(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await getLinkedProvidersForUser(String(req.user!._id));
    res.json({ ok: true, ...data });
  } catch (err) {
    next(err);
  }
}

export async function unlinkProviderController(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const provider = req.params.provider;
    if (provider !== 'google' && provider !== 'facebook') {
      throw new AppError(400, 'INVALID_PROVIDER', 'Only Google or Facebook social links can be disconnected.');
    }
    const user = await unlinkProviderForUser(String(req.user!._id), provider);
    res.json({ ok: true, user, message: `${provider === 'google' ? 'Google' : 'Facebook'} has been disconnected.` });
  } catch (err) {
    next(err);
  }
}

export async function listSessionsController(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const sessions = await listUserSessions(String(req.user!._id), req.sessionId);
    res.json({ ok: true, sessions });
  } catch (err) {
    next(err);
  }
}

export async function revokeSessionController(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { sessionId } = req.params;
    const result = await revokeUserSession(String(req.user!._id), sessionId);
    if (sessionId === req.sessionId) {
      res.clearCookie('novara_token', getAuthCookieOptions(req));
    }
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
}

export async function logoutAllSessionsController(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const includeCurrent = req.body?.includeCurrent === true;
    const result = await revokeAllUserSessions(
      String(req.user!._id),
      includeCurrent ? undefined : req.sessionId,
    );
    if (includeCurrent) {
      res.clearCookie('novara_token', getAuthCookieOptions(req));
    }
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
}

function initProviderAuthorization(
  req: AuthenticatedRequest,
  res: Response,
  provider: OAuthProvider,
  mode: OAuthMode,
): { url: string; callbackOrigin: string } {
  const intent: OAuthIntent = req.query.intent === 'link' ? 'link' : 'login';
  if (intent === 'link' && !req.user) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Sign in to link another social provider to your account.');
  }

  const cookieNonce = crypto.randomBytes(20).toString('hex');
  res.cookie(OAUTH_STATE_COOKIE, cookieNonce, {
    ...getAuthCookieOptions(req),
    maxAge: 10 * 60 * 1000,
  });

  const pkce = generatePkcePair();
  const oidcNonce = crypto.randomBytes(20).toString('hex');
  const origin = resolveCanonicalOrigin(req);
  const redirectUri = resolveOAuthCallbackUrl(provider, req);
  const callbackOrigin = new URL(redirectUri).origin;
  const returnTo = typeof req.query.returnTo === 'string' ? req.query.returnTo : '/';

  const state = createOAuthStateToken({
    provider,
    mode,
    intent,
    linkUserId: intent === 'link' && req.user ? String(req.user._id) : undefined,
    returnTo,
    origin,
    codeVerifier: pkce.codeVerifier,
    oidcNonce,
    cookieNonce,
  });

  if (provider === 'google') {
    return {
      url: buildGoogleAuthorizationUrl({
        clientId: env.GOOGLE_CLIENT_ID,
        redirectUri,
        state,
        codeChallenge: pkce.codeChallenge,
        oidcNonce,
      }),
      callbackOrigin,
    };
  }

  return {
    url: buildFacebookAuthorizationUrl({
      appId: env.FACEBOOK_APP_ID,
      redirectUri,
      state,
    }),
    callbackOrigin,
  };
}

export function googleOAuthUrlController(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  try {
    if (!integrations.googleOAuth) {
      res.status(503).json({
        ok: false,
        code: 'OAUTH_UNCONFIGURED',
        error: 'Google OAuth is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing).',
      });
      return;
    }
    const { url, callbackOrigin } = initProviderAuthorization(req, res, 'google', 'popup');
    res.json({ ok: true, url, callbackOrigin });
  } catch (err) {
    next(err);
  }
}

export function googleOAuthRedirectController(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  try {
    if (!integrations.googleOAuth) {
      res.status(503).json({
        ok: false,
        code: 'OAUTH_UNCONFIGURED',
        error: 'Google OAuth is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing).',
      });
      return;
    }
    const mode: OAuthMode = req.query.mode === 'popup' ? 'popup' : 'redirect';
    const { url } = initProviderAuthorization(req, res, 'google', mode);
    res.redirect(url);
  } catch (err) {
    next(err);
  }
}

export async function googleOAuthCallbackController(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  let verifiedState: ReturnType<typeof consumeAndVerifyOAuthStateToken> | null = null;
  try {
    if (!integrations.googleOAuth) {
      throw new AppError(503, 'OAUTH_UNCONFIGURED', 'Google OAuth is not configured.');
    }

    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');

    const stateParam = String(req.query.state || '');
    const cookieNonce = req.cookies?.[OAUTH_STATE_COOKIE] as string | undefined;
    res.clearCookie(OAUTH_STATE_COOKIE, getAuthCookieOptions(req));

    const fallbackOrigin = resolveCanonicalOrigin(req);

    try {
      verifiedState = consumeAndVerifyOAuthStateToken({
        stateToken: stateParam,
        expectedProvider: 'google',
        cookieNonce,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid or expired Google OAuth security state.';
      res.status(400).send(
        buildOAuthCallbackHtml(
          { type: 'OAUTH_AUTH_ERROR', provider: 'google', error: msg },
          { targetOrigin: fallbackOrigin, mode: 'popup' },
        ),
      );
      return;
    }

    const providerError = typeof req.query.error === 'string' ? req.query.error : '';
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (providerError || !code) {
      const errMsg = providerError === 'access_denied' ? 'Google sign-in was cancelled.' : 'Google authorization failed.';
      if (verifiedState.mode === 'popup') {
        res.send(
          buildOAuthCallbackHtml(
            { type: 'OAUTH_AUTH_ERROR', provider: 'google', error: errMsg },
            { targetOrigin: verifiedState.origin, mode: 'popup' },
          ),
        );
      } else {
        res.redirect(`${verifiedState.origin}/login?authError=${encodeURIComponent(errMsg)}`);
      }
      return;
    }

    const redirectUri = resolveOAuthCallbackUrl('google', req);
    let profile;
    try {
      profile = await exchangeAndVerifyGoogleCode({
        code,
        codeVerifier: verifiedState.codeVerifier,
        redirectUri,
        expectedNonce: verifiedState.oidcNonce,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Google token verification failed.';
      if (verifiedState.mode === 'popup') {
        res.send(
          buildOAuthCallbackHtml(
            { type: 'OAUTH_AUTH_ERROR', provider: 'google', error: errMsg },
            { targetOrigin: verifiedState.origin, mode: 'popup' },
          ),
        );
      } else {
        res.redirect(`${verifiedState.origin}/login?authError=${encodeURIComponent(errMsg)}`);
      }
      return;
    }

    const resolution = await resolveOrChallengeOAuthUser({
      provider: 'google',
      providerId: profile.providerUserId,
      email: profile.email,
      name: profile.name,
      givenName: profile.givenName,
      familyName: profile.familyName,
      picture: profile.picture,
      emailVerified: profile.emailVerified,
      intent: verifiedState.intent,
      authenticatedUserId: verifiedState.linkUserId || (req.user ? String(req.user._id) : undefined),
      returnTo: verifiedState.returnTo,
      userAgent: req.get('user-agent'),
      ipAddress: getClientIp(req),
    });

    if (resolution.status === 'link_required') {
      const payload = {
        type: 'OAUTH_LINK_REQUIRED' as const,
        provider: 'google' as const,
        pendingLinkToken: resolution.pendingLinkToken,
        emailHint: resolution.emailHint,
        existingHasPassword: resolution.existingHasPassword,
        existingInitialProvider: resolution.existingInitialProvider,
        returnTo: verifiedState.returnTo,
      };
      if (verifiedState.mode === 'popup') {
        res.send(buildOAuthCallbackHtml(payload, { targetOrigin: verifiedState.origin, mode: 'popup' }));
      } else {
        res.redirect(
          `${verifiedState.origin}/login?pendingLinkToken=${encodeURIComponent(resolution.pendingLinkToken)}&oauthAction=link_required&provider=google&emailHint=${encodeURIComponent(resolution.emailHint)}`,
        );
      }
      return;
    }

    setAuthCookie(req, res, resolution.token, resolution.sessionTimeoutHours);
    const eventType = resolution.status === 'linked' ? 'OAUTH_LINK_SUCCESS' : 'OAUTH_AUTH_SUCCESS';
    if (verifiedState.mode === 'popup') {
      res.send(
        buildOAuthCallbackHtml(
          {
            type: eventType,
            provider: 'google',
            user: resolution.user,
            token: resolution.token,
            returnTo: verifiedState.returnTo,
          },
          { targetOrigin: verifiedState.origin, mode: 'popup' },
        ),
      );
    } else {
      const target = sanitizeAuthRedirectPath(verifiedState.returnTo, '/');
      res.redirect(`${verifiedState.origin}${target}${target.includes('?') ? '&' : '?'}oauth=success`);
    }
  } catch (err) {
    if (verifiedState) {
      const errMsg = err instanceof Error ? err.message : 'Google authentication failed.';
      if (verifiedState.mode === 'popup') {
        res.status(err instanceof AppError ? err.statusCode : 400).send(
          buildOAuthCallbackHtml(
            { type: 'OAUTH_AUTH_ERROR', provider: 'google', error: errMsg },
            { targetOrigin: verifiedState.origin, mode: 'popup' },
          ),
        );
        return;
      }
      res.redirect(`${verifiedState.origin}/login?authError=${encodeURIComponent(errMsg)}`);
      return;
    }
    next(err);
  }
}

export function facebookOAuthUrlController(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  try {
    if (!integrations.facebookOAuth) {
      res.status(503).json({
        ok: false,
        code: 'OAUTH_UNCONFIGURED',
        error: 'Facebook OAuth is not configured (FACEBOOK_APP_ID / FACEBOOK_APP_SECRET missing).',
      });
      return;
    }
    const { url, callbackOrigin } = initProviderAuthorization(req, res, 'facebook', 'popup');
    res.json({ ok: true, url, callbackOrigin });
  } catch (err) {
    next(err);
  }
}

export function facebookOAuthRedirectController(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  try {
    if (!integrations.facebookOAuth) {
      res.status(503).json({
        ok: false,
        code: 'OAUTH_UNCONFIGURED',
        error: 'Facebook OAuth is not configured (FACEBOOK_APP_ID / FACEBOOK_APP_SECRET missing).',
      });
      return;
    }
    const mode: OAuthMode = req.query.mode === 'popup' ? 'popup' : 'redirect';
    const { url } = initProviderAuthorization(req, res, 'facebook', mode);
    res.redirect(url);
  } catch (err) {
    next(err);
  }
}

export async function facebookOAuthCallbackController(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  let verifiedState: ReturnType<typeof consumeAndVerifyOAuthStateToken> | null = null;
  try {
    if (!integrations.facebookOAuth) {
      throw new AppError(503, 'OAUTH_UNCONFIGURED', 'Facebook OAuth is not configured.');
    }

    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');

    const stateParam = String(req.query.state || '');
    const cookieNonce = req.cookies?.[OAUTH_STATE_COOKIE] as string | undefined;
    res.clearCookie(OAUTH_STATE_COOKIE, getAuthCookieOptions(req));

    const fallbackOrigin = resolveCanonicalOrigin(req);

    try {
      verifiedState = consumeAndVerifyOAuthStateToken({
        stateToken: stateParam,
        expectedProvider: 'facebook',
        cookieNonce,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid or expired Facebook OAuth security state.';
      res.status(400).send(
        buildOAuthCallbackHtml(
          { type: 'OAUTH_AUTH_ERROR', provider: 'facebook', error: msg },
          { targetOrigin: fallbackOrigin, mode: 'popup' },
        ),
      );
      return;
    }

    const providerError = typeof req.query.error === 'string' ? req.query.error : '';
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (providerError || !code) {
      const errMsg = providerError === 'access_denied' ? 'Facebook sign-in was cancelled.' : 'Facebook authorization failed.';
      if (verifiedState.mode === 'popup') {
        res.send(
          buildOAuthCallbackHtml(
            { type: 'OAUTH_AUTH_ERROR', provider: 'facebook', error: errMsg },
            { targetOrigin: verifiedState.origin, mode: 'popup' },
          ),
        );
      } else {
        res.redirect(`${verifiedState.origin}/login?authError=${encodeURIComponent(errMsg)}`);
      }
      return;
    }

    const redirectUri = resolveOAuthCallbackUrl('facebook', req);
    let profile;
    try {
      profile = await exchangeAndVerifyFacebookCode({
        code,
        redirectUri,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Facebook token verification failed.';
      if (verifiedState.mode === 'popup') {
        res.send(
          buildOAuthCallbackHtml(
            { type: 'OAUTH_AUTH_ERROR', provider: 'facebook', error: errMsg },
            { targetOrigin: verifiedState.origin, mode: 'popup' },
          ),
        );
      } else {
        res.redirect(`${verifiedState.origin}/login?authError=${encodeURIComponent(errMsg)}`);
      }
      return;
    }

    // Handle missing Facebook email cleanly without ever fabricating fake emails
    if (profile.emailMissing || !profile.email) {
      // First check if this Facebook user already completed registration previously
      const existingFb = await UserModel.findOne({ 'oauthProviders.facebookId': profile.providerUserId }).select('+passwordHash');
      if (existingFb) {
        const resolution = await resolveOrChallengeOAuthUser({
          provider: 'facebook',
          providerId: profile.providerUserId,
          email: existingFb.email,
          name: profile.name,
          givenName: profile.givenName,
          familyName: profile.familyName,
          picture: profile.picture,
          emailVerified: true,
          intent: verifiedState.intent,
          authenticatedUserId: verifiedState.linkUserId || (req.user ? String(req.user._id) : undefined),
          returnTo: verifiedState.returnTo,
          userAgent: req.get('user-agent'),
          ipAddress: getClientIp(req),
        });
        if (resolution.status !== 'link_required') {
          setAuthCookie(req, res, resolution.token, resolution.sessionTimeoutHours);
          const eventType = resolution.status === 'linked' ? 'OAUTH_LINK_SUCCESS' : 'OAUTH_AUTH_SUCCESS';
          if (verifiedState.mode === 'popup') {
            res.send(
              buildOAuthCallbackHtml(
                {
                  type: eventType,
                  provider: 'facebook',
                  user: resolution.user,
                  token: resolution.token,
                  returnTo: verifiedState.returnTo,
                },
                { targetOrigin: verifiedState.origin, mode: 'popup' },
              ),
            );
          } else {
            const target = sanitizeAuthRedirectPath(verifiedState.returnTo, '/');
            res.redirect(`${verifiedState.origin}${target}${target.includes('?') ? '&' : '?'}oauth=success`);
          }
          return;
        }
      }

      const challengeToken = signPendingSocialEmailToken({
        provider: 'facebook',
        providerUserId: profile.providerUserId,
        name: profile.name,
        givenName: profile.givenName,
        familyName: profile.familyName,
        picture: profile.picture,
        returnTo: verifiedState.returnTo,
      });

      if (verifiedState.mode === 'popup') {
        res.send(
          buildOAuthCallbackHtml(
            {
              type: 'OAUTH_EMAIL_REQUIRED',
              provider: 'facebook',
              challengeToken,
              name: profile.name,
              picture: profile.picture,
              returnTo: verifiedState.returnTo,
            },
            { targetOrigin: verifiedState.origin, mode: 'popup' },
          ),
        );
      } else {
        res.redirect(
          `${verifiedState.origin}/login?oauthChallenge=${encodeURIComponent(challengeToken)}&oauthAction=email_required`,
        );
      }
      return;
    }

    const resolution = await resolveOrChallengeOAuthUser({
      provider: 'facebook',
      providerId: profile.providerUserId,
      email: profile.email,
      name: profile.name,
      givenName: profile.givenName,
      familyName: profile.familyName,
      picture: profile.picture,
      emailVerified: profile.emailVerified,
      intent: verifiedState.intent,
      authenticatedUserId: verifiedState.linkUserId || (req.user ? String(req.user._id) : undefined),
      returnTo: verifiedState.returnTo,
      userAgent: req.get('user-agent'),
      ipAddress: getClientIp(req),
    });

    if (resolution.status === 'link_required') {
      const payload = {
        type: 'OAUTH_LINK_REQUIRED' as const,
        provider: 'facebook' as const,
        pendingLinkToken: resolution.pendingLinkToken,
        emailHint: resolution.emailHint,
        existingHasPassword: resolution.existingHasPassword,
        existingInitialProvider: resolution.existingInitialProvider,
        returnTo: verifiedState.returnTo,
      };
      if (verifiedState.mode === 'popup') {
        res.send(buildOAuthCallbackHtml(payload, { targetOrigin: verifiedState.origin, mode: 'popup' }));
      } else {
        res.redirect(
          `${verifiedState.origin}/login?pendingLinkToken=${encodeURIComponent(resolution.pendingLinkToken)}&oauthAction=link_required&provider=facebook&emailHint=${encodeURIComponent(resolution.emailHint)}`,
        );
      }
      return;
    }

    setAuthCookie(req, res, resolution.token, resolution.sessionTimeoutHours);
    const eventType = resolution.status === 'linked' ? 'OAUTH_LINK_SUCCESS' : 'OAUTH_AUTH_SUCCESS';
    if (verifiedState.mode === 'popup') {
      res.send(
        buildOAuthCallbackHtml(
          {
            type: eventType,
            provider: 'facebook',
            user: resolution.user,
            token: resolution.token,
            returnTo: verifiedState.returnTo,
          },
          { targetOrigin: verifiedState.origin, mode: 'popup' },
        ),
      );
    } else {
      const target = sanitizeAuthRedirectPath(verifiedState.returnTo, '/');
      res.redirect(`${verifiedState.origin}${target}${target.includes('?') ? '&' : '?'}oauth=success`);
    }
  } catch (err) {
    if (verifiedState) {
      const errMsg = err instanceof Error ? err.message : 'Facebook authentication failed.';
      if (verifiedState.mode === 'popup') {
        res.status(err instanceof AppError ? err.statusCode : 400).send(
          buildOAuthCallbackHtml(
            { type: 'OAUTH_AUTH_ERROR', provider: 'facebook', error: errMsg },
            { targetOrigin: verifiedState.origin, mode: 'popup' },
          ),
        );
        return;
      }
      res.redirect(`${verifiedState.origin}/login?authError=${encodeURIComponent(errMsg)}`);
      return;
    }
    next(err);
  }
}
