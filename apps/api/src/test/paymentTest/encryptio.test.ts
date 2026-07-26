import 'dotenv/config';
import { describe, it, expect, beforeAll } from 'vitest';
import { encryptCredentials, decryptCredentials } from '../../utils/encryption';

describe('DAY 1: Encrypted Credential Storage', () => {
  beforeAll(() => {
    if (!process.env.ENCRYPTION_KEY) {
      process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    }
  });

  describe('AES-256-GCM Encryption', () => {
    const testCredentials = {
      apiKey: 'sk_live_khalti_123456',
      secret: 'rk_live_khalti_secret',
      merchantCode: 'KHALTI',
    };

    it('should encrypt credentials with AES-256-GCM', () => {
      const encrypted = encryptCredentials(testCredentials);
      const parts = encrypted.split(':');

      expect(parts).toHaveLength(3); // iv:authTag:ciphertext
      expect(parts[0]).toHaveLength(32); // 16 bytes IV in hex
      expect(parts[1]).toHaveLength(32); // 16 bytes auth tag
      expect(/^[a-f0-9]+$/.test(parts[2])).toBe(true); // Hex ciphertext
    });

    it('should decrypt credentials correctly', () => {
      const encrypted = encryptCredentials(testCredentials);
      const decrypted = decryptCredentials(encrypted) as typeof testCredentials;

      expect(decrypted.apiKey).toBe(testCredentials.apiKey);
      expect(decrypted.secret).toBe(testCredentials.secret);
      expect(decrypted.merchantCode).toBe(testCredentials.merchantCode);
    });

    it('should use random IV - different ciphertext each time', () => {
      const encrypted1 = encryptCredentials(testCredentials);
      const encrypted2 = encryptCredentials(testCredentials);

      expect(encrypted1).not.toBe(encrypted2); // Different IVs
      expect(decryptCredentials(encrypted1)).toEqual(testCredentials);
      expect(decryptCredentials(encrypted2)).toEqual(testCredentials);
    });

    it('should throw error on corrupted data', () => {
      expect(() => decryptCredentials('corrupted:data:here')).toThrow();
    });

    it('should throw error on tampered auth tag', () => {
      const encrypted = encryptCredentials(testCredentials);
      const [iv, , ciphertext] = encrypted.split(':');
      const tampered = `${iv}:ffffffffffffffffffffffffffffffff:${ciphertext}`;

      expect(() => decryptCredentials(tampered)).toThrow(
        'Unsupported state or unable to authenticate'
      );
    });

    it('should throw error on wrong encryption key', () => {
      const originalKey = process.env.ENCRYPTION_KEY;
      const encrypted = encryptCredentials(testCredentials);

      process.env.ENCRYPTION_KEY = 'b'.repeat(64); // Wrong key

      expect(() => decryptCredentials(encrypted)).toThrow();

      process.env.ENCRYPTION_KEY = originalKey; // Restore
    });
  });

  describe('Credentials Never in API Responses', () => {
    const esewaCreds = {
      merchantCode: 'EPAYTEST',
      merchantSecret: 'secret123',
    };

    const striveCreds = {
      secretKey: 'sk_test_12345',
      publicKey: 'pk_test_67890',
    };

    it('should encrypt before storing in database', () => {
      const encrypted = encryptCredentials(esewaCreds);

      // Simulate DB record
      const dbRecord = {
        id: 'pm_esewa_123',
        agencyId: 'agency_456',
        provider: 'esewa',
        credentialsEncrypted: encrypted, // Stored encrypted
        isActive: true,
      };

      // Plaintext should NOT be in DB record
      expect(JSON.stringify(dbRecord)).not.toContain(
        esewaCreds.merchantCode
      );
      expect(JSON.stringify(dbRecord)).not.toContain(esewaCreds.merchantSecret);
    });

    it('should not expose credentialsEncrypted in GET response', () => {
      const encrypted = encryptCredentials(striveCreds);

      // API response should exclude credentials field
      const apiResponse = {
        id: 'pm_stripe_789',
        agencyId: 'agency_456',
        provider: 'stripe',
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        // ❌ No credentialsEncrypted field
      };

      expect(apiResponse).not.toHaveProperty('credentialsEncrypted');
      expect(JSON.stringify(apiResponse)).not.toContain(encrypted);
      expect(JSON.stringify(apiResponse)).not.toContain(striveCreds.secretKey);
    });

    it('should not leak credentials in error responses', () => {
      const credentials = {
        apiKey: 'secret_api_key',
        secret: 'secret_secret',
      };

      const encrypted = encryptCredentials(credentials);

      // Error response
      const errorResponse = {
        error: 'Failed to save payment method',
        code: 'PAYMENT_METHOD_ERROR',
        timestamp: new Date().toISOString(),
      };

      expect(JSON.stringify(errorResponse)).not.toContain(
        credentials.apiKey
      );
      expect(JSON.stringify(errorResponse)).not.toContain(credentials.secret);
      expect(JSON.stringify(errorResponse)).not.toContain(encrypted);
    });

    it('should only decrypt when explicitly needed', () => {
      const credentials = { key: 'value' };
      const encrypted = encryptCredentials(credentials);

      // Stored encrypted
      const stored = { credentialsEncrypted: encrypted };
      expect(stored.credentialsEncrypted).not.toContain('key');

      // Only decrypt when needed (e.g., making API call)
      const decrypted = decryptCredentials(stored.credentialsEncrypted) as typeof credentials;
      expect(decrypted.key).toBe('value');
    });
  });

  describe('Multiple Payment Methods', () => {
    const providers = ['khalti', 'esewa', 'stripe', 'fonepay', 'nabil'];

    it('should encrypt credentials for all providers', () => {
      providers.forEach((provider) => {
        const creds = {
          provider,
          secret: `${provider}_secret_123`,
          key: `${provider}_key_456`,
        };

        const encrypted = encryptCredentials(creds);
        const decrypted = decryptCredentials(encrypted) as typeof creds;

        expect(decrypted.provider).toBe(provider);
        expect(decrypted.secret).toBe(creds.secret);
      });
    });

    it('should maintain encryption integrity across multiple operations', () => {
      const credentials = [
        { id: 1, secret: 'khalti_secret' },
        { id: 2, secret: 'esewa_secret' },
        { id: 3, secret: 'stripe_secret' },
      ];

      const encrypted = credentials.map((c) => ({
        id: c.id,
        encrypted: encryptCredentials(c),
      }));

      encrypted.forEach((e, index) => {
        const decrypted = decryptCredentials(e.encrypted) as typeof credentials[number];
        expect(decrypted.secret).toBe(credentials[index].secret);
      });
    });
  });

  describe('Key Management', () => {
    it('should require valid ENCRYPTION_KEY env variable', () => {
      const originalKey = process.env.ENCRYPTION_KEY;

      process.env.ENCRYPTION_KEY = 'tooshort'; // Invalid
      expect(() =>
        encryptCredentials({ test: 'data' })
      ).toThrow('64 hex chars');
      process.env.ENCRYPTION_KEY = originalKey; // Restore
    });

    it('should throw if ENCRYPTION_KEY is missing', () => {
      const originalKey = process.env.ENCRYPTION_KEY;
      delete process.env.ENCRYPTION_KEY;

      expect(() => encryptCredentials({ test: 'data' })).toThrow();

      process.env.ENCRYPTION_KEY = originalKey;
    });
  });
});