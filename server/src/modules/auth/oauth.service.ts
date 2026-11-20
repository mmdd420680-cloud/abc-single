import crypto from 'node:crypto';
import type { Request } from 'express';
import { env, getJwtSecret } from '../../config/env';
import { AppError } from '../../middleware/error.middleware';
import { normalizeEmail, normalizeFullName, sanitizeAuthRedirectPath } from '../../../../src/lib/authValidation';
import { sanitizeAvatarUrl } from '../../../../src/lib/avatar';

export type OAuthProvider = 'google' | 'facebook';
export type OAuthMode = 'popup' | 'redirect';
export type OAuthIntent = 'login' | 'link';

export interface OAuthStatePayload {
  jti: string;
  nonce: string;
  provider: OAuthProvider;
  mode: OAuthMode;
  intent: OAuthIntent;
  linkUserId?: string;
  returnTo: string;
  codeVerifier: string;
  oidcNonce: string;
  origin: string;
  exp: number;
}

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
  method: 'S256';
}

export interface VerifiedGoogleProfile {
  provider: 'google';
  providerUserId: string;
  email: string;
  emailVerified: boolean;
  name: string;
  givenName: string;
  familyName: string;
  picture: string;
}

export interface VerifiedFacebookProfile {
  provider: 'facebook';
  providerUserId: string;
  email: string | null;
  emailVerified: boolean;
  emailMissing: boolean;
  name: string;
  givenName: string;
  familyName: string;
  picture: string;
}

export interface PendingSocialEmailPayload {
  jti: string;
  provider: 'facebook';
  providerUserId: string;
  name: string;
  givenName: string;
  familyName: string;
  picture: string;
  returnTo: string;
  exp: number;
}

export interface PendingLinkPayload {
  jti: string;
  userId: string;
  provider: OAuthProvider;
  providerUserId: string;
  email: string;
  name: string;
  givenName: string;
  familyName: string;
  picture: string;
  emailVerified: boolean;
  returnTo: string;
  exp: number;
}

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const DEFAULT_JWKS_TTL_MS = 60 * 60 * 1000;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const PENDING_CHALLENGE_TTL_MS = 15 * 60 * 1000;

interface CachedJwks {
  keys: Array<Record<string, unknown>>;
  expiresAt: number;
}

let cachedGoogleJwks: CachedJwks | null = null;
const consumedJtiStore = new Map<string, number>();

function pruneConsumedJtis(nowMs = Date.now()): void {
  if (consumedJtiStore.size < 200) return;
  for (const [key, exp] of consumedJtiStore.entries()) {
    if (exp <= nowMs) {
      consumedJtiStore.delete(key);
    }
  }
}

export function resetOAuthRuntimeCachesForTests(): void {
  cachedGoogleJwks = null;
  consumedJtiStore.clear();
}

export function deriveAesKey(secret = getJwtSecret()): Buffer {
  return crypto.createHash('sha256').update(`novara-oauth-aes:${secret}`).digest();
}

export function sealEncryptedPayload<T extends object>(payload: T, secret = getJwtSecret()): string {
  const key = deriveAesKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${authTag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function unsealEncryptedPayload<T>(token: string, secret = getJwtSecret()): T | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const [ivB64, tagB64, dataB64] = parts;
    const iv = Buffer.from(ivB64, 'base64url');
    const authTag = Buffer.from(tagB64, 'base64url');
    const ciphertext = Buffer.from(dataB64, 'base64url');
    if (iv.length !== 12 || authTag.length !== 16) return null;

    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveAesKey(secret), iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    return JSON.parse(decrypted) as T;
  } catch {
    return null;
  }
}

export function generatePkcePair(): PkcePair {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  return {
    codeVerifier,
    codeChallenge,
    method: 'S256',
  };
}

function isAllowedRuntimeOrigin(candidate: string): boolean {
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return true;
    }
    if (parsed.protocol !== 'https:') return false;
    const configuredOrigins = [env.APP_URL, env.CLIENT_URL]
      .filter(Boolean)
      .map((u) => {
        try {
          return new URL(u).origin;
        } catch {
          return '';
        }
      })
      .filter(Boolean);
    if (configuredOrigins.includes(parsed.origin)) return true;
    // Allow Cloud Run AI Studio dev/shared origins matching this deployment domain
    if (/^ais-(dev|pre)-[a-z0-9-]+\.[a-z0-9-]+\.run\.app$/i.test(hostname)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function resolveCanonicalOrigin(req?: Request): string {
  if (req) {
    const forwardedHost = req.get('x-forwarded-host')?.split(',')[0]?.trim();
    const host = forwardedHost || req.get('host')?.split(',')[0]?.trim();
    const proto = req.get('x-forwarded-proto')?.split(',')[0]?.trim() || req.protocol || 'https';
    if (host) {
      const candidate = `${proto}://${host}`.replace(/\/$/, '');
      if (isAllowedRuntimeOrigin(candidate)) {
        return candidate;
      }
    }
  }

  const configured = (env.APP_URL || env.CLIENT_URL || 'http://localhost:3000').replace(/\/$/, '');
  return configured;
}

export function resolveOAuthCallbackUrl(provider: OAuthProvider, req?: Request): string {
  const override = provider === 'google' ? process.env.GOOGLE_REDIRECT_URI : process.env.FACEBOOK_REDIRECT_URI;
  if (override && isAllowedRuntimeOrigin(override)) {
    return override.replace(/\/$/, '');
  }
  return `${resolveCanonicalOrigin(req)}/api/auth/oauth/${provider}/callback`;
}

export function createOAuthStateToken(params: {
  provider: OAuthProvider;
  mode: OAuthMode;
  intent?: OAuthIntent;
  linkUserId?: string;
  returnTo?: string | null;
  origin: string;
  codeVerifier: string;
  oidcNonce: string;
  cookieNonce: string;
  secret?: string;
  nowMs?: number;
}): string {
  const nowMs = params.nowMs ?? Date.now();
  const payload: OAuthStatePayload = {
    jti: crypto.randomBytes(16).toString('hex'),
    nonce: params.cookieNonce,
    provider: params.provider,
    mode: params.mode,
    intent: params.intent === 'link' ? 'link' : 'login',
    linkUserId: params.linkUserId,
    returnTo: sanitizeAuthRedirectPath(params.returnTo, params.intent === 'link' ? '/account/security' : '/'),
    codeVerifier: params.codeVerifier,
    oidcNonce: params.oidcNonce,
    origin: params.origin,
    exp: nowMs + OAUTH_STATE_TTL_MS,
  };
  return sealEncryptedPayload(payload, params.secret);
}

export function consumeAndVerifyOAuthStateToken(params: {
  stateToken: string;
  expectedProvider: OAuthProvider;
  cookieNonce?: string;
  secret?: string;
  nowMs?: number;
  replayStore?: Map<string, number>;
}): OAuthStatePayload {
  const nowMs = params.nowMs ?? Date.now();
  const store = params.replayStore ?? consumedJtiStore;
  pruneConsumedJtis(nowMs);

  const parsed = unsealEncryptedPayload<OAuthStatePayload>(params.stateToken, params.secret);
  if (!parsed || !parsed.jti || !parsed.nonce || !parsed.exp) {
    throw new AppError(400, 'INVALID_OAUTH_STATE', 'Invalid OAuth security state. Please retry sign-in.');
  }
  if (parsed.provider !== params.expectedProvider) {
    throw new AppError(400, 'OAUTH_PROVIDER_MISMATCH', 'OAuth callback provider mismatch.');
  }
  if (parsed.exp <= nowMs) {
    throw new AppError(400, 'OAUTH_STATE_EXPIRED', 'OAuth session expired. Please start sign-in again.');
  }
  if (!params.cookieNonce) {
    throw new AppError(400, 'OAUTH_COOKIE_MISSING', 'OAuth security cookie missing. Please enable cookies and retry.');
  }

  const a = Buffer.from(parsed.nonce);
  const b = Buffer.from(String(params.cookieNonce));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new AppError(400, 'OAUTH_STATE_MISMATCH', 'OAuth CSRF verification failed.');
  }

  const existingUsedExp = store.get(parsed.jti);
  if (existingUsedExp && existingUsedExp > nowMs) {
    throw new AppError(409, 'OAUTH_STATE_REPLAYED', 'This OAuth authorization callback has already been used.');
  }
  store.set(parsed.jti, parsed.exp);

  return parsed;
}

export function buildGoogleAuthorizationUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  oidcNonce: string;
}): string {
  const query = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    prompt: 'select_account',
    access_type: 'online',
    code_challenge: params.codeChallenge,
    code_challenge_method: 'S256',
    nonce: params.oidcNonce,
    state: params.state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${query.toString()}`;
}

export function buildFacebookAuthorizationUrl(params: {
  appId: string;
  redirectUri: string;
  state: string;
}): string {
  const query = new URLSearchParams({
    client_id: params.appId,
    redirect_uri: params.redirectUri,
    scope: 'email,public_profile',
    response_type: 'code',
    state: params.state,
  });
  return `https://www.facebook.com/v20.0/dialog/oauth?${query.toString()}`;
}

function parseMaxAgeSeconds(cacheControl: string | null): number {
  if (!cacheControl) return 3600;
  const match = cacheControl.match(/max-age=(\d+)/i);
  if (!match) return 3600;
  const val = Number(match[1]);
  return Number.isFinite(val) && val > 60 ? val : 3600;
}

async function fetchGoogleJwks(fetchFn: typeof fetch, forceRefresh = false, nowMs = Date.now()): Promise<Array<Record<string, unknown>>> {
  if (!forceRefresh && cachedGoogleJwks && cachedGoogleJwks.expiresAt > nowMs) {
    return cachedGoogleJwks.keys;
  }

  const resp = await fetchFn(GOOGLE_JWKS_URL);
  if (!resp.ok) {
    throw new AppError(502, 'GOOGLE_JWKS_ERROR', 'Unable to fetch Google OIDC public keys.');
  }
  const body = (await resp.json()) as { keys?: Array<Record<string, unknown>> };
  if (!Array.isArray(body.keys) || body.keys.length === 0) {
    throw new AppError(502, 'GOOGLE_JWKS_EMPTY', 'Google OIDC key set was empty.');
  }

  const maxAgeMs = parseMaxAgeSeconds(resp.headers.get('cache-control')) * 1000;
  cachedGoogleJwks = {
    keys: body.keys,
    expiresAt: nowMs + Math.min(maxAgeMs || DEFAULT_JWKS_TTL_MS, 24 * 60 * 60 * 1000),
  };
  return body.keys;
}

export async function verifyGoogleIdToken(params: {
  idToken: string;
  clientId: string;
  expectedNonce: string;
  fetchFn?: typeof fetch;
  nowMs?: number;
}): Promise<VerifiedGoogleProfile> {
  const nowMs = params.nowMs ?? Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  const fetchFn = params.fetchFn ?? fetch;

  const segments = String(params.idToken || '').split('.');
  if (segments.length !== 3) {
    throw new AppError(401, 'INVALID_GOOGLE_ID_TOKEN', 'Google ID token format is invalid.');
  }

  const [headerB64, payloadB64, sigB64] = segments;
  let header: { alg?: string; kid?: string };
  let claims: {
    iss?: string;
    aud?: string;
    sub?: string;
    email?: string;
    email_verified?: boolean | string;
    name?: string;
    given_name?: string;
    family_name?: string;
    picture?: string;
    nonce?: string;
    exp?: number;
    iat?: number;
  };

  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    throw new AppError(401, 'INVALID_GOOGLE_ID_TOKEN', 'Unable to decode Google ID token claims.');
  }

  if (header.alg !== 'RS256' || !header.kid) {
    throw new AppError(401, 'INVALID_GOOGLE_ID_TOKEN', 'Unsupported Google ID token algorithm or missing key ID.');
  }

  let keys = await fetchGoogleJwks(fetchFn, false, nowMs);
  let jwk = keys.find((k) => k.kid === header.kid && k.kty === 'RSA');
  if (!jwk) {
    keys = await fetchGoogleJwks(fetchFn, true, nowMs);
    jwk = keys.find((k) => k.kid === header.kid && k.kty === 'RSA');
  }
  if (!jwk) {
    throw new AppError(401, 'GOOGLE_KEY_NOT_FOUND', 'Unable to verify Google ID token signature key.');
  }

  const publicKey = crypto.createPublicKey({ key: jwk as crypto.JsonWebKey, format: 'jwk' });
  const verifiedSig = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${headerB64}.${payloadB64}`),
    publicKey,
    Buffer.from(sigB64, 'base64url'),
  );
  if (!verifiedSig) {
    throw new AppError(401, 'INVALID_GOOGLE_SIGNATURE', 'Google ID token signature verification failed.');
  }

  if (claims.iss !== 'https://accounts.google.com' && claims.iss !== 'accounts.google.com') {
    throw new AppError(401, 'INVALID_GOOGLE_ISSUER', 'Invalid Google ID token issuer.');
  }
  if (claims.aud !== params.clientId) {
    throw new AppError(401, 'INVALID_GOOGLE_AUDIENCE', 'Google ID token audience does not match application.');
  }
  if (typeof claims.exp !== 'number' || claims.exp <= nowSec - 30) {
    throw new AppError(401, 'GOOGLE_TOKEN_EXPIRED', 'Google ID token has expired.');
  }
  if (typeof claims.iat === 'number' && claims.iat > nowSec + 300) {
    throw new AppError(401, 'INVALID_GOOGLE_IAT', 'Google ID token issued-at timestamp is invalid.');
  }
  if (!claims.nonce) {
    throw new AppError(401, 'GOOGLE_NONCE_MISSING', 'Google ID token is missing OIDC nonce.');
  }
  const nA = Buffer.from(String(claims.nonce));
  const nB = Buffer.from(String(params.expectedNonce));
  if (nA.length !== nB.length || !crypto.timingSafeEqual(nA, nB)) {
    throw new AppError(401, 'GOOGLE_NONCE_MISMATCH', 'Google ID token nonce verification failed.');
  }

  if (!claims.sub || !claims.email) {
    throw new AppError(400, 'GOOGLE_PROFILE_MISSING', 'Google account profile did not include required email/subject.');
  }

  const emailVerified = claims.email_verified === true || claims.email_verified === 'true';
  if (!emailVerified) {
    throw new AppError(403, 'OAUTH_EMAIL_UNVERIFIED', 'Your Google account email address must be verified.');
  }

  const email = normalizeEmail(claims.email);
  const givenName = normalizeFullName(claims.given_name || '');
  const familyName = normalizeFullName(claims.family_name || '');
  const fullName = normalizeFullName(claims.name || `${givenName} ${familyName}`.trim()) || email.split('@')[0];

  return {
    provider: 'google',
    providerUserId: String(claims.sub),
    email,
    emailVerified: true,
    name: fullName,
    givenName,
    familyName,
    picture: sanitizeAvatarUrl(claims.picture) || '',
  };
}

export async function exchangeAndVerifyGoogleCode(params: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  expectedNonce: string;
  clientId?: string;
  clientSecret?: string;
  fetchFn?: typeof fetch;
  nowMs?: number;
}): Promise<VerifiedGoogleProfile> {
  const fetchFn = params.fetchFn ?? fetch;
  const clientId = params.clientId ?? env.GOOGLE_CLIENT_ID;
  const clientSecret = params.clientSecret ?? env.GOOGLE_CLIENT_SECRET;

  const tokenResp = await fetchFn('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: params.code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: params.redirectUri,
      code_verifier: params.codeVerifier,
      grant_type: 'authorization_code',
    }).toString(),
  });

  const tokenData = (await tokenResp.json()) as {
    access_token?: string;
    id_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!tokenResp.ok || !tokenData.id_token) {
    throw new AppError(
      401,
      'GOOGLE_TOKEN_EXCHANGE_FAILED',
      tokenData.error_description || 'Google authorization code exchange failed.',
    );
  }

  const verifiedProfile = await verifyGoogleIdToken({
    idToken: tokenData.id_token,
    clientId,
    expectedNonce: params.expectedNonce,
    fetchFn,
    nowMs: params.nowMs,
  });

  // Optionally enrich missing picture/names from Google userinfo if token was returned
  if ((!verifiedProfile.picture || !verifiedProfile.givenName) && tokenData.access_token) {
    try {
      const uiResp = await fetchFn('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (uiResp.ok) {
        const ui = (await uiResp.json()) as {
          sub?: string;
          name?: string;
          given_name?: string;
          family_name?: string;
          picture?: string;
        };
        if (ui.sub === verifiedProfile.providerUserId) {
          if (!verifiedProfile.picture) {
            verifiedProfile.picture = sanitizeAvatarUrl(ui.picture) || '';
          }
          if (!verifiedProfile.givenName && ui.given_name) {
            verifiedProfile.givenName = normalizeFullName(ui.given_name);
          }
          if (!verifiedProfile.familyName && ui.family_name) {
            verifiedProfile.familyName = normalizeFullName(ui.family_name);
          }
        }
      }
    } catch {
      // Non-fatal enrichment error; verified ID token claims remain authoritative
    }
  }

  return verifiedProfile;
}

export function computeFacebookAppSecretProof(accessToken: string, appSecret = env.FACEBOOK_APP_SECRET): string {
  return crypto.createHmac('sha256', appSecret).update(accessToken).digest('hex');
}

export async function exchangeAndVerifyFacebookCode(params: {
  code: string;
  redirectUri: string;
  appId?: string;
  appSecret?: string;
  fetchFn?: typeof fetch;
}): Promise<VerifiedFacebookProfile> {
  const fetchFn = params.fetchFn ?? fetch;
  const appId = params.appId ?? env.FACEBOOK_APP_ID;
  const appSecret = params.appSecret ?? env.FACEBOOK_APP_SECRET;

  const tokenUrl = new URL('https://graph.facebook.com/v20.0/oauth/access_token');
  tokenUrl.searchParams.set('client_id', appId);
  tokenUrl.searchParams.set('client_secret', appSecret);
  tokenUrl.searchParams.set('redirect_uri', params.redirectUri);
  tokenUrl.searchParams.set('code', params.code);

  const tokenResp = await fetchFn(tokenUrl.toString());
  const tokenData = (await tokenResp.json()) as {
    access_token?: string;
    error?: { message?: string };
  };
  if (!tokenResp.ok || !tokenData.access_token) {
    throw new AppError(
      401,
      'FACEBOOK_TOKEN_EXCHANGE_FAILED',
      tokenData.error?.message || 'Facebook authorization code exchange failed.',
    );
  }

  const accessToken = tokenData.access_token;
  const appSecretProof = computeFacebookAppSecretProof(accessToken, appSecret);

  const debugUrl = new URL('https://graph.facebook.com/debug_token');
  debugUrl.searchParams.set('input_token', accessToken);
  debugUrl.searchParams.set('access_token', `${appId}|${appSecret}`);

  const debugResp = await fetchFn(debugUrl.toString());
  const debugPayload = (await debugResp.json()) as {
    data?: { app_id?: string; user_id?: string; is_valid?: boolean };
  };

  if (
    !debugResp.ok ||
    !debugPayload.data?.is_valid ||
    String(debugPayload.data.app_id) !== String(appId) ||
    !debugPayload.data.user_id
  ) {
    throw new AppError(401, 'FACEBOOK_TOKEN_INVALID', 'Facebook access token failed security verification.');
  }

  const meUrl = new URL('https://graph.facebook.com/v20.0/me');
  meUrl.searchParams.set('fields', 'id,name,first_name,last_name,email,picture.type(large)');
  meUrl.searchParams.set('access_token', accessToken);
  meUrl.searchParams.set('appsecret_proof', appSecretProof);

  const meResp = await fetchFn(meUrl.toString());
  const profile = (await meResp.json()) as {
    id?: string;
    name?: string;
    first_name?: string;
    last_name?: string;
    email?: string;
    picture?: { data?: { url?: string; is_silhouette?: boolean } };
    error?: { message?: string };
  };

  if (!meResp.ok || !profile.id || String(profile.id) !== String(debugPayload.data.user_id)) {
    throw new AppError(
      401,
      'FACEBOOK_PROFILE_INVALID',
      profile.error?.message || 'Unable to verify Facebook account identity.',
    );
  }

  const rawEmail = profile.email ? normalizeEmail(profile.email) : null;
  const givenName = normalizeFullName(profile.first_name || '');
  const familyName = normalizeFullName(profile.last_name || '');
  const fullName =
    normalizeFullName(profile.name || `${givenName} ${familyName}`.trim()) || 'Facebook Customer';
  const rawPicture = profile.picture?.data?.is_silhouette ? '' : profile.picture?.data?.url || '';

  return {
    provider: 'facebook',
    providerUserId: String(profile.id),
    email: rawEmail,
    emailVerified: Boolean(rawEmail),
    emailMissing: !rawEmail,
    name: fullName,
    givenName,
    familyName,
    picture: sanitizeAvatarUrl(rawPicture) || '',
  };
}

export function signPendingSocialEmailToken(
  payload: Omit<PendingSocialEmailPayload, 'jti' | 'exp'>,
  secret = getJwtSecret(),
  nowMs = Date.now(),
): string {
  return sealEncryptedPayload<PendingSocialEmailPayload>(
    {
      ...payload,
      jti: crypto.randomBytes(12).toString('hex'),
      exp: nowMs + PENDING_CHALLENGE_TTL_MS,
    },
    secret,
  );
}

export function verifyPendingSocialEmailToken(
  token: string,
  secret = getJwtSecret(),
  nowMs = Date.now(),
): PendingSocialEmailPayload {
  const parsed = unsealEncryptedPayload<PendingSocialEmailPayload>(token, secret);
  if (!parsed || parsed.provider !== 'facebook' || !parsed.providerUserId || parsed.exp <= nowMs) {
    throw new AppError(400, 'INVALID_OAUTH_CHALLENGE', 'Your Facebook verification session has expired. Please try again.');
  }
  return parsed;
}

export function signPendingLinkToken(
  payload: Omit<PendingLinkPayload, 'jti' | 'exp'>,
  secret = getJwtSecret(),
  nowMs = Date.now(),
): string {
  return sealEncryptedPayload<PendingLinkPayload>(
    {
      ...payload,
      jti: crypto.randomBytes(12).toString('hex'),
      exp: nowMs + PENDING_CHALLENGE_TTL_MS,
    },
    secret,
  );
}

export function verifyPendingLinkToken(
  token: string,
  secret = getJwtSecret(),
  nowMs = Date.now(),
): PendingLinkPayload {
  const parsed = unsealEncryptedPayload<PendingLinkPayload>(token, secret);
  if (!parsed || !parsed.userId || !parsed.provider || !parsed.providerUserId || parsed.exp <= nowMs) {
    throw new AppError(400, 'INVALID_LINK_TOKEN', 'The account linking confirmation session has expired. Please try again.');
  }
  return parsed;
}
