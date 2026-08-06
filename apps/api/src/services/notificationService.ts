import { smsService } from './smsService';
import { emailService } from './emailService';

interface NotificationPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

interface PushNotificationOptions {
  priority?: 'HIGH' | 'NORMAL';
  timeout?: number;
}

// Values allowed by emailService's EmailTemplateData index signature
type EmailSafeValue = string | number | boolean | string[] | Record<string, unknown>;
type EmailSafeData = Record<string, EmailSafeValue>;

interface AdminNotificationPayload {
  type: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  priority?: 'HIGH' | 'NORMAL';
}

class NotificationService {
  private pushTimeoutMs: number;

  constructor() {
    this.pushTimeoutMs = parseInt(process.env.PUSH_TIMEOUT_MS || '5000', 10);
  }

  /**
   * Send notification with fallback chain: Push → SMS
   */
  async sendNotification(
    phoneNumber: string,
    pushToken: string | null,
    message: string,
    options: PushNotificationOptions = {}
  ): Promise<{ success: boolean; method: 'push' | 'sms'; messageId?: string }> {
    const { priority = 'NORMAL' } = options;

    // Try push notification first if token available
    if (pushToken) {
      try {
        const pushResult = await this.sendPushWithTimeout(pushToken, {
          title: 'Funtush Alert',
          body: message,
        });

        if (pushResult.success) {
          console.log('[NOTIFICATION] Push sent successfully');
          return { success: true, method: 'push', messageId: pushResult.messageId };
        }
      } catch (_error) {
        console.warn('[NOTIFICATION] Push failed, falling back to SMS');
      }
    }

    // Fallback to SMS — map our priority vocabulary to smsService's
    const smsPriority: 'NORMAL' | 'CRITICAL' = priority === 'HIGH' ? 'CRITICAL' : 'NORMAL';

    const smsResult = await smsService.sendSMS(phoneNumber, message, {
      priority: smsPriority,
    });

    return {
      success: smsResult.success,
      method: 'sms',
      messageId: smsResult.messageId,
    };
  }

  /**
   * Send critical SOS notification
   */
  async sendSOSNotification(
    phoneNumber: string,
    sosDetails: {
      location: string;
      guideName: string;
      emergencyNumber: string;
      sosType: 'MEDICAL' | 'WEATHER' | 'LOST' | 'MANUAL';
    }
  ): Promise<{ success: boolean; method: 'sms' }> {
    // SOS always sends SMS directly, no push
    const result = await smsService.sendSOSConfirmation(phoneNumber, sosDetails);

    return {
      success: result.success,
      method: 'sms',
    };
  }

  /**
   * Send notification via email
   */
  async sendEmailNotification(
    to: string,
    template: string,
    data: EmailSafeData
  ): Promise<{ success: boolean; messageId?: string }> {
    try {
      const result = await emailService.send({
        to,
        subject: `Funtush: ${template}`,
        template,
        data,
      });

      return {
        success: result.success,
        messageId: result.messageId,
      };
    } catch (_error) {
      console.error('[NOTIFICATION] Email send error:', _error instanceof Error ? _error.message : String(_error));
      return { success: false };
    }
  }

  /**
   * Send a notification to all admins (e.g. campaign approval requests)
   */
  async sendNotificationToAdmins(
    payload: AdminNotificationPayload
  ): Promise<{ success: boolean }> {
    // TODO: replace with a real admin lookup (DB query) if you have an Admin/User table
    const adminPhoneNumbers = (process.env.ADMIN_PHONE_NUMBERS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const adminEmails = (process.env.ADMIN_EMAILS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    // Narrow the loosely-typed incoming data down to values emailService accepts
    const safeData: EmailSafeData = {
      title: payload.title,
      message: payload.message,
      ...sanitizeForEmail(payload.data),
    };

    const results = await Promise.allSettled([
      ...adminPhoneNumbers.map((phone) =>
        this.sendNotification(phone, null, payload.message, {
          priority: payload.priority,
        })
      ),
      ...adminEmails.map((email) =>
        this.sendEmailNotification(email, payload.type, safeData)
      ),
    ]);

    const success = results.some(
      (r) => r.status === 'fulfilled' && r.value.success
    );

    return { success };
  }

  /**
   * Send push notification with timeout
   */
  private async sendPushWithTimeout(
    _token: string,
    _payload: NotificationPayload
  ): Promise<{ success: boolean; messageId?: string }> {
    try {
      // Placeholder for actual push implementation (Firebase Cloud Messaging, etc.)
      // For now, return mock result
      console.log('[PUSH] Placeholder - actual implementation needed');

      return {
        success: true,
        messageId: `mock-push-${Date.now()}`,
      };
    } catch (_error) {
      console.error('[PUSH] Error:', _error instanceof Error ? _error.message : String(_error));
      return { success: false };
    }
  }
}

/**
 * Strip out any values that aren't safe for EmailTemplateData
 */
function sanitizeForEmail(data?: Record<string, unknown>): EmailSafeData {
  if (!data) return {};

  const result: EmailSafeData = {};

  for (const [key, value] of Object.entries(data)) {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      result[key] = value;
    } else if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
      result[key] = value as string[];
    } else if (value !== null && typeof value === 'object') {
      result[key] = value as Record<string, unknown>;
    }
    // silently drop anything else (functions, symbols, undefined, etc.)
  }

  return result;
}

export const notificationService = new NotificationService();