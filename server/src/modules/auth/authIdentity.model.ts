import mongoose, { Schema, type Document } from 'mongoose';

export type IdentityProviderName = 'local' | 'google' | 'facebook';

export interface IUserAuthProvider extends Document {
  userId: mongoose.Types.ObjectId;
  provider: IdentityProviderName;
  providerUserId: string;
  providerEmail?: string;
  providerEmailVerified: boolean;
  profilePictureUrl?: string;
  lastUsedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const UserAuthProviderSchema = new Schema<IUserAuthProvider>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    provider: { type: String, enum: ['local', 'google', 'facebook'], required: true },
    providerUserId: { type: String, required: true, trim: true, maxlength: 200 },
    providerEmail: { type: String, lowercase: true, trim: true, maxlength: 254 },
    providerEmailVerified: { type: Boolean, default: false },
    profilePictureUrl: { type: String, trim: true, maxlength: 1000, default: '' },
    lastUsedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true },
);

UserAuthProviderSchema.index({ provider: 1, providerUserId: 1 }, { unique: true });
UserAuthProviderSchema.index({ userId: 1, provider: 1 }, { unique: true });

export const UserAuthProviderModel =
  mongoose.models.UserAuthProvider ||
  mongoose.model<IUserAuthProvider>('UserAuthProvider', UserAuthProviderSchema);

export interface IAuthSession extends Document {
  sessionId: string;
  userId: mongoose.Types.ObjectId;
  provider: IdentityProviderName;
  refreshTokenHash?: string;
  userAgent: string;
  ipAddress: string;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const AuthSessionSchema = new Schema<IAuthSession>(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    provider: { type: String, enum: ['local', 'google', 'facebook'], default: 'local' },
    refreshTokenHash: { type: String, select: false },
    userAgent: { type: String, default: 'Unknown device', maxlength: 300 },
    ipAddress: { type: String, default: '', maxlength: 80 },
    lastSeenAt: { type: Date, default: () => new Date() },
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const AuthSessionModel =
  mongoose.models.AuthSession || mongoose.model<IAuthSession>('AuthSession', AuthSessionSchema);

interface AttemptRecord {
  count: number;
  lockedUntil: number;
  windowStart: number;
}

const loginAttemptBuckets = new Map<string, AttemptRecord>();
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const LOCK_DURATION_MS = 15 * 60 * 1000;

export function resetLoginAttemptsForTests(): void {
  loginAttemptBuckets.clear();
}

export function assertLoginAttemptAllowed(key: string, maxAttempts = 30, nowMs = Date.now()): void {
  const rec = loginAttemptBuckets.get(key);
  if (!rec) return;
  if (rec.lockedUntil > nowMs) {
    const minutes = Math.max(1, Math.ceil((rec.lockedUntil - nowMs) / 60000));
    throw new Error(`TOO_MANY_ATTEMPTS:${minutes}`);
  }
  if (nowMs - rec.windowStart > ATTEMPT_WINDOW_MS) {
    loginAttemptBuckets.delete(key);
  }
}

export function recordFailedLoginAttempt(key: string, maxAttempts = 30, nowMs = Date.now()): void {
  const limit = Math.max(3, Number(maxAttempts || 30));
  const cur = loginAttemptBuckets.get(key);
  if (!cur || nowMs - cur.windowStart > ATTEMPT_WINDOW_MS) {
    loginAttemptBuckets.set(key, { count: 1, lockedUntil: 0, windowStart: nowMs });
    return;
  }
  cur.count += 1;
  if (cur.count >= limit) {
    cur.lockedUntil = nowMs + LOCK_DURATION_MS;
  }
}

export function clearFailedLoginAttempts(key: string): void {
  loginAttemptBuckets.delete(key);
}
