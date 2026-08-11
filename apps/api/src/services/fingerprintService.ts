import crypto from 'crypto';

interface FingerprintData {
  userAgent: string;
  screenResolution: string;
  timezone: string;
  installedFonts: string[];
  webglRenderer: string;
  canvasHash: string;
  audioContextHash: string;
  language: string;
  platform: string;
  hardwareConcurrency: number;
  deviceMemory: number;
  timestamp: Date;
}

interface FingerprintResult {
  success: boolean;
  fingerprintHash: string;
  data: Partial<FingerprintData>;
  error?: string;
}

interface FingerprintMatch {
  matched: boolean;
  matchedAgencyIds: string[];
  matchedFingerprintIds: string[];
  similarityScore: number;
  flagForReview: boolean;
  message: string;
}

class FingerprintService {
  /**
   * Generate device fingerprint from browser data
   * This is designed to run on the CLIENT-SIDE
   * Returns stringified data to send to server
   */
  static generateClientFingerprint(): string {
    try {
      const fingerprint: Partial<FingerprintData> = {
        userAgent: navigator.userAgent,
        screenResolution: `${screen.width}x${screen.height}`,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        language: navigator.language,
        platform: navigator.platform,
        hardwareConcurrency: navigator.hardwareConcurrency || 1,
        deviceMemory: (navigator.deviceMemory as any) || 8,
        timestamp: new Date(),
      };

      // Fonts detection (common fonts)
      fingerprint.installedFonts = this.detectInstalledFonts();

      // Canvas fingerprinting
      fingerprint.canvasHash = this.getCanvasHash();

      // WebGL fingerprinting
      fingerprint.webglRenderer = this.getWebGLRenderer();

      // Audio context fingerprinting
      fingerprint.audioContextHash = this.getAudioContextHash();

      return JSON.stringify(fingerprint);
    } catch (error) {
      console.error('[FINGERPRINT] Client-side generation error:', error);
      return '';
    }
  }

  /**
   * Process and hash fingerprint data on SERVER-SIDE
   */
  static async processFingerprint(
    fingerprintJson: string
  ): Promise<FingerprintResult> {
    try {
      if (!fingerprintJson) {
        return {
          success: false,
          fingerprintHash: '',
          data: {},
          error: 'No fingerprint data provided',
        };
      }

      const data = JSON.parse(fingerprintJson) as Partial<FingerprintData>;

      // Validate essential fields
      if (!data.userAgent || !data.screenResolution) {
        return {
          success: false,
          fingerprintHash: '',
          data,
          error: 'Missing essential fingerprint data',
        };
      }

      // Create fingerprint hash from all data
      const fingerprintHash = this.hashFingerprint(data);

      console.log('[FINGERPRINT] Processed successfully:', {
        hash: fingerprintHash,
        userAgent: data.userAgent,
        screen: data.screenResolution,
        timezone: data.timezone,
      });

      return {
        success: true,
        fingerprintHash,
        data,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[FINGERPRINT] Processing error:', errorMessage);

      return {
        success: false,
        fingerprintHash: '',
        data: {},
        error: errorMessage,
      };
    }
  }

  /**
   * Hash fingerprint data using SHA-256
   */
  private static hashFingerprint(data: Partial<FingerprintData>): string {
    try {
      // Combine all fingerprint components
      const components = [
        data.userAgent || '',
        data.screenResolution || '',
        data.timezone || '',
        (data.installedFonts || []).join(','),
        data.webglRenderer || '',
        data.canvasHash || '',
        data.audioContextHash || '',
        data.language || '',
        data.platform || '',
        String(data.hardwareConcurrency || 1),
        String(data.deviceMemory || 8),
      ];

      // Create single string
      const fingerprintString = components.join('|');

      // Hash using SHA-256
      const hash = crypto
        .createHash('sha256')
        .update(fingerprintString)
        .digest('hex');

      return hash;
    } catch (error) {
      console.error('[FINGERPRINT] Hashing error:', error);
      throw new Error('Failed to hash fingerprint');
    }
  }

  /**
   * Detect installed fonts (CSS font detection)
   * This should run on CLIENT-SIDE
   */
  private static detectInstalledFonts(): string[] {
    const baseFonts = ['monospace', 'sans-serif', 'serif'];
    const testString = 'mmmmmmmmmmlli';
    const textSize = '72px';

    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return baseFonts;

      ctx.textSize = textSize;
      ctx.textBaseline = 'top';

      const fonts = [
        'Arial',
        'Verdana',
        'Times New Roman',
        'Courier New',
        'Georgia',
        'Palatino',
        'Garamond',
        'Bookman',
        'Comic Sans MS',
        'Trebuchet MS',
        'Impact',
      ];

      const detectedFonts: string[] = [];

      for (const font of fonts) {
        ctx.font = `${textSize} ${font}, ${baseFonts[0]}`;
        const width1 = ctx.measureText(testString).width;

        ctx.font = `${textSize} ${baseFonts[0]}`;
        const width2 = ctx.measureText(testString).width;

        if (width1 !== width2) {
          detectedFonts.push(font);
        }
      }

      return detectedFonts.length > 0 ? detectedFonts : baseFonts;
    } catch (_error) {
      return baseFonts;
    }
  }

  /**
   * Get WebGL renderer fingerprint
   */
  private static getWebGLRenderer(): string {
    try {
      const canvas = document.createElement('canvas');
      const gl =
        canvas.getContext('webgl') || canvas.getContext('experimental-webgl');

      if (!gl) return 'WebGL not supported';

      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (!debugInfo) return 'Debug info not available';

      const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
      return String(renderer || 'Unknown');
    } catch (_error) {
      return 'WebGL error';
    }
  }

  /**
   * Get canvas fingerprint hash
   */
  private static getCanvasHash(): string {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      if (!ctx) return '';

      canvas.width = 280;
      canvas.height = 60;

      ctx.textBaseline = 'top';
      ctx.font = '14px Arial';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#f60';
      ctx.fillRect(125, 1, 62, 20);
      ctx.fillStyle = '#069';
      ctx.fillText('Browser Fingerprint Canvas Test', 2, 15);
      ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
      ctx.fillText('Browser Fingerprint Canvas Test', 4, 17);

      const canvasData = canvas.toDataURL();
      return crypto
        .createHash('sha256')
        .update(canvasData)
        .digest('hex')
        .substring(0, 16);
    } catch (_error) {
      return '';
    }
  }

  /**
   * Get audio context fingerprint
   */
  private static getAudioContextHash(): string {
    try {
      const audioContext =
        window.AudioContext ||
        (window as any).webkitAudioContext ||
        (window as any).mozAudioContext;

      if (!audioContext) return 'AudioContext not supported';

      const context = new audioContext();

      // Get audio system characteristics
      const sampleRate = context.sampleRate;
      const channelCount = context.destination.maxChannelCount;
      const state = context.state;

      const audioData = `${sampleRate}|${channelCount}|${state}`;

      return crypto
        .createHash('sha256')
        .update(audioData)
        .digest('hex')
        .substring(0, 16);
    } catch (_error) {
      return 'AudioContext error';
    }
  }

  /**
   * Compare two fingerprints for similarity
   * Returns similarity score (0-100)
   */
  static compareFingerprintData(
    data1: Partial<FingerprintData>,
    data2: Partial<FingerprintData>
  ): number {
    let matchCount = 0;
    let totalFields = 0;

    // Critical fields (weight 2x)
    const criticalFields = ['userAgent', 'screenResolution', 'timezone'];
    criticalFields.forEach(field => {
      totalFields += 2;
      if (data1[field as keyof FingerprintData] === data2[field as keyof FingerprintData]) {
        matchCount += 2;
      }
    });

    // Secondary fields (weight 1x)
    const secondaryFields = [
      'language',
      'platform',
      'hardwareConcurrency',
      'deviceMemory',
    ];
    secondaryFields.forEach(field => {
      totalFields += 1;
      if (data1[field as keyof FingerprintData] === data2[field as keyof FingerprintData]) {
        matchCount += 1;
      }
    });

    // Tertiary fields (weight 0.5x)
    const tertiaryFields = [
      'webglRenderer',
      'canvasHash',
      'audioContextHash',
    ];
    tertiaryFields.forEach(field => {
      totalFields += 0.5;
      if (
        data1[field as keyof FingerprintData] ===
        data2[field as keyof FingerprintData]
      ) {
        matchCount += 0.5;
      }
    });

    // Fonts array matching
    const fonts1 = data1.installedFonts || [];
    const fonts2 = data2.installedFonts || [];
    const commonFonts = fonts1.filter(f => fonts2.includes(f)).length;
    const fontSimilarity = (commonFonts / Math.max(fonts1.length, fonts2.length)) * 50;

    totalFields += 50;
    matchCount += fontSimilarity;

    const similarityScore = Math.round((matchCount / totalFields) * 100);

    return Math.min(100, Math.max(0, similarityScore));
  }

  /**
   * Check if fingerprint matches existing fingerprints in database
   */
  static determineMatchResult(
    similarityScores: number[],
    threshold: number = 75
  ): FingerprintMatch {
    const matches = similarityScores.filter(score => score >= threshold);
    const hasMatch = matches.length > 0;

    const avgSimilarity =
      similarityScores.length > 0
        ? Math.round(
            similarityScores.reduce((a, b) => a + b, 0) /
              similarityScores.length
          )
        : 0;

    return {
      matched: hasMatch,
      matchedAgencyIds: [], // Will be populated from DB
      matchedFingerprintIds: [], // Will be populated from DB
      similarityScore: avgSimilarity,
      flagForReview: hasMatch,
      message: hasMatch
        ? `Fingerprint matched with ${matches.length} existing account(s). Flagged for review.`
        : 'Fingerprint is unique. No matches found.',
    };
  }
}

export { FingerprintService, FingerprintData, FingerprintResult, FingerprintMatch };