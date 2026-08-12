import axios from 'axios';

interface IPAnalysisResult {
  success: boolean;
  ip: string;
  isVpnTor: boolean;
  vpnProvider?: string;
  torExitNode: boolean;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  details?: {
    country?: string;
    isp?: string;
    type?: string;
  };
  error?: string;
}

interface IPRegistrationRecord {
  ip: string;
  agencyId: string;
  registrationType: 'FREE' | 'PREMIUM';
  timestamp: Date;
  flagged: boolean;
}

interface IPFraudCheckResult {
  multipleRegistrations: boolean;
  registrationCount: number;
  freeRegistrationCount: number;
  daysSinceOldest: number;
  shouldFlag: boolean;
  message: string;
}

class IPAnalysisService {
  private static vpnProviders = [
    'expressvpn',
    'nordvpn',
    'surfshark',
    'cyberghost',
    'private-internet-access',
    'protonvpn',
    'ipvanish',
    'windscribe',
    'hotspot-shield',
    'astrill',
    'bitdefender',
    'kaspersky',
    'mullvad',
    'torbrowser',
  ];

  /**
   * Analyze IP for VPN/Tor usage
   */
  static async analyzeIP(ipAddress: string): Promise<IPAnalysisResult> {
    try {
      console.log(`[IP ANALYSIS] Analyzing IP: ${ipAddress}`);

      // Check against VPN detection API (using free service for demo)
      const vpnCheckResult = await this.checkVPNStatus(ipAddress);

      const isVpn = vpnCheckResult.isVpn || vpnCheckResult.isTor;
      const riskLevel = this.calculateIPRiskLevel(vpnCheckResult);

      const result: IPAnalysisResult = {
        success: true,
        ip: ipAddress,
        isVpnTor: isVpn,
        vpnProvider: vpnCheckResult.vpnProvider,
        torExitNode: vpnCheckResult.isTor,
        riskLevel,
        details: {
          country: vpnCheckResult.country,
          isp: vpnCheckResult.isp,
          type: vpnCheckResult.type,
        },
      };

      console.log(`[IP ANALYSIS] Result:`, {
        ip: ipAddress,
        isVpnTor: isVpn,
        riskLevel,
        torExitNode: vpnCheckResult.isTor,
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[IP ANALYSIS] Error analyzing IP: ${errorMessage}`);

      return {
        success: false,
        ip: ipAddress,
        isVpnTor: false,
        torExitNode: false,
        riskLevel: 'MEDIUM',
        error: errorMessage,
      };
    }
  }

  /**
   * Check VPN status using free IP lookup service
   */
  private static async checkVPNStatus(
    ipAddress: string
  ): Promise<{
    isVpn: boolean;
    isTor: boolean;
    vpnProvider?: string;
    country?: string;
    isp?: string;
    type?: string;
  }> {
    try {
      // Using ip-api.com free tier (limited requests)
      // In production, use IPQualityScore or MaxMind
      const response = await axios.get(
        `http://ip-api.com/json/${ipAddress}?fields=status,country,isp,org,mobile,proxy`,
        { timeout: 5000 }
      );

      const data = response.data;

      // Basic detection: proxy flag or known VPN providers in ISP name
      const isProxy = data.proxy === true;
      const vpnKeyword = this.vpnProviders.some(provider =>
        (data.isp || '').toLowerCase().includes(provider) ||
        (data.org || '').toLowerCase().includes(provider)
      );

      // Tor detection: known Tor exit nodes (simplified)
      const isTor = (data.isp || '').toLowerCase().includes('tor');

      return {
        isVpn: isProxy || vpnKeyword,
        isTor,
        vpnProvider: vpnKeyword ? 'Unknown VPN' : undefined,
        country: data.country,
        isp: data.isp,
        type: isProxy ? 'Proxy/VPN' : 'Residential',
      };
    } catch (error) {
      console.warn(`[IP ANALYSIS] VPN check failed:`, error);
      // Fail open: don't block, just log
      return {
        isVpn: false,
        isTor: false,
      };
    }
  }

  /**
   * Calculate risk level based on IP characteristics
   */
  private static calculateIPRiskLevel(vpnCheckResult: {
    isVpn: boolean;
    isTor: boolean;
  }): 'LOW' | 'MEDIUM' | 'HIGH' {
    if (vpnCheckResult.isTor) return 'HIGH';
    if (vpnCheckResult.isVpn) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Check if IP has multiple registrations in 90-day window
   */
  static async checkIPRegistrationPattern(
    ipAddress: string,
    registrations: IPRegistrationRecord[]
  ): Promise<IPFraudCheckResult> {
    try {
      console.log(`[IP ANALYSIS] Checking registration pattern for IP: ${ipAddress}`);

      // Filter to 90-day window
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const recentRegistrations = registrations.filter(
        reg => new Date(reg.timestamp) >= ninetyDaysAgo
      );

      const freeRegistrations = recentRegistrations.filter(
        reg => reg.registrationType === 'FREE'
      );

      const daysSinceOldest =
        recentRegistrations.length > 0
          ? Math.floor(
              (Date.now() - new Date(recentRegistrations[0].timestamp).getTime()) /
                (1000 * 60 * 60 * 24)
            )
          : 0;

      // Flag if more than 2 free registrations in 90 days
      const shouldFlag = freeRegistrations.length >= 2;

      const message =
        freeRegistrations.length >= 2
          ? `Found ${freeRegistrations.length} free registrations from same IP in 90 days. Flagged for review.`
          : freeRegistrations.length === 1
          ? `Found 1 free registration from this IP. Monitor for patterns.`
          : 'IP clean - no suspicious registration patterns detected.';

      return {
        multipleRegistrations: recentRegistrations.length > 1,
        registrationCount: recentRegistrations.length,
        freeRegistrationCount: freeRegistrations.length,
        daysSinceOldest,
        shouldFlag,
        message,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[IP ANALYSIS] Pattern check error: ${errorMessage}`);

      return {
        multipleRegistrations: false,
        registrationCount: 0,
        freeRegistrationCount: 0,
        daysSinceOldest: 0,
        shouldFlag: false,
        message: 'Could not analyze IP pattern',
      };
    }
  }

  /**
   * Get all registrations from an IP in 90-day window
   */
  static async getIPRegistrationHistory(
    ipAddress: string,
    allRegistrations: IPRegistrationRecord[]
  ): Promise<IPRegistrationRecord[]> {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    return allRegistrations.filter(
      reg =>
        reg.ip === ipAddress &&
        new Date(reg.timestamp) >= ninetyDaysAgo
    );
  }
}

export { IPAnalysisService, IPAnalysisResult, IPRegistrationRecord, IPFraudCheckResult };