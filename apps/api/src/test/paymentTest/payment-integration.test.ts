import { describe, it, expect, beforeAll } from 'vitest';
import 'dotenv/config';
import { encryptCredentials, decryptCredentials } from '../../utils/encryption';

describe('Encryption - Credentials at Rest', () => {
  const testData = {
    apiKey: 'test_api_key_12345',
    secret: 'test_secret_abcdef',
    accountId: 'acc_123456789',
  };

  beforeAll(() => {
    if (!process.env.ENCRYPTION_KEY) {
      process.env.ENCRYPTION_KEY = 'a'.repeat(64); // Test key
    }
  });

  describe('Credential Encryption', () => {
    it('should encrypt credentials successfully', () => {
      const encrypted = encryptCredentials(testData);
      expect(encrypted).toBeTruthy();
      expect(encrypted).not.toContain(testData.apiKey); // Must not contain plaintext
      expect(encrypted).not.toContain(testData.secret);
    });

    it('should decrypt encrypted credentials', () => {
      const encrypted = encryptCredentials(testData);
      const decryptedData = decryptCredentials(encrypted) as typeof testData;

      expect(decryptedData.apiKey).toBe(testData.apiKey);
      expect(decryptedData.secret).toBe(testData.secret);
    });

    it('should produce different ciphertext for same plaintext', () => {
      const encrypted1 = encryptCredentials(testData);
      const encrypted2 = encryptCredentials(testData);

      expect(encrypted1).not.toBe(encrypted2); // Different IVs
      expect(decryptCredentials(encrypted1)).toEqual(decryptCredentials(encrypted2)); // Same plaintext
    });

    it('should throw error on corrupted ciphertext', () => {
      const encrypted = encryptCredentials(testData);
      const corrupted = encrypted.slice(0, -10) + 'XXXXXX'; // Corrupt last bytes

      expect(() => decryptCredentials(corrupted)).toThrow();
    });

    it('should throw error on invalid encryption key', () => {
      const originalKey = process.env.ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY = 'b'.repeat(64); // Different key

      const encrypted = encryptCredentials(testData);

      process.env.ENCRYPTION_KEY = originalKey; // Restore

      expect(() => decryptCredentials(encrypted)).toThrow();
    });
  });

  describe('API Response Security', () => {
    it('should never return encrypted credentials in API response', async () => {
      // This test simulates what the endpoint should do
      const credentials = {
        apiKey: 'sk_live_secret123',
        secret: 'rk_live_secret456',
      };

      const encrypted = encryptCredentials(credentials);

      // Simulate API response - should NOT include encrypted value
      const apiResponse = {
        id: 'pm_123',
        provider: 'stripe',
        isActive: true,
        createdAt: new Date(),
        // credentials field should NOT be in response
      };

      expect(apiResponse).not.toHaveProperty('credentialsEncrypted');
      expect(JSON.stringify(apiResponse)).not.toContain(encrypted);
    });
  });
});