import { db } from '@funtush/database';
import { FingerprintService, FingerprintData, FingerprintMatch } from './fingerprintService';

interface StoreFingerprintPayload {
  agencyId: string;
  fingerprintHash: string;
  fingerprintJson: string;
  ipAddress?: string;
  userAgent: string;
}

interface FingerprintCheckResult {
  success: boolean;
  fingerprint: {
    hash: string;
    isNew: boolean;
    matchResult: FingerprintMatch;
  };
  flaggedForReview: boolean;
  reviewReason?: string;
  agencyId?: string;
  error?: string;
}

class FingerprintDatabaseService {
  /**
   * Store a new fingerprint for an agency
   */
  static async storeFingerprint(payload: StoreFingerprintPayload) {
    try {
      console.log(`[FINGERPRINT DB] Storing fingerprint for agency: ${payload.agencyId}`);

      // Create fingerprint record
      const fingerprint = await db.fingerprint.create({
        data: {
          hash: payload.fingerprintHash,
          agencyId: payload.agencyId,
          data: payload.fingerprintJson,
          ipAddress: payload.ipAddress,
          userAgent: payload.userAgent,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      // Update agency with latest fingerprint
      await db.agency.update({
        where: { id: payload.agencyId },
        data: {
          deviceFingerprint: payload.fingerprintHash,
          deviceFingerprintUpdatedAt: new Date(),
        },
      });

      console.log('[FINGERPRINT DB] Fingerprint stored successfully:', fingerprint.id);

      return {
        success: true,
        fingerprintId: fingerprint.id,
        hash: fingerprint.hash,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[FINGERPRINT DB] Storage error:', errorMessage);

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Check if a fingerprint matches existing ones
   */
  static async checkFingerprint(
    fingerprintJson: string,
    agencyId: string
  ): Promise<FingerprintCheckResult> {
    try {
      // Process the fingerprint
      const processResult = FingerprintService.processFingerprint(fingerprintJson);

      if (!processResult.success) {
        return {
          success: false,
          fingerprint: {
            hash: '',
            isNew: false,
            matchResult: {
              matched: false,
              matchedAgencyIds: [],
              matchedFingerprintIds: [],
              similarityScore: 0,
              flagForReview: false,
              message: processResult.error || 'Failed to process fingerprint',
            },
          },
          flaggedForReview: false,
          error: processResult.error,
        };
      }

      const currentFingerprintHash = processResult.fingerprintHash;
      const currentFingerprintData = processResult.data;

      console.log('[FINGERPRINT DB] Checking fingerprint:', currentFingerprintHash);

      // Get all existing fingerprints
      const existingFingerprints = await db.fingerprint.findMany({
        include: { agency: { select: { id: true, name: true } } },
      });

      const similarityScores: number[] = [];
      const matchedAgencies = new Set<string>();
      const matchedFingerprintIds: string[] = [];

      // Compare against all existing fingerprints
      for (const existing of existingFingerprints) {
        // Skip own fingerprints
        if (existing.agencyId === agencyId) {
          continue;
        }

        try {
          const existingData = JSON.parse(existing.data) as Partial<FingerprintData>;

          const similarity = FingerprintService.compareFingerprintData(
            currentFingerprintData,
            existingData
          );

          similarityScores.push(similarity);

          // Track matches (75% or higher similarity)
          if (similarity >= 75) {
            matchedAgencies.add(existing.agencyId);
            matchedFingerprintIds.push(existing.id);

            console.log(
              `[FINGERPRINT DB] Match found: ${existing.agencyId} (${similarity}% similarity)`
            );
          }
        } catch (parseError) {
          console.warn('[FINGERPRINT DB] Failed to parse existing fingerprint:', parseError);
        }
      }

      // Determine match result
      const matchResult = FingerprintService.determineMatchResult(
        similarityScores,
        75
      );

      matchResult.matchedAgencyIds = Array.from(matchedAgencies);
      matchResult.matchedFingerprintIds = matchedFingerprintIds;

      const isNew = similarityScores.length === 0 || matchResult.similarityScore < 50;

      console.log('[FINGERPRINT DB] Check complete:', {
        hash: currentFingerprintHash,
        isNew,
        matches: matchResult.matchedAgencyIds.length,
        avgSimilarity: matchResult.similarityScore,
      });

      return {
        success: true,
        fingerprint: {
          hash: currentFingerprintHash,
          isNew,
          matchResult,
        },
        flaggedForReview: matchResult.flagForReview,
        reviewReason: matchResult.flagForReview ? matchResult.message : undefined,
        agencyId,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[FINGERPRINT DB] Check error:', errorMessage);

      return {
        success: false,
        fingerprint: {
          hash: '',
          isNew: false,
          matchResult: {
            matched: false,
            matchedAgencyIds: [],
            matchedFingerprintIds: [],
            similarityScore: 0,
            flagForReview: false,
            message: 'Error checking fingerprint',
          },
        },
        flaggedForReview: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Get all fingerprints for an agency
   */
  static async getAgencyFingerprints(agencyId: string) {
    try {
      const fingerprints = await db.fingerprint.findMany({
        where: { agencyId },
        select: {
          id: true,
          hash: true,
          ipAddress: true,
          createdAt: true,
          userAgent: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      return {
        success: true,
        count: fingerprints.length,
        fingerprints,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[FINGERPRINT DB] Get fingerprints error:', errorMessage);

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Flag an agency for review based on fingerprint match
   */
  static async flagAgencyForReview(
    agencyId: string,
    matchedAgencyIds: string[],
    similarityScore: number,
    reason: string
  ) {
    try {
      console.log(`[FINGERPRINT DB] Flagging agency ${agencyId} for review`);

      const flagRecord = await db.fraudFlag.create({
        data: {
          agencyId,
          type: 'FINGERPRINT_MATCH',
          severity: similarityScore >= 90 ? 'HIGH' : 'MEDIUM',
          reason,
          matchedAgencies: matchedAgencyIds.join(','),
          similarityScore,
          status: 'PENDING_REVIEW',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      // Update agency status
      await db.agency.update({
        where: { id: agencyId },
        data: {
          fraudStatus: 'FLAGGED_FOR_REVIEW',
          fraudFlags: { connect: { id: flagRecord.id } },
        },
      });

      console.log('[FINGERPRINT DB] Agency flagged for review:', flagRecord.id);

      return {
        success: true,
        flagId: flagRecord.id,
        severity: flagRecord.severity,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[FINGERPRINT DB] Flag error:', errorMessage);

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Get fraud flags for an agency
   */
  static async getAgencyFraudFlags(agencyId: string) {
    try {
      const flags = await db.fraudFlag.findMany({
        where: { agencyId },
        orderBy: { createdAt: 'desc' },
      });

      return {
        success: true,
        count: flags.length,
        flags,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[FINGERPRINT DB] Get flags error:', errorMessage);

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Review a flagged agency
   */
  static async reviewFlaggedAgency(
    flagId: string,
    approved: boolean,
    adminNotes: string
  ) {
    try {
      const status = approved ? 'APPROVED' : 'REJECTED';

      const updatedFlag = await db.fraudFlag.update({
        where: { id: flagId },
        data: {
          status,
          adminNotes,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        },
      });

      // Update agency status if approved
      if (approved) {
        const flag = await db.fraudFlag.findUnique({ where: { id: flagId } });
        if (flag) {
          await db.agency.update({
            where: { id: flag.agencyId },
            data: { fraudStatus: 'APPROVED' },
          });
        }
      }

      console.log(`[FINGERPRINT DB] Flag reviewed: ${status}`);

      return {
        success: true,
        flagId: updatedFlag.id,
        status: updatedFlag.status,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[FINGERPRINT DB] Review error:', errorMessage);

      return {
        success: false,
        error: errorMessage,
      };
    }
  }
}

export { FingerprintDatabaseService, FingerprintCheckResult };