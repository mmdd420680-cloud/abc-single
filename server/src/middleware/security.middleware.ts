import crypto from 'node:crypto';
import mongoose from 'mongoose';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from './error.middleware';

export interface CorrelatedRequest extends Request {
  requestId?: string;
}

const DANGEROUS_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Recursively strips MongoDB `$` operator keys, dotted keys, and prototype-pollution keys
 * from untrusted request bodies and query parameters.
 */
export function sanitizeUntrustedValue(value: unknown, depth = 0): unknown {
  if (depth > 16 || value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (value instanceof Date || Buffer.isBuffer(value)) return value;

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeUntrustedValue(item, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (DANGEROUS_OBJECT_KEYS.has(key) || key.startsWith('$') || key.includes('.')) {
      continue;
    }
    out[key] = sanitizeUntrustedValue(val, depth + 1);
  }
  return out;
}

export function sanitizeInputMiddleware(req: Request, _res: Response, next: NextFunction): void {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeUntrustedValue(req.body);
  }
  if (req.query && typeof req.query === 'object') {
    req.query = sanitizeUntrustedValue(req.query) as Request['query'];
  }
  next();
}

export function requestCorrelationMiddleware(req: CorrelatedRequest, res: Response, next: NextFunction): void {
  const incomingId = req.get('x-request-id');
  const requestId =
    incomingId && /^[a-zA-Z0-9._-]{8,64}$/.test(incomingId)
      ? incomingId
      : crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  const startedAt = Date.now();
  res.on('finish', () => {
    if (process.env.NODE_ENV === 'test') return;
    if (req.path === '/api/health') return;
    const durationMs = Date.now() - startedAt;
    if (res.statusCode >= 500) {
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'http_request',
          requestId,
          method: req.method,
          path: req.originalUrl,
          statusCode: res.statusCode,
          durationMs,
        }),
      );
    } else if (res.statusCode === 401 || res.statusCode === 403 || res.statusCode === 429) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          event: 'http_security_response',
          requestId,
          method: req.method,
          path: req.originalUrl,
          statusCode: res.statusCode,
          durationMs,
        }),
      );
    }
  });

  next();
}

export function assertValidObjectId(id: string | undefined | null, label = 'resource'): string {
  const clean = String(id || '').trim();
  if (!mongoose.isValidObjectId(clean)) {
    throw new AppError(400, 'INVALID_ID', `Invalid ${label} identifier format.`);
  }
  return clean;
}

/**
 * Escapes CSV fields and neutralizes Excel/Sheets formula injection (`=`, `+`, `-`, `@`, `\t`, `\r`).
 */
export function escapeCsvCell(val: unknown): string {
  let str = String(val ?? '');
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  return `"${str.replace(/"/g, '""')}"`;
}
