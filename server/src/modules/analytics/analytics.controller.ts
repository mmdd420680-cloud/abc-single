import type { Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from '../../middleware/auth.middleware';
import { sendSuccess } from '../../utils/apiResponse';
import {
  exportSalesCsv,
  getAdminNotificationsFeed,
  getAdminOverviewData,
  getAnalyticsReport,
  getUserAuthenticationStatsAdmin,
  getUserProviderBreakdownAdmin,
  getUserRegistrationTrendsAdmin,
  getWishlistAnalyticsAdmin,
  searchAdminEntities,
} from './analytics.service';

export async function getOverviewController(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const days = Math.min(365, Math.max(7, Number(req.query.days || 30)));
    const revRange = String(req.query.revRange || 'month');
    const data = await getAdminOverviewData(days, revRange);
    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
}

export async function adminSearchController(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const q = String(req.query.q || '').trim();
    const results = await searchAdminEntities(q);
    sendSuccess(res, { results });
  } catch (err) {
    next(err);
  }
}

export async function notificationsFeedController(_req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const data = await getAdminNotificationsFeed();
    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
}

export async function analyticsReportController(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const days = Math.min(365, Math.max(7, Number(req.query.days || 30)));
    const report = await getAnalyticsReport(days);
    sendSuccess(res, report);
  } catch (err) {
    next(err);
  }
}

export async function exportSalesCsvController(_req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const csv = await exportSalesCsv();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="novara-sales-report.csv"');
    res.send(csv);
  } catch (err) {
    next(err);
  }
}

export async function wishlistAnalyticsController(_req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const data = await getWishlistAnalyticsAdmin();
    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
}

export async function userAuthStatsController(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const days = req.query.days ? Math.min(365, Math.max(7, Number(req.query.days))) : 30;
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    const data = await getUserAuthenticationStatsAdmin({ days, from, to });
    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
}

export async function userRegistrationTrendsController(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const days = req.query.days ? Math.min(365, Math.max(7, Number(req.query.days))) : 30;
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    const data = await getUserRegistrationTrendsAdmin({ days, from, to });
    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
}

export async function userProviderBreakdownController(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const provider = typeof req.query.provider === 'string' ? req.query.provider : undefined;
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(5, Number(req.query.limit || 20)));
    const data = await getUserProviderBreakdownAdmin({ provider, q, page, limit, from, to });
    sendSuccess(res, data);
  } catch (err) {
    next(err);
  }
}
