// hotel_ids retained in AuthUser transitionally; removed in Phase 5 (S-4)
export interface AuthUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  hotel_ids: string[];
  permissions: string[];
  is_active: boolean;
  phone?: string;
  profile_photo_url?: string;
  created_at: string;
  updated_at?: string;
}

export interface AuthTokens {
  user: AuthUser;
  access_token: string;
  refresh_token: string;
  expires_in: number;
}
