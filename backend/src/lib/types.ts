import type { UserScope } from './jwt.js';

export interface AuthContext {
  userId: string;
  email: string;
  role: string;
  permissions: string[];
  scope?: UserScope | null;
}

export interface ApiResponse<T = unknown> {
  status: 'success' | 'error';
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Array<{
      field?: string;
      message: string;
      value?: unknown;
    }>;
  };
  meta: {
    timestamp: string;
    request_id: string;
  };
}

export interface PaginationParams {
  page: number;
  per_page: number;
  sort?: string;
  search?: string;
}

export interface PaginatedResponse<T> {
  status: 'success';
  data: T[];
  pagination: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
    has_next: boolean;
    has_prev: boolean;
  };
  meta: {
    timestamp: string;
    request_id: string;
  };
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
      requestId: string;
      request_id?: string;
    }
  }
}
