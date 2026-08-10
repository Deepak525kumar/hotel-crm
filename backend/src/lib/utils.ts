import crypto from 'crypto';
import { REQUEST_ID_PREFIX, ID_PREFIXES } from '../config/constants.js';

export function generateRequestId(): string {
  const randomPart = crypto.randomBytes(8).toString('hex');
  return REQUEST_ID_PREFIX + randomPart;
}

export function generateId(prefix: string): string {
  const randomPart = crypto.randomBytes(8).toString('hex');
  return prefix + randomPart;
}

export function generateUserId(): string {
  return generateId(ID_PREFIXES.USER);
}

export function generateRoleId(): string {
  return generateId(ID_PREFIXES.ROLE);
}

export function generatePermissionId(): string {
  return generateId(ID_PREFIXES.PERMISSION);
}

export function generateSessionId(): string {
  return generateId(ID_PREFIXES.SESSION);
}

export function generateTokenId(): string {
  return generateId(ID_PREFIXES.TOKEN);
}

export function getCurrentTimestamp(): string {
  return new Date().toISOString();
}

export function extractSortField(sort?: string): { field: string; order: 'asc' | 'desc' } | null {
  if (!sort) return null;

  const descending = sort.startsWith('-');
  const field = descending ? sort.slice(1) : sort;

  return {
    field,
    order: descending ? 'desc' : 'asc',
  };
}

export function parsePaginationParams(
  page?: string | number,
  limit?: string | number
): { page: number; limit: number } {
  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.max(1, Math.min(100, Number(limit) || 20));

  return { page: pageNum, limit: limitNum };
}

// OD-CAL-04: "today" is anchored to Europe/Berlin (matches Hotel.timezone's
// own default, SPEC-CRM-001) pending a platform-wide timezone decision.
export const CALENDAR_TIMEZONE = 'Europe/Berlin';

export function todayInCalendarTimezone(timezone: string = CALENDAR_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
}
