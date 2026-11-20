import { z } from 'zod';
import {
  normalizeEmail,
  normalizeFullName,
  validateFullName,
  validatePasswordStrength,
} from '../../../../src/lib/authValidation';

const strongPasswordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters long.')
  .max(128, 'Password must not exceed 128 characters.')
  .superRefine((val, ctx) => {
    const err = validatePasswordStrength(val);
    if (err) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: err });
    }
  });

export const registerSchema = z.object({
  name: z
    .string()
    .transform((v) => normalizeFullName(v))
    .superRefine((val, ctx) => {
      const err = validateFullName(val);
      if (err) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: err });
      }
    }),
  email: z
    .string()
    .transform((v) => normalizeEmail(v))
    .pipe(z.string().email('Please enter a valid email address.').max(254)),
  phone: z.string().trim().min(10, 'Valid Bangladesh phone number is required').max(20).optional(),
  password: strongPasswordSchema,
});

export const identifyEmailSchema = z.object({
  email: z
    .string()
    .transform((v) => normalizeEmail(v))
    .pipe(z.string().email('Please enter a valid email address.').max(254)),
});

export const loginSchema = z.object({
  email: z
    .string()
    .transform((v) => normalizeEmail(v))
    .pipe(z.string().email('Valid email is required')),
  password: z.string().min(1, 'Password is required'),
});

export const completeSocialEmailSchema = z.object({
  challengeToken: z.string().min(20, 'Verification session token is required.'),
  email: z
    .string()
    .transform((v) => normalizeEmail(v))
    .pipe(z.string().email('Please enter a valid email address.').max(254)),
  name: z
    .string()
    .transform((v) => normalizeFullName(v))
    .optional(),
});

export const confirmOAuthLinkSchema = z.object({
  linkToken: z.string().min(20, 'Account linking token is required.'),
  password: z.string().min(1).optional(),
});

export const setPasswordSchema = z.object({
  newPassword: strongPasswordSchema,
});

export const updateProfileSchema = z.object({
  name: z
    .string()
    .transform((v) => normalizeFullName(v))
    .pipe(z.string().min(2).max(100)),
  phone: z.string().trim().max(24).optional(),
  avatarUrl: z
    .string()
    .trim()
    .max(400)
    .refine(
      (val) => val === '' || val.startsWith('/') || val.startsWith('https://') || val.startsWith('http://'),
      'Avatar URL must be a relative path or valid HTTP/HTTPS URL.',
    )
    .optional(),
  notificationPrefs: z
    .object({
      orderUpdates: z.boolean(),
      promotions: z.boolean(),
      backInStock: z.boolean(),
    })
    .optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required.'),
  newPassword: strongPasswordSchema,
});

export const forgotPasswordSchema = z.object({
  email: z
    .string()
    .transform((v) => normalizeEmail(v))
    .pipe(z.string().email('Valid email is required')),
});

export const resetPasswordSchema = z.object({
  email: z
    .string()
    .transform((v) => normalizeEmail(v))
    .pipe(z.string().email('Valid email is required')),
  token: z.string().min(10, 'Invalid password reset token.'),
  newPassword: strongPasswordSchema,
});

export const verifyEmailSchema = z.object({
  email: z
    .string()
    .transform((v) => normalizeEmail(v))
    .pipe(z.string().email('Valid email is required')),
  token: z.string().min(10, 'Invalid verification token.'),
});

export const resendVerificationSchema = z.object({
  email: z
    .string()
    .transform((v) => normalizeEmail(v))
    .pipe(z.string().email('Valid email is required')),
});
