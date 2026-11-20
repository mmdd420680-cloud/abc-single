import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireDatabase } from '../../database/connection';
import { authenticateOptional, authenticateRequired } from '../../middleware/auth.middleware';
import {
  adminLoginController,
  changePasswordController,
  completeSocialEmailController,
  confirmOAuthLinkController,
  facebookOAuthCallbackController,
  facebookOAuthRedirectController,
  facebookOAuthUrlController,
  forgotPasswordController,
  getAuthProviders,
  getLinkedProvidersController,
  googleOAuthCallbackController,
  googleOAuthRedirectController,
  googleOAuthUrlController,
  identifyEmailController,
  listSessionsController,
  loginController,
  logoutAllSessionsController,
  logoutController,
  meController,
  registerController,
  resendVerificationController,
  resetPasswordController,
  revokeSessionController,
  setPasswordController,
  unlinkProviderController,
  updateProfileController,
  verifyEmailController,
} from './auth.controller';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, code: 'RATE_LIMITED', error: 'Too many authentication attempts. Please try again shortly.' },
});

router.get('/providers', getAuthProviders);
router.post('/identify', authLimiter, identifyEmailController);
router.post('/register', authLimiter, requireDatabase, registerController);
router.post('/login', authLimiter, requireDatabase, loginController);
router.post('/admin/login', authLimiter, requireDatabase, adminLoginController);
router.post('/logout', authenticateOptional, logoutController);
router.get('/me', requireDatabase, authenticateRequired, meController);
router.patch('/profile', requireDatabase, authenticateRequired, updateProfileController);
router.post('/change-password', requireDatabase, authenticateRequired, changePasswordController);
router.post('/set-password', requireDatabase, authenticateRequired, setPasswordController);
router.post('/verify-email', authLimiter, requireDatabase, verifyEmailController);
router.get('/verify-email', authLimiter, requireDatabase, verifyEmailController);
router.post('/resend-verification', authLimiter, requireDatabase, resendVerificationController);
router.post('/forgot-password', authLimiter, requireDatabase, forgotPasswordController);
router.post('/reset-password', authLimiter, requireDatabase, resetPasswordController);

router.post('/oauth/complete-email', authLimiter, requireDatabase, completeSocialEmailController);
router.post('/oauth/confirm-link', authLimiter, requireDatabase, authenticateOptional, confirmOAuthLinkController);
router.get('/linked-providers', requireDatabase, authenticateRequired, getLinkedProvidersController);
router.delete('/unlink/:provider', requireDatabase, authenticateRequired, unlinkProviderController);
router.get('/sessions', requireDatabase, authenticateRequired, listSessionsController);
router.post('/sessions/:sessionId/revoke', requireDatabase, authenticateRequired, revokeSessionController);
router.post('/logout-all', requireDatabase, authenticateRequired, logoutAllSessionsController);

router.get('/oauth/google/url', authenticateOptional, googleOAuthUrlController);
router.get('/oauth/google', authenticateOptional, googleOAuthRedirectController);
router.get(['/oauth/google/callback', '/oauth/google/callback/'], requireDatabase, authenticateOptional, googleOAuthCallbackController);

router.get('/oauth/facebook/url', authenticateOptional, facebookOAuthUrlController);
router.get('/oauth/facebook', authenticateOptional, facebookOAuthRedirectController);
router.get(['/oauth/facebook/callback', '/oauth/facebook/callback/'], requireDatabase, authenticateOptional, facebookOAuthCallbackController);

export default router;
