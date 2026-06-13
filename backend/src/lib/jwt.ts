import jwt, { SignOptions } from 'jsonwebtoken';
import { getEnv } from '../config/env.js';
import { logger } from './logger.js';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: string;
  permissions: string[];
  iat: number;
  exp: number;
}

export interface RefreshTokenPayload {
  sub: string;
  type: 'refresh';
  iat: number;
  exp: number;
}

export interface JwtTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export function signAccessToken(payload: Omit<AccessTokenPayload, 'iat' | 'exp'>): string {
  const env = getEnv();
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRY as SignOptions['expiresIn'],
    algorithm: 'HS256',
  });
}

export function signRefreshToken(userId: string): string {
  const env = getEnv();
  const secret = env.JWT_REFRESH_SECRET ?? env.JWT_SECRET;
  return jwt.sign({ sub: userId, type: 'refresh' }, secret, {
    expiresIn: env.JWT_REFRESH_EXPIRY as SignOptions['expiresIn'],
    algorithm: 'HS256',
  });
}

export function signTokens(payload: Omit<AccessTokenPayload, 'iat' | 'exp'>): JwtTokens {
  const env = getEnv();
  const access_token = signAccessToken(payload);
  const refresh_token = signRefreshToken(payload.sub);
  const expirySeconds = parseExpiryToSeconds(env.JWT_ACCESS_EXPIRY);

  return { access_token, refresh_token, expires_in: expirySeconds };
}

export function verifyAccessToken(token: string): AccessTokenPayload | null {
  const env = getEnv();
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as AccessTokenPayload;
    return decoded;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      logger.debug('Access token expired', { expiredAt: error.expiredAt });
    } else if (error instanceof jwt.JsonWebTokenError) {
      logger.debug('Invalid access token', { message: error.message });
    } else {
      logger.error('Error verifying access token', { error });
    }
    return null;
  }
}

export function verifyRefreshToken(token: string): RefreshTokenPayload | null {
  const env = getEnv();
  const secret = env.JWT_REFRESH_SECRET ?? env.JWT_SECRET;
  try {
    const decoded = jwt.verify(token, secret) as RefreshTokenPayload;
    if (decoded.type !== 'refresh') {
      return null;
    }
    return decoded;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      logger.debug('Refresh token expired', { expiredAt: error.expiredAt });
    } else if (error instanceof jwt.JsonWebTokenError) {
      logger.debug('Invalid refresh token', { message: error.message });
    } else {
      logger.error('Error verifying refresh token', { error });
    }
    return null;
  }
}

export function extractTokenFromHeader(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return null;
  }
  return parts[1];
}

export function parseExpiryToSeconds(expiryStr: string): number {
  const match = expiryStr.match(/^(\d+)([smhd])$/);
  if (!match) return 3600;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case 's': return value;
    case 'm': return value * 60;
    case 'h': return value * 3600;
    case 'd': return value * 86400;
    default: return 3600;
  }
}
