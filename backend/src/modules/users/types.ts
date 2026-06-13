import { z } from 'zod';

export const CreateUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  phone: z.string().optional(),
  role: z.enum(['worker', 'checker', 'manager', 'admin']).default('worker'),
});

export const UpdateUserSchema = z.object({
  first_name: z.string().min(1).max(100).optional(),
  last_name: z.string().min(1).max(100).optional(),
  phone: z.string().optional(),
  role: z.enum(['worker', 'checker', 'manager', 'admin']).optional(),
  is_active: z.boolean().optional(),
});

export const ListUsersQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  role: z.enum(['worker', 'checker', 'manager', 'admin']).optional(),
  hotel_id: z.string().optional(),
  search: z.string().optional(),
  is_active: z.enum(['true', 'false']).optional(),
});

export type CreateUserRequest = z.infer<typeof CreateUserSchema>;
export type UpdateUserRequest = z.infer<typeof UpdateUserSchema>;
export type ListUsersQuery = z.infer<typeof ListUsersQuerySchema>;
