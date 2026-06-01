import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { authService } from '../src/modules/auth/service.js';
import { getPrisma, disconnectDb } from '../src/lib/db.js';
import { ConflictError, UnauthorizedError } from '../src/lib/errors.js';

describe('Auth Module', () => {
  const prisma = getPrisma();

  beforeAll(async () => {
    // Cleanup test data
    await prisma.user.deleteMany({
      where: { email: { startsWith: 'test-' } },
    });
  });

  afterAll(async () => {
    // Cleanup test data
    await prisma.user.deleteMany({
      where: { email: { startsWith: 'test-' } },
    });
    await disconnectDb();
  });

  describe('Signup', () => {
    it('should create a new user with valid data', async () => {
      const result = await authService.signup({
        email: 'test-user-1@example.com',
        password: 'TestPassword123',
        first_name: 'Test',
        last_name: 'User',
        phone: '+1234567890',
        role: 'worker',
      });

      expect(result.user).toBeDefined();
      expect(result.user.email).toBe('test-user-1@example.com');
      expect(result.user.role).toBe('worker');
      expect(result.access_token).toBeDefined();
      expect(result.refresh_token).toBeDefined();
      expect(result.expires_in).toBeGreaterThan(0);
    });

    it('should throw error if user already exists', async () => {
      await authService.signup({
        email: 'test-user-2@example.com',
        password: 'TestPassword123',
        first_name: 'Test',
        last_name: 'User',
      });

      await expect(
        authService.signup({
          email: 'test-user-2@example.com',
          password: 'TestPassword123',
          first_name: 'Test',
          last_name: 'User',
        })
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('Login', () => {
    beforeAll(async () => {
      await authService.signup({
        email: 'test-login@example.com',
        password: 'TestPassword123',
        first_name: 'Test',
        last_name: 'Login',
      });
    });

    it('should login successfully with correct credentials', async () => {
      const result = await authService.login({
        email: 'test-login@example.com',
        password: 'TestPassword123',
      });

      expect(result.user).toBeDefined();
      expect(result.user.email).toBe('test-login@example.com');
      expect(result.access_token).toBeDefined();
      expect(result.refresh_token).toBeDefined();
    });

    it('should throw error with incorrect password', async () => {
      await expect(
        authService.login({
          email: 'test-login@example.com',
          password: 'WrongPassword123',
        })
      ).rejects.toThrow(UnauthorizedError);
    });

    it('should throw error with non-existent user', async () => {
      await expect(
        authService.login({
          email: 'nonexistent@example.com',
          password: 'TestPassword123',
        })
      ).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('Get Current User', () => {
    let userId: string;

    beforeAll(async () => {
      const result = await authService.signup({
        email: 'test-current@example.com',
        password: 'TestPassword123',
        first_name: 'Current',
        last_name: 'User',
      });
      userId = result.user.id;
    });

    it('should return current user profile', async () => {
      const user = await authService.getCurrentUser(userId);

      expect(user).toBeDefined();
      expect(user.id).toBe(userId);
      expect(user.email).toBe('test-current@example.com');
      expect(user.first_name).toBe('Current');
    });

    it('should throw error for non-existent user', async () => {
      await expect(authService.getCurrentUser('non-existent-id')).rejects.toThrow();
    });
  });

  describe('Update Profile', () => {
    let userId: string;

    beforeAll(async () => {
      const result = await authService.signup({
        email: 'test-update@example.com',
        password: 'TestPassword123',
        first_name: 'Update',
        last_name: 'User',
      });
      userId = result.user.id;
    });

    it('should update user profile', async () => {
      const updated = await authService.updateProfile(userId, {
        first_name: 'Updated',
        phone: '+9876543210',
      });

      expect(updated.first_name).toBe('Updated');
      expect(updated.phone).toBe('+9876543210');
    });

    it('should throw error for non-existent user', async () => {
      await expect(
        authService.updateProfile('non-existent-id', { first_name: 'Test' })
      ).rejects.toThrow();
    });
  });

  describe('Logout', () => {
    let userId: string;

    beforeAll(async () => {
      const result = await authService.signup({
        email: 'test-logout@example.com',
        password: 'TestPassword123',
        first_name: 'Logout',
        last_name: 'User',
      });
      userId = result.user.id;
    });

    it('should logout user successfully', async () => {
      await authService.logout(userId);

      const sessions = await prisma.session.findMany({
        where: { user_id: userId },
      });

      expect(sessions.length).toBe(0);
    });
  });
});
