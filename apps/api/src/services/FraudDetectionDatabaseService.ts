import { db } from '@funtush/database';
import { IPAnalysisService, IPRegistrationRecord, IPFraudCheckResult } from './ipAnalysisService';
import { EmailAnalysisService } from './emailAnalysisService';

class FraudDetectionDatabaseService {
  /**
   * Store IP registration record
   */
  static async recordIPRegistration(
    agencyId: string,
    ipAddress: string,
    registrationType: 'FREE' | 'PREMIUM'
  ) {
    try {
      console.log(
        `[FRAUD DB] Recording IP registration: ${agencyId} from ${ipAddress}`
      );

      const record = await db.ipRegistration.create({
        data: {
          agencyId,
          ipAddress,
          registrationType,
          timestamp: new Date(),
        },
      });

      return { success: true, recordId: record.id };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[FRAUD DB] IP registration record error: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Get all IP registrations for fraud analysis
   */
  static async getAllIPRegistrations(): Promise<IPRegistrationRecord[]> {
    try {
      const records = await db.ipRegistration.findMany({
        include: { agency: { select: { id: true } } },
      });

      return records.map(r => ({
        ip: r.ipAddress,
        agencyId: r.agencyId,
        registrationType: r.registrationType,
        timestamp: r.timestamp,
        flagged: false,
      }));
    } catch (error) {
      console.error(`[FRAUD DB] Get IP registrations error:`, error);
      return [];
    }
  }

  /**
   * Check IP for fraud patterns
   */
  static async checkIPFraudPattern(ipAddress: string): Promise<IPFraudCheckResult> {
    try {
      console.log(`[FRAUD DB] Checking IP fraud pattern: ${ipAddress}`);

      const allRegistrations = await this.getAllIPRegistrations();
      const ipRegistrations = allRegistrations.filter(r => r.ip === ipAddress);

      return IPAnalysisService.checkIPRegistrationPattern(
        ipAddress,
        ipRegistrations
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[FRAUD DB] IP pattern check error: ${errorMessage}`);

      return {
        multipleRegistrations: false,
        registrationCount: 0,
        freeRegistrationCount: 0,
        daysSinceOldest: 0,
        shouldFlag: false,
        message: 'Error checking IP pattern',
      };
    }
  }

  /**
   * Store email in normalized form for uniqueness checks
   */
  static async recordEmail(agencyId: string, email: string) {
    try {
      const normalized = EmailAnalysisService.normalizeEmail(email);

      const record = await db.agencyEmail.create({
        data: {
          agencyId,
          email,
          normalizedEmail: normalized,
        },
      });

      return { success: true, recordId: record.id, normalizedEmail: normalized };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[FRAUD DB] Email record error: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Check email uniqueness (after normalization)
   */
  static async checkEmailUniqueness(email: string): Promise<{
    isUnique: boolean;
    duplicateEmail?: string;
    message: string;
  }> {
    try {
      console.log(`[FRAUD DB] Checking email uniqueness: ${email}`);

      const allEmails = await db.agencyEmail.findMany({
        select: { email: true },
      });

      const emailList = allEmails.map(e => e.email);

      return EmailAnalysisService.checkEmailUniqueness(email, emailList);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[FRAUD DB] Email uniqueness check error: ${errorMessage}`);

      return {
        isUnique: false,
        message: `Error checking email uniqueness: ${errorMessage}`,
      };
    }
  }

  /**
   * Record trial usage data for behavioral analysis
   */
  static async recordTrialUsage(
    agencyId: string,
    daysOfTrial: number,
    featureLimitHits: number,
    packageCount: number,
    guideCount: number,
    profileCompleted: boolean
  ) {
    try {
      console.log(`[FRAUD DB] Recording trial usage for agency: ${agencyId}`);

      const record = await db.trialUsage.create({
        data: {
          agencyId,
          daysOfTrial,
          featureLimitHits,
          packageCount,
          guideCount,
          profileCompleted,
          recordedAt: new Date(),
        },
      });

      return { success: true, recordId: record.id };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[FRAUD DB] Trial usage record error: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Get previous trial data for behavioral analysis
   */
  static async getPreviousTrialData(agencyId: string) {
    try {
      const records = await db.trialUsage.findMany({
        where: { agencyId },
        orderBy: { recordedAt: 'desc' },
      });

      return records.map(r => ({
        agencyId: r.agencyId,
        daysOfTrial: r.daysOfTrial,
        featureLimitHits: r.featureLimitHits,
        packageCount: r.packageCount,
        guideCount: r.guideCount,
        profileCompleted: r.profileCompleted,
        trialStartDate: new Date(),
        trialEndDate: new Date(),
      }));
    } catch (error) {
      console.error(`[FRAUD DB] Get trial data error:`, error);
      return [];
    }
  }

  /**
   * Flag fraud based on multiple layers
   */
  static async createFraudFlag(
    agencyId: string,
    layers: string[],
    message: string,
    severity: 'LOW' | 'MEDIUM' | 'HIGH'
  ) {
    try {
      console.log(
        `[FRAUD DB] Creating fraud flag for agency ${agencyId}: ${severity}`
      );

      const flag = await db.fraudFlag.create({
        data: {
          agencyId,
          type: 'MULTI_LAYER_FRAUD_DETECTION',
          severity,
          reason: `Flagged by layers: ${layers.join(', ')}`,
          status: 'PENDING_REVIEW',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      return { success: true, flagId: flag.id };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[FRAUD DB] Fraud flag creation error: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Get fraud detection summary for agency
   */
  static async getFraudDetectionSummary(agencyId: string) {
    try {
      const flags = await db.fraudFlag.findMany({
        where: { agencyId },
      });

      const ipRegistrations = await db.ipRegistration.findMany({
        where: { agencyId },
      });

      return {
        flagCount: flags.length,
        flags,
        ipRegistrations: ipRegistrations.length,
        lastFlagDate: flags.length > 0 ? flags[0].createdAt : null,
        status: flags.some(f => f.status === 'PENDING_REVIEW')
          ? 'UNDER_REVIEW'
          : flags.some(f => f.status === 'REJECTED')
          ? 'REJECTED'
          : 'APPROVED',
      };
    } catch (error) {
      console.error(`[FRAUD DB] Summary error:`, error);
      return {
        flagCount: 0,
        flags: [],
        ipRegistrations: 0,
        lastFlagDate: null,
        status: 'UNKNOWN',
      };
    }
  }
}

export { FraudDetectionDatabaseService };