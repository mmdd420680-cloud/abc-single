import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { UserModel, type IUser } from '../users/user.model';
import { HomepageConfigModel } from '../cms/cms.model';
import { isDatabaseReady } from '../../database/connection';
import { AppError } from '../../middleware/error.middleware';
import { recordAuditLog, signAuthToken } from '../../middleware/auth.middleware';
import { env, integrations } from '../../config/env';
import { sendTransactionalEmail } from '../../services/email.service';
import { isStaffRole } from '../../../../src/lib/rbac';
import { normalizeEmail, normalizeFullName } from '../../../../src/lib/authValidation';
import { sanitizeAvatarUrl } from '../../../../src/lib/avatar';
import {
  AuthSessionModel,
  UserAuthProviderModel,
  assertLoginAttemptAllowed,
  clearFailedLoginAttempts,
  recordFailedLoginAttempt,
  type IdentityProviderName,
} from './authIdentity.model';
import {
  signPendingLinkToken,
  verifyPendingLinkToken,
  verifyPendingSocialEmailToken,
} from './oauth.service';

export function resolveAuthProvider(user: {
  initialAuthProvider?: IdentityProviderName;
  authProvider?: IdentityProviderName;
  oauthProviders?: { googleId?: string; facebookId?: string };
}): IdentityProviderName {
  if (user.authProvider) return user.authProvider;
  if (user.initialAuthProvider) return user.initialAuthProvider;
  if (user.oauthProviders?.googleId) return 'google';
  if (user.oauthProviders?.facebookId) return 'facebook';
  return 'local';
}

export function resolveInitialAuthProvider(user: {
  initialAuthProvider?: IdentityProviderName;
  authProvider?: IdentityProviderName;
  oauthProviders?: { googleId?: string; facebookId?: string };
}): IdentityProviderName {
  if (user.initialAuthProvider) return user.initialAuthProvider;
  return resolveAuthProvider(user);
}

export function maskEmailForHint(email: string): string {
  const normalized = normalizeEmail(email);
  const [local, domain] = normalized.split('@');
  if (!local || !domain) return normalized;
  const visible = local.length <= 2 ? local[0] || '*' : `${local[0]}***${local[local.length - 1]}`;
  return `${visible}@${domain}`;
}

export function serializeUser(user: {
  _id: unknown;
  name: string;
  givenName?: string;
  familyName?: string;
  email: string;
  phone?: string;
  avatarUrl?: string;
  avatarSources?: { google?: string; facebook?: string; uploaded?: string };
  walletBalance?: number;
  role: string;
  customPermissions?: string[];
  passwordHash?: string;
  isVerified: boolean;
  status?: 'active' | 'suspended';
  authProvider?: IdentityProviderName;
  initialAuthProvider?: IdentityProviderName;
  oauthProviders?: { googleId?: string; facebookId?: string };
  notificationPrefs?: { orderUpdates: boolean; promotions: boolean; backInStock: boolean };
  createdAt?: Date | string;
}) {
  const initialProvider = resolveInitialAuthProvider(user);
  return {
    id: String(user._id),
    name: user.name,
    givenName: user.givenName || '',
    familyName: user.familyName || '',
    email: user.email,
    phone: user.phone || '',
    avatarUrl: user.avatarUrl || '',
    avatarSources: {
      google: user.avatarSources?.google || '',
      facebook: user.avatarSources?.facebook || '',
      uploaded: user.avatarSources?.uploaded || '',
    },
    walletBalance: Number(user.walletBalance || 0),
    role: user.role,
    customPermissions: user.customPermissions || [],
    isVerified: user.isVerified,
    status: user.status || 'active',
    authProvider: resolveAuthProvider(user),
    initialAuthProvider: initialProvider,
    linkedProviders: {
      local: initialProvider === 'local' || Boolean(user.passwordHash),
      google: Boolean(user.oauthProviders?.googleId),
      facebook: Boolean(user.oauthProviders?.facebookId),
    },
    notificationPrefs: user.notificationPrefs || {
      orderUpdates: true,
      promotions: false,
      backInStock: true,
    },
    createdAt: user.createdAt ? new Date(user.createdAt).toISOString() : undefined,
  };
}

export async function getActiveSecurityPolicy() {
  const defaults = {
    requireEmailVerification: false,
    sessionTimeoutHours: 168,
    maxLoginAttempts: 30,
  };
  if (!isDatabaseReady()) return defaults;
  try {
    const cfg = await HomepageConfigModel.findOne({ key: 'main' }).select('securitySettings').lean();
    const s = cfg?.securitySettings;
    if (!s) return defaults;
    return {
      requireEmailVerification: Boolean(s.requireEmailVerification),
      sessionTimeoutHours: Math.min(720, Math.max(1, Number(s.sessionTimeoutHours || 168))),
      maxLoginAttempts: Math.min(100, Math.max(3, Number(s.maxLoginAttempts || 30))),
    };
  } catch {
    return defaults;
  }
}

export async function createAuthenticatedSession(params: {
  user: IUser | { _id: unknown; role: IUser['role']; email: string };
  provider: IdentityProviderName;
  userAgent?: string;
  ipAddress?: string;
  sessionTimeoutHours?: number;
}) {
  const hours = Math.min(720, Math.max(1, Number(params.sessionTimeoutHours || 168)));
  const sessionId = crypto.randomBytes(18).toString('hex');
  const refreshToken = crypto.randomBytes(32).toString('hex');
  const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

  if (isDatabaseReady()) {
    try {
      await AuthSessionModel.create({
        sessionId,
        userId: params.user._id,
        provider: params.provider,
        refreshTokenHash,
        userAgent: String(params.userAgent || 'Web Browser').slice(0, 280),
        ipAddress: String(params.ipAddress || '').slice(0, 80),
        lastSeenAt: new Date(),
        expiresAt,
      });
    } catch {
      // Non-fatal if running with partial mock DB
    }
  }

  const token = signAuthToken(params.user, {
    sessionId,
    sessionTimeoutHours: hours,
  });

  return { token, refreshToken, sessionId, sessionTimeoutHours: hours };
}

async function upsertProviderRecord(params: {
  userId: unknown;
  provider: IdentityProviderName;
  providerUserId: string;
  providerEmail?: string | null;
  providerEmailVerified: boolean;
  profilePictureUrl?: string;
}) {
  if (!isDatabaseReady()) return;
  try {
    await UserAuthProviderModel.findOneAndUpdate(
      { userId: params.userId, provider: params.provider },
      {
        $set: {
          providerUserId: params.providerUserId,
          providerEmail: params.providerEmail ? normalizeEmail(params.providerEmail) : undefined,
          providerEmailVerified: params.providerEmailVerified,
          profilePictureUrl: params.profilePictureUrl || '',
          lastUsedAt: new Date(),
        },
      },
      { upsert: true, new: true },
    );
  } catch {
    // Index enforcement still protects integrity cleanly
  }
}

export async function registerCustomerAccount(
  input: {
    name: string;
    email: string;
    phone?: string;
    password: string;
  },
  meta?: { originUrl?: string; userAgent?: string; ipAddress?: string },
) {
  const email = normalizeEmail(input.email);
  const name = normalizeFullName(input.name);
  const parts = name.split(' ');
  const givenName = parts[0] || '';
  const familyName = parts.length > 1 ? parts.slice(1).join(' ') : '';

  const existing = await UserModel.findOne({ email });
  if (existing) {
    throw new AppError(
      409,
      'EMAIL_EXISTS',
      'An account may already be associated with this email. Please sign in or reset your password.',
      {
        unverified: !existing.isVerified,
        emailConfigured: integrations.resend,
      },
    );
  }

  const policy = await getActiveSecurityPolicy();
  const passwordHash = await bcrypt.hash(input.password, 12);
  const rawVerifyToken = crypto.randomBytes(24).toString('hex');
  const verificationTokenHash = crypto.createHash('sha256').update(rawVerifyToken).digest('hex');
  const requiresVerification = integrations.resend;
  const verificationTokenExpiresAt = requiresVerification ? new Date(Date.now() + 24 * 60 * 60 * 1000) : undefined;

  let user;
  try {
    user = await UserModel.create({
      name,
      givenName,
      familyName,
      email,
      normalizedEmail: email,
      phone: input.phone?.trim() || undefined,
      passwordHash,
      role: 'customer',
      status: 'active',
      authProvider: 'local',
      initialAuthProvider: 'local',
      isVerified: !requiresVerification,
      emailVerifiedAt: !requiresVerification ? new Date() : undefined,
      verificationTokenHash: requiresVerification ? verificationTokenHash : undefined,
      verificationTokenExpiresAt,
      lastLoginAt: requiresVerification ? undefined : new Date(),
      notificationPrefs: { orderUpdates: true, promotions: false, backInStock: true },
    });
  } catch (err) {
    if (typeof err === 'object' && err !== null && 'code' in err && (err as { code?: number }).code === 11000) {
      throw new AppError(
        409,
        'EMAIL_EXISTS',
        'An account may already be associated with this email. Please sign in or reset your password.',
      );
    }
    throw err;
  }

  await upsertProviderRecord({
    userId: user._id,
    provider: 'local',
    providerUserId: String(user._id),
    providerEmail: email,
    providerEmailVerified: !requiresVerification,
  });

  if (requiresVerification) {
    const baseUrl = (meta?.originUrl || env.CLIENT_URL).replace(/\/$/, '');
    const verifyUrl = `${baseUrl}/verify-email?token=${rawVerifyToken}&email=${encodeURIComponent(user.email)}`;
    await sendTransactionalEmail({
      to: user.email,
      template: 'account_verification',
      subject: 'Verify your NOVARA COMMERCE account',
      html: `<p>Welcome to NOVARA COMMERCE, ${user.name}.</p><p>Please verify your email address (valid for 24 hours): <a href="${verifyUrl}">Verify Account</a></p>`,
    });

    return {
      user: serializeUser(user),
      token: null as string | null,
      refreshToken: null as string | null,
      sessionTimeoutHours: policy.sessionTimeoutHours,
      requiresVerification: true,
    };
  }

  const session = await createAuthenticatedSession({
    user,
    provider: 'local',
    userAgent: meta?.userAgent,
    ipAddress: meta?.ipAddress,
    sessionTimeoutHours: policy.sessionTimeoutHours,
  });

  const plainUser = typeof (user as { toObject?: () => Record<string, unknown> }).toObject === 'function'
    ? (user as { toObject: () => Record<string, unknown> }).toObject()
    : (user as unknown as Record<string, unknown>);

  return {
    user: serializeUser({ ...plainUser, passwordHash: 'set' } as Parameters<typeof serializeUser>[0]),
    token: session.token,
    refreshToken: session.refreshToken,
    sessionTimeoutHours: session.sessionTimeoutHours,
    requiresVerification: false,
  };
}

export async function verifyCustomerEmail(
  input: { email: string; token: string },
  meta?: { userAgent?: string; ipAddress?: string },
) {
  const email = normalizeEmail(input.email);
  const tokenHash = crypto.createHash('sha256').update(input.token.trim()).digest('hex');

  const user = await UserModel.findOne({
    email,
    verificationTokenHash: tokenHash,
    $or: [
      { verificationTokenExpiresAt: { $gt: new Date() } },
      { verificationTokenExpiresAt: { $exists: false } },
      { verificationTokenExpiresAt: null },
    ],
  }).select('+verificationTokenHash +verificationTokenExpiresAt +passwordHash');

  if (!user) {
    throw new AppError(400, 'INVALID_VERIFICATION_TOKEN', 'Verification link is invalid or has expired.');
  }

  if (user.status !== 'active') {
    throw new AppError(403, 'ACCOUNT_SUSPENDED', 'This account has been suspended. Please contact support.');
  }

  user.isVerified = true;
  user.emailVerifiedAt = new Date();
  user.verificationTokenHash = undefined;
  user.verificationTokenExpiresAt = undefined;
  user.lastLoginAt = new Date();
  await user.save();

  const policy = await getActiveSecurityPolicy();
  const session = await createAuthenticatedSession({
    user,
    provider: resolveAuthProvider(user),
    userAgent: meta?.userAgent,
    ipAddress: meta?.ipAddress,
    sessionTimeoutHours: policy.sessionTimeoutHours,
  });

  return {
    user: serializeUser(user),
    token: session.token,
    refreshToken: session.refreshToken,
    sessionTimeoutHours: session.sessionTimeoutHours,
  };
}

export async function resendCustomerVerification(emailInput: string, originUrl?: string) {
  if (!integrations.resend) {
    throw new AppError(
      503,
      'EMAIL_PROVIDER_UNCONFIGURED',
      'Email verification delivery is unavailable because RESEND_API_KEY is not configured on the server.',
    );
  }

  const email = normalizeEmail(emailInput);
  const user = await UserModel.findOne({ email });

  if (user && !user.isVerified && user.status === 'active') {
    const rawVerifyToken = crypto.randomBytes(24).toString('hex');
    user.verificationTokenHash = crypto.createHash('sha256').update(rawVerifyToken).digest('hex');
    user.verificationTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await user.save();

    const baseUrl = (originUrl || env.CLIENT_URL).replace(/\/$/, '');
    const verifyUrl = `${baseUrl}/verify-email?token=${rawVerifyToken}&email=${encodeURIComponent(user.email)}`;
    await sendTransactionalEmail({
      to: user.email,
      template: 'account_verification',
      subject: 'Verify your NOVARA COMMERCE account',
      html: `<p>Hello ${user.name},</p><p>Verify your email address (valid for 24 hours): <a href="${verifyUrl}">Verify Account</a></p>`,
    });
  }

  return {
    message: 'If an unverified account matches that email, a fresh verification link has been sent.',
  };
}

export async function loginWithEmailPassword(input: {
  email: string;
  password: string;
  requireAdminStaff?: boolean;
  userAgent?: string;
  ipAddress?: string;
}) {
  const email = normalizeEmail(input.email);
  const policy = await getActiveSecurityPolicy();
  const attemptKey = `login:${email}:${input.ipAddress || 'unknown'}`;

  try {
    assertLoginAttemptAllowed(attemptKey, policy.maxLoginAttempts);
  } catch (err) {
    const minutes = err instanceof Error && err.message.startsWith('TOO_MANY_ATTEMPTS:') ? err.message.split(':')[1] : '15';
    throw new AppError(
      429,
      'LOGIN_RATE_LIMITED',
      `Too many failed sign-in attempts. Please wait ${minutes} minute(s) or reset your password.`,
    );
  }

  const user = await UserModel.findOne({ email }).select('+passwordHash');
  if (!user || !user.passwordHash) {
    recordFailedLoginAttempt(attemptKey, policy.maxLoginAttempts);
    if (user && !user.passwordHash) {
      throw new AppError(
        401,
        'SOCIAL_ONLY_ACCOUNT',
        'This account currently signs in using a connected social provider or requires a password reset.',
      );
    }
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }

  if (user.status !== 'active') {
    throw new AppError(403, 'ACCOUNT_SUSPENDED', 'Your account has been suspended. Please contact an administrator.');
  }

  const valid = await bcrypt.compare(input.password, user.passwordHash);
  if (!valid) {
    recordFailedLoginAttempt(attemptKey, policy.maxLoginAttempts);
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }

  clearFailedLoginAttempts(attemptKey);

  if (integrations.resend && !user.isVerified && user.role === 'customer') {
    throw new AppError(
      403,
      'EMAIL_NOT_VERIFIED',
      'Please verify your email address before signing in. You can request a new verification email.',
    );
  }

  if (input.requireAdminStaff && !isStaffRole(user.role)) {
    throw new AppError(403, 'ADMIN_ACCESS_REQUIRED', 'This account does not have administrator permissions.');
  }

  user.lastLoginAt = new Date();
  await user.save();

  if (isStaffRole(user.role)) {
    await recordAuditLog({
      actor: user,
      action: input.requireAdminStaff ? 'auth.admin_login' : 'auth.login',
      resourceType: 'User',
      resourceId: String(user._id),
      summary: `Staff sign-in (${user.email}) [${user.role}]`,
    });
  }

  const session = await createAuthenticatedSession({
    user,
    provider: 'local',
    userAgent: input.userAgent,
    ipAddress: input.ipAddress,
    sessionTimeoutHours: policy.sessionTimeoutHours,
  });

  return {
    user: serializeUser(user),
    token: session.token,
    refreshToken: session.refreshToken,
    sessionTimeoutHours: session.sessionTimeoutHours,
  };
}

export type OAuthResolutionResult =
  | {
      status: 'authenticated' | 'linked';
      user: ReturnType<typeof serializeUser>;
      token: string;
      refreshToken: string;
      sessionTimeoutHours: number;
    }
  | {
      status: 'link_required';
      pendingLinkToken: string;
      provider: 'google' | 'facebook';
      emailHint: string;
      existingHasPassword: boolean;
      existingInitialProvider: IdentityProviderName;
    };

function applyVerifiedProviderFields(
  user: IUser,
  params: {
    provider: 'google' | 'facebook';
    providerId: string;
    name: string;
    givenName?: string;
    familyName?: string;
    picture?: string;
  },
) {
  const safePicture = sanitizeAvatarUrl(params.picture) || '';
  if (params.provider === 'google') {
    user.oauthProviders = { ...user.oauthProviders, googleId: params.providerId };
    if (safePicture) {
      user.avatarSources = { ...user.avatarSources, google: safePicture };
    }
  } else {
    user.oauthProviders = { ...user.oauthProviders, facebookId: params.providerId };
    if (safePicture) {
      user.avatarSources = { ...user.avatarSources, facebook: safePicture };
    }
  }

  if (!user.avatarUrl && safePicture) {
    user.avatarUrl = safePicture;
  }
  if (!user.givenName && params.givenName) {
    user.givenName = params.givenName;
  }
  if (!user.familyName && params.familyName) {
    user.familyName = params.familyName;
  }
  if (!user.name && params.name) {
    user.name = params.name;
  }
  if (!user.isVerified) {
    user.isVerified = true;
    user.emailVerifiedAt = new Date();
  }
  user.lastLoginAt = new Date();
}

export async function resolveOrChallengeOAuthUser(params: {
  provider: 'google' | 'facebook';
  providerId: string;
  email: string;
  name: string;
  givenName?: string;
  familyName?: string;
  picture?: string;
  emailVerified: boolean;
  intent?: 'login' | 'link';
  authenticatedUserId?: string;
  returnTo?: string;
  userAgent?: string;
  ipAddress?: string;
}): Promise<OAuthResolutionResult> {
  if (!params.emailVerified) {
    throw new AppError(
      403,
      'OAUTH_EMAIL_UNVERIFIED',
      `Your ${params.provider} account email must be verified before signing in.`,
    );
  }

  const normalizedEmail = normalizeEmail(params.email);
  const cleanedName = normalizeFullName(params.name) || normalizedEmail.split('@')[0];
  const safePicture = sanitizeAvatarUrl(params.picture) || '';
  const policy = await getActiveSecurityPolicy();

  const providerQuery =
    params.provider === 'google'
      ? { 'oauthProviders.googleId': params.providerId }
      : { 'oauthProviders.facebookId': params.providerId };

  // 1. Check whether this external provider identity already belongs to an existing user
  let existingByProvider = await UserModel.findOne(providerQuery).select('+passwordHash');
  if (!existingByProvider && isDatabaseReady()) {
    const providerLink = await UserAuthProviderModel.findOne({
      provider: params.provider,
      providerUserId: params.providerId,
    }).lean();
    if (providerLink?.userId) {
      existingByProvider = await UserModel.findById(providerLink.userId).select('+passwordHash');
    }
  }

  // Handle explicit authenticated Account Linking initiated from /account/security
  if (params.intent === 'link') {
    if (!params.authenticatedUserId) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in before linking another authentication provider.');
    }
    if (existingByProvider && String(existingByProvider._id) !== String(params.authenticatedUserId)) {
      throw new AppError(
        409,
        'PROVIDER_ALREADY_LINKED',
        `This ${params.provider} account is already linked to a different user.`,
      );
    }
    const targetUser = await UserModel.findById(params.authenticatedUserId).select('+passwordHash');
    if (!targetUser || targetUser.status !== 'active') {
      throw new AppError(403, 'ACCOUNT_UNAVAILABLE', 'Target account is unavailable for linking.');
    }
    applyVerifiedProviderFields(targetUser, {
      provider: params.provider,
      providerId: params.providerId,
      name: cleanedName,
      givenName: params.givenName,
      familyName: params.familyName,
      picture: safePicture,
    });
    await targetUser.save();
    await upsertProviderRecord({
      userId: targetUser._id,
      provider: params.provider,
      providerUserId: params.providerId,
      providerEmail: normalizedEmail,
      providerEmailVerified: true,
      profilePictureUrl: safePicture,
    });

    const session = await createAuthenticatedSession({
      user: targetUser,
      provider: params.provider,
      userAgent: params.userAgent,
      ipAddress: params.ipAddress,
      sessionTimeoutHours: policy.sessionTimeoutHours,
    });

    return {
      status: 'linked',
      user: serializeUser(targetUser),
      token: session.token,
      refreshToken: session.refreshToken,
      sessionTimeoutHours: session.sessionTimeoutHours,
    };
  }

  // 2. If exact (provider, providerUserId) already exists, authenticate directly!
  if (existingByProvider) {
    if (existingByProvider.status !== 'active') {
      throw new AppError(403, 'ACCOUNT_SUSPENDED', 'Your account has been suspended. Please contact an administrator.');
    }
    applyVerifiedProviderFields(existingByProvider, {
      provider: params.provider,
      providerId: params.providerId,
      name: cleanedName,
      givenName: params.givenName,
      familyName: params.familyName,
      picture: safePicture,
    });
    await existingByProvider.save();
    await upsertProviderRecord({
      userId: existingByProvider._id,
      provider: params.provider,
      providerUserId: params.providerId,
      providerEmail: normalizedEmail,
      providerEmailVerified: true,
      profilePictureUrl: safePicture,
    });

    const session = await createAuthenticatedSession({
      user: existingByProvider,
      provider: params.provider,
      userAgent: params.userAgent,
      ipAddress: params.ipAddress,
      sessionTimeoutHours: policy.sessionTimeoutHours,
    });

    return {
      status: 'authenticated',
      user: serializeUser(existingByProvider),
      token: session.token,
      refreshToken: session.refreshToken,
      sessionTimeoutHours: session.sessionTimeoutHours,
    };
  }

  // 3. Check if an account already exists with this normalized email.
  // SECURITY RULE: NEVER silently auto-link unauthenticated OAuth login to an existing account!
  const existingByEmail = await UserModel.findOne({ email: normalizedEmail }).select('+passwordHash');
  if (existingByEmail) {
    if (existingByEmail.status !== 'active') {
      throw new AppError(403, 'ACCOUNT_SUSPENDED', 'Your account has been suspended. Please contact an administrator.');
    }

    const pendingLinkToken = signPendingLinkToken({
      userId: String(existingByEmail._id),
      provider: params.provider,
      providerUserId: params.providerId,
      email: normalizedEmail,
      name: cleanedName,
      givenName: params.givenName || '',
      familyName: params.familyName || '',
      picture: safePicture,
      emailVerified: true,
      returnTo: params.returnTo || '/',
    });

    return {
      status: 'link_required',
      pendingLinkToken,
      provider: params.provider,
      emailHint: maskEmailForHint(normalizedEmail),
      existingHasPassword: Boolean(existingByEmail.passwordHash),
      existingInitialProvider: resolveInitialAuthProvider(existingByEmail),
    };
  }

  // 4. Create brand-new user with immutable initialAuthProvider
  let newUser: IUser | null = null;
  try {
    newUser = await UserModel.create({
      name: cleanedName,
      givenName: params.givenName || '',
      familyName: params.familyName || '',
      email: normalizedEmail,
      normalizedEmail,
      avatarUrl: safePicture,
      avatarSources:
        params.provider === 'google'
          ? { google: safePicture, facebook: '', uploaded: '' }
          : { google: '', facebook: safePicture, uploaded: '' },
      role: 'customer',
      status: 'active',
      isVerified: true,
      emailVerifiedAt: new Date(),
      authProvider: params.provider,
      initialAuthProvider: params.provider,
      oauthProviders:
        params.provider === 'google'
          ? { googleId: params.providerId }
          : { facebookId: params.providerId },
      lastLoginAt: new Date(),
      notificationPrefs: { orderUpdates: true, promotions: false, backInStock: true },
    });
  } catch (err) {
    if (typeof err === 'object' && err !== null && 'code' in err && (err as { code?: number }).code === 11000) {
      const racedByProvider = await UserModel.findOne(providerQuery).select('+passwordHash');
      if (racedByProvider) {
        const session = await createAuthenticatedSession({
          user: racedByProvider,
          provider: params.provider,
          userAgent: params.userAgent,
          ipAddress: params.ipAddress,
          sessionTimeoutHours: policy.sessionTimeoutHours,
        });
        return {
          status: 'authenticated',
          user: serializeUser(racedByProvider),
          token: session.token,
          refreshToken: session.refreshToken,
          sessionTimeoutHours: session.sessionTimeoutHours,
        };
      }
      const racedByEmail = await UserModel.findOne({ email: normalizedEmail }).select('+passwordHash');
      if (racedByEmail) {
        const pendingLinkToken = signPendingLinkToken({
          userId: String(racedByEmail._id),
          provider: params.provider,
          providerUserId: params.providerId,
          email: normalizedEmail,
          name: cleanedName,
          givenName: params.givenName || '',
          familyName: params.familyName || '',
          picture: safePicture,
          emailVerified: true,
          returnTo: params.returnTo || '/',
        });
        return {
          status: 'link_required',
          pendingLinkToken,
          provider: params.provider,
          emailHint: maskEmailForHint(normalizedEmail),
          existingHasPassword: Boolean(racedByEmail.passwordHash),
          existingInitialProvider: resolveInitialAuthProvider(racedByEmail),
        };
      }
    }
    throw err;
  }

  if (!newUser) {
    throw new AppError(500, 'OAUTH_ACCOUNT_ERROR', 'Unable to create OAuth user account.');
  }

  await upsertProviderRecord({
    userId: newUser._id,
    provider: params.provider,
    providerUserId: params.providerId,
    providerEmail: normalizedEmail,
    providerEmailVerified: true,
    profilePictureUrl: safePicture,
  });

  const session = await createAuthenticatedSession({
    user: newUser,
    provider: params.provider,
    userAgent: params.userAgent,
    ipAddress: params.ipAddress,
    sessionTimeoutHours: policy.sessionTimeoutHours,
  });

  return {
    status: 'authenticated',
    user: serializeUser(newUser),
    token: session.token,
    refreshToken: session.refreshToken,
    sessionTimeoutHours: session.sessionTimeoutHours,
  };
}

export async function confirmOAuthLinkAccount(params: {
  linkToken: string;
  password?: string;
  authenticatedUserId?: string;
  userAgent?: string;
  ipAddress?: string;
}) {
  const challenge = verifyPendingLinkToken(params.linkToken);
  const user = await UserModel.findById(challenge.userId).select('+passwordHash');
  if (!user) {
    throw new AppError(404, 'USER_NOT_FOUND', 'Target account could not be found.');
  }
  if (user.status !== 'active') {
    throw new AppError(403, 'ACCOUNT_SUSPENDED', 'Your account has been suspended.');
  }

  const verifiedBySession =
    Boolean(params.authenticatedUserId) && String(params.authenticatedUserId) === String(user._id);

  let verifiedByPassword = false;
  if (!verifiedBySession) {
    if (!user.passwordHash) {
      const existingOrigin = resolveInitialAuthProvider(user);
      throw new AppError(
        403,
        'CONFIRM_WITH_EXISTING_PROVIDER',
        `This email is already registered with ${existingOrigin}. Please sign in with ${existingOrigin} first and link ${challenge.provider} from Account Security.`,
      );
    }
    if (!params.password) {
      throw new AppError(400, 'PASSWORD_REQUIRED', 'Please enter your current password to confirm linking.');
    }
    verifiedByPassword = await bcrypt.compare(params.password, user.passwordHash);
    if (!verifiedByPassword) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect password. Account linking was not completed.');
    }
  }

  const providerQuery =
    challenge.provider === 'google'
      ? { 'oauthProviders.googleId': challenge.providerUserId }
      : { 'oauthProviders.facebookId': challenge.providerUserId };
  const owner = await UserModel.findOne(providerQuery).select('_id');
  if (owner && String(owner._id) !== String(user._id)) {
    throw new AppError(409, 'PROVIDER_ALREADY_LINKED', `This ${challenge.provider} account is already linked to another user.`);
  }

  applyVerifiedProviderFields(user, {
    provider: challenge.provider,
    providerId: challenge.providerUserId,
    name: challenge.name,
    givenName: challenge.givenName,
    familyName: challenge.familyName,
    picture: challenge.picture,
  });
  await user.save();

  await upsertProviderRecord({
    userId: user._id,
    provider: challenge.provider,
    providerUserId: challenge.providerUserId,
    providerEmail: challenge.email,
    providerEmailVerified: challenge.emailVerified,
    profilePictureUrl: challenge.picture,
  });

  const policy = await getActiveSecurityPolicy();
  const session = await createAuthenticatedSession({
    user,
    provider: challenge.provider,
    userAgent: params.userAgent,
    ipAddress: params.ipAddress,
    sessionTimeoutHours: policy.sessionTimeoutHours,
  });

  return {
    user: serializeUser(user),
    token: session.token,
    refreshToken: session.refreshToken,
    sessionTimeoutHours: session.sessionTimeoutHours,
    returnTo: challenge.returnTo || '/',
  };
}

export async function completeFacebookMissingEmail(params: {
  challengeToken: string;
  email: string;
  name?: string;
  originUrl?: string;
  userAgent?: string;
  ipAddress?: string;
}) {
  const challenge = verifyPendingSocialEmailToken(params.challengeToken);
  const normalizedEmail = normalizeEmail(params.email);

  const existingByProvider = await UserModel.findOne({ 'oauthProviders.facebookId': challenge.providerUserId }).select('+passwordHash');
  if (existingByProvider) {
    const policy = await getActiveSecurityPolicy();
    const session = await createAuthenticatedSession({
      user: existingByProvider,
      provider: 'facebook',
      userAgent: params.userAgent,
      ipAddress: params.ipAddress,
      sessionTimeoutHours: policy.sessionTimeoutHours,
    });
    return {
      status: 'authenticated' as const,
      user: serializeUser(existingByProvider),
      token: session.token,
      refreshToken: session.refreshToken,
      sessionTimeoutHours: session.sessionTimeoutHours,
      returnTo: challenge.returnTo,
    };
  }

  const existingByEmail = await UserModel.findOne({ email: normalizedEmail }).select('+passwordHash');
  if (existingByEmail) {
    const pendingLinkToken = signPendingLinkToken({
      userId: String(existingByEmail._id),
      provider: 'facebook',
      providerUserId: challenge.providerUserId,
      email: normalizedEmail,
      name: params.name || challenge.name,
      givenName: challenge.givenName,
      familyName: challenge.familyName,
      picture: challenge.picture,
      emailVerified: false,
      returnTo: challenge.returnTo,
    });
    return {
      status: 'link_required' as const,
      pendingLinkToken,
      provider: 'facebook' as const,
      emailHint: maskEmailForHint(normalizedEmail),
      existingHasPassword: Boolean(existingByEmail.passwordHash),
      existingInitialProvider: resolveInitialAuthProvider(existingByEmail),
    };
  }

  const fullName = normalizeFullName(params.name || challenge.name) || normalizedEmail.split('@')[0];
  const requiresVerification = integrations.resend;
  const rawVerifyToken = crypto.randomBytes(24).toString('hex');
  const verificationTokenHash = crypto.createHash('sha256').update(rawVerifyToken).digest('hex');

  const created = await UserModel.create({
    name: fullName,
    givenName: challenge.givenName || '',
    familyName: challenge.familyName || '',
    email: normalizedEmail,
    normalizedEmail,
    avatarUrl: challenge.picture || '',
    avatarSources: { google: '', facebook: challenge.picture || '', uploaded: '' },
    role: 'customer',
    status: 'active',
    isVerified: !requiresVerification,
    emailVerifiedAt: !requiresVerification ? new Date() : undefined,
    verificationTokenHash: requiresVerification ? verificationTokenHash : undefined,
    verificationTokenExpiresAt: requiresVerification ? new Date(Date.now() + 24 * 60 * 60 * 1000) : undefined,
    authProvider: 'facebook',
    initialAuthProvider: 'facebook',
    oauthProviders: { facebookId: challenge.providerUserId },
    lastLoginAt: requiresVerification ? undefined : new Date(),
    notificationPrefs: { orderUpdates: true, promotions: false, backInStock: true },
  });

  await upsertProviderRecord({
    userId: created._id,
    provider: 'facebook',
    providerUserId: challenge.providerUserId,
    providerEmail: normalizedEmail,
    providerEmailVerified: !requiresVerification,
    profilePictureUrl: challenge.picture,
  });

  if (requiresVerification) {
    const baseUrl = (params.originUrl || env.CLIENT_URL).replace(/\/$/, '');
    const verifyUrl = `${baseUrl}/verify-email?token=${rawVerifyToken}&email=${encodeURIComponent(created.email)}`;
    await sendTransactionalEmail({
      to: created.email,
      template: 'account_verification',
      subject: 'Verify your NOVARA COMMERCE email address',
      html: `<p>Welcome ${created.name},</p><p>Please confirm your email address to complete your Facebook sign-in: <a href="${verifyUrl}">Verify Email</a></p>`,
    });
    return {
      status: 'verification_required' as const,
      user: serializeUser(created),
      message: 'Account created! Please verify your email address from your inbox to sign in.',
    };
  }

  const policy = await getActiveSecurityPolicy();
  const session = await createAuthenticatedSession({
    user: created,
    provider: 'facebook',
    userAgent: params.userAgent,
    ipAddress: params.ipAddress,
    sessionTimeoutHours: policy.sessionTimeoutHours,
  });

  return {
    status: 'authenticated' as const,
    user: serializeUser(created),
    token: session.token,
    refreshToken: session.refreshToken,
    sessionTimeoutHours: session.sessionTimeoutHours,
    returnTo: challenge.returnTo,
  };
}

export async function getLinkedProvidersForUser(userId: string) {
  const [user, records] = await Promise.all([
    UserModel.findById(userId).select('+passwordHash').lean(),
    isDatabaseReady() ? UserAuthProviderModel.find({ userId }).lean() : Promise.resolve([]),
  ]);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User account not found.');

  const hasPassword = Boolean(user.passwordHash);
  const googleLinked = Boolean(user.oauthProviders?.googleId);
  const facebookLinked = Boolean(user.oauthProviders?.facebookId);
  const methodCount = (hasPassword ? 1 : 0) + (googleLinked ? 1 : 0) + (facebookLinked ? 1 : 0);

  return {
    initialAuthProvider: resolveInitialAuthProvider(user),
    hasPassword,
    canUnlinkSocial: methodCount > 1,
    providers: [
      {
        provider: 'local' as const,
        linked: hasPassword,
        email: hasPassword ? user.email : undefined,
        canUnlink: false,
      },
      {
        provider: 'google' as const,
        linked: googleLinked,
        email: records.find((r) => r.provider === 'google')?.providerEmail || (googleLinked ? user.email : undefined),
        pictureUrl: user.avatarSources?.google || '',
        canUnlink: googleLinked && methodCount > 1,
        lastUsedAt: records.find((r) => r.provider === 'google')?.lastUsedAt || null,
      },
      {
        provider: 'facebook' as const,
        linked: facebookLinked,
        email: records.find((r) => r.provider === 'facebook')?.providerEmail || (facebookLinked ? user.email : undefined),
        pictureUrl: user.avatarSources?.facebook || '',
        canUnlink: facebookLinked && methodCount > 1,
        lastUsedAt: records.find((r) => r.provider === 'facebook')?.lastUsedAt || null,
      },
    ],
  };
}

export async function unlinkProviderForUser(userId: string, provider: 'google' | 'facebook') {
  const user = await UserModel.findById(userId).select('+passwordHash');
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User account not found.');

  const hasPassword = Boolean(user.passwordHash);
  const googleLinked = Boolean(user.oauthProviders?.googleId);
  const facebookLinked = Boolean(user.oauthProviders?.facebookId);

  if (provider === 'google' && !googleLinked) {
    throw new AppError(400, 'PROVIDER_NOT_LINKED', 'Google account is not currently linked.');
  }
  if (provider === 'facebook' && !facebookLinked) {
    throw new AppError(400, 'PROVIDER_NOT_LINKED', 'Facebook account is not currently linked.');
  }

  const remainingMethods =
    (hasPassword ? 1 : 0) +
    (provider === 'google' ? 0 : googleLinked ? 1 : 0) +
    (provider === 'facebook' ? 0 : facebookLinked ? 1 : 0);

  if (remainingMethods < 1) {
    throw new AppError(
      400,
      'CANNOT_UNLINK_LAST_METHOD',
      'Set a password or connect another login provider before unlinking your only sign-in method.',
    );
  }

  if (provider === 'google') {
    if (user.oauthProviders) {
      user.oauthProviders.googleId = undefined;
    }
    if (user.avatarSources) {
      user.avatarSources.google = '';
    }
    if (user.avatarUrl && user.avatarUrl === user.avatarSources?.google) {
      user.avatarUrl = user.avatarSources?.facebook || user.avatarSources?.uploaded || '';
    }
  } else {
    if (user.oauthProviders) {
      user.oauthProviders.facebookId = undefined;
    }
    if (user.avatarSources) {
      user.avatarSources.facebook = '';
    }
    if (user.avatarUrl && user.avatarUrl === user.avatarSources?.facebook) {
      user.avatarUrl = user.avatarSources?.google || user.avatarSources?.uploaded || '';
    }
  }

  await user.save();
  if (isDatabaseReady()) {
    await UserAuthProviderModel.deleteOne({ userId: user._id, provider }).catch(() => undefined);
  }

  return serializeUser(user);
}

export async function setPasswordForSocialUser(userId: string, newPassword: string) {
  const user = await UserModel.findById(userId).select('+passwordHash');
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User account not found.');
  if (user.passwordHash) {
    throw new AppError(400, 'PASSWORD_ALREADY_SET', 'Use change password to update your existing password.');
  }
  user.passwordHash = await bcrypt.hash(newPassword, 12);
  await user.save();

  await upsertProviderRecord({
    userId: user._id,
    provider: 'local',
    providerUserId: String(user._id),
    providerEmail: user.email,
    providerEmailVerified: user.isVerified,
  });

  return serializeUser(user);
}

export async function listUserSessions(userId: string, currentSessionId?: string) {
  if (!isDatabaseReady()) return [];
  const sessions = await AuthSessionModel.find({
    userId,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  })
    .sort({ lastSeenAt: -1, createdAt: -1 })
    .limit(20)
    .lean();

  return sessions.map((s) => ({
    sessionId: s.sessionId,
    provider: s.provider,
    userAgent: s.userAgent,
    ipAddress: s.ipAddress,
    lastSeenAt: s.lastSeenAt,
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
    isCurrent: Boolean(currentSessionId && s.sessionId === currentSessionId),
  }));
}

export async function revokeUserSession(userId: string, sessionId: string) {
  if (!isDatabaseReady()) return { revoked: false };
  const result = await AuthSessionModel.updateOne(
    { userId, sessionId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
  return { revoked: result.modifiedCount > 0 };
}

export async function revokeAllUserSessions(userId: string, exceptSessionId?: string) {
  if (!isDatabaseReady()) return { revokedCount: 0 };
  const filter: Record<string, unknown> = { userId, revokedAt: null };
  if (exceptSessionId) {
    filter.sessionId = { $ne: exceptSessionId };
  }
  const result = await AuthSessionModel.updateMany(filter, { $set: { revokedAt: new Date() } });
  return { revokedCount: result.modifiedCount };
}
