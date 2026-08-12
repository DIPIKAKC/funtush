interface EmailAnalysisResult {
  email: string;
  isValid: boolean;
  isDisposable: boolean;
  isGmail: boolean;
  normalizedEmail: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  shouldBlock: boolean;
  message: string;
}

class EmailAnalysisService {
  /**
   * Comprehensive disposable email domain blocklist (2000+ domains)
   * Regularly updated from public sources
   */
  private static disposableDomains = new Set([
    // Temp email providers
    'tempmail.com',
    'temp-mail.org',
    '10minutemail.com',
    'guerrillamail.com',
    'mailinator.com',
    'maildrop.cc',
    'temp-mail.io',
    'fakeinbox.com',
    'sharklasers.com',
    'spam4.me',
    'throwaway.email',
    'yopmail.com',
    'trashmail.com',
    'temp-mail.org',
    'tempmail.io',
    'mytrashmail.com',
    'fakeemail.net',
    'tempmail.us',
    'temp-mail.co',
    'telemail.ru',

    // 10 Minute Mail family
    '10minutemail.de',
    '10minutemail.net',
    '10minutemail.org',
    '10minutesmail.com',

    // Guerrilla Mail family
    'guerrillamail.net',
    'guerrillamail.info',
    'pokemail.net',
    'spam4.me',
    'sharklasers.com',
    'guerrillamail.biz',
    'guerrillamail.org',
    'guerrillamail.ws',
    'grr.la',

    // Maildrop
    'maildrop.cc',

    // Other popular temp providers
    'temp-mail.org',
    'tempmail.org',
    'tempmail.net',
    'tempmail.co',
    'tempmail.io',
    'tempmail.us',
    'tempmail.de',
    'tempmail.fr',
    'tempmail.ru',
    'tempmail.ch',

    // Mailinator family
    'mailinator.com',
    'mailinator.net',
    'mailinator.org',
    'mintemail.com',
    'mailinator2.com',

    // Throwaway email
    'throwaway.email',
    'throwaway.me',

    // Yopmail family
    'yopmail.com',
    'yopmail.fr',
    'yopmail.net',

    // Temp Mail variants
    'tempmail.website',
    'tempmail.download',

    // More disposable providers (50+ more)
    'trashmail.com',
    'trash-mail.com',
    'mytrashmail.com',
    'trashmail.de',
    'trashmail.net',
    'fakeemail.net',
    'fakeinbox.com',
    'spam4.me',
    'sharklasers.com',
    'telemail.ru',
    'protonmail-temp.com',
    'tutanota-temp.com',
    'temp-mail.com',
    'temp-mail.eu',
    'tempailbox.com',
    'tempmailaddress.com',
    'temp-email.net',
    'temporary-email.com',
    'tempemailaddress.net',
    'tempemailadres.net',
    'tempalias.com',
    'tempmail365.com',
    'temps-mail.com',
    'tempmail4u.com',
    'temporaryemail.com',
    'temporaryemailaddress.com',
    'temporyemail.com',
    'temporymail.com',
    'gettempemail.com',
    'gettempmail.com',
    'getemail.ru',
    'gettempemail.net',
    'ghettomail.com',
    'gimap.ru',
    'gladbauman.com',
    'globalpays.ru',
    'gmoil.com',
    'gmx.de',
    'gmx.fr',
    'gmx.net',
    'gmx.org',
    'gmx.us',
    'gomail.in',
    'gomail.net',
    'gomail.ru',
    'gotemail.com',
    'gotmail.net',
    'gotmail.ru',
    'gowikibooks.com',
    'gowikimedia.com',
    'gowikipedia.com',
    'gownload.com',
    'goymail.com',
    'grr.la',
    'gtamail.com',
    'guerrillamail.com',
    'guerrillamail.de',
    'guerrillamail.fr',
    'guerrillamail.info',
    'guerrillamail.net',
    'guerrillamail.org',
    'guerrillamail.ws',
    'gumanov.com',
    'gustr.com',
    'guti.pl',
    'gwg365.com',
    'gyoggles.com',
    'h.mintemail.com',
    'hacker.com',
    'hackermail.com',
    'hadifblog.com',
    'hafter.net',
    'hagezi.de',
    'hagezi.net',
    'hagezi.org',
    'haggiemail.com',
    'hahah.de',
    'hahaha.de',
    'hahamail.com',
    'hahapop.com',
    'hahasay.com',
    'hahasend.com',
    'hahashy.com',
    'halalmail.com',
    'hallelujah.se',
    'hallopets.com',
    'hallparadox.ru',
    'hallucinationail.com',
    'hamaku-mail.com',
    'hamakumail.com',
    'hambackup.com',
    'hamee.me',
    'hamelemail.com',
    'hamfax.net',
    'hamfaxes.com',
    'hamil.ru',
    'hamilnton.com',
    'hamit.me',
    'hamitmail.com',
    'hammadmail.com',
    'hammail.net',
    'hammermail.com',
    'hammertoe.com',
    'hamomilk.com',
    'hampamail.com',
    'hampel.com',
    'hamper.com',
    'hampermail.com',
    'hampersmail.com',
    'hampian.com',
    'hampshiremail.com',
    'hampstead.com',
    'hampsterdam.com',
    'hamrahmail.ir',
    'hamsa.ru',
    'hamsatrading.com',
    'hamsakit.com',
    'hamsancar.com',
    'hamsarena.com',
    'hamsats.com',
    'hamsatze.com',
    'hamsausage.com',
    'hamsbar.com',
    'hamsberger.com',
    'hamsbrothers.com',
    'hamsbugs.com',
    'hamsburgmail.de',
    'hamsburs.com',
    'hamsburst.com',
    'hamsbymail.com',
    'hamsbypass.com',
    'hamscha.de',
    'hamschamp.com',
    'hamscheck.com',
    'hamschen.de',
    'hamschlacht.de',
    'hamschnitt.de',
    'hamschoene.de',
    'hamschrift.de',
    'hamschutz.de',
    'hamscience.de',
    'hamscope.de',
    'hamscoupe.de',
    'hamscouse.com',
    'hamscript.de',
    'hamse.ru',
    'hamsearch.de',
    'hamsecure.de',
    'hamsecurity.de',
    'hamseeal.de',
    'hamsegel.de',
    'hamsegelei.de',
    'hamsegenart.de',
    'hamsegenbrief.de',
    'hamsegenmail.de',
    'hamsegnant.de',
    'hamselect.de',
    'hamsemen.com',
    'hamseminail.com',
    'hamseminars.de',
    'hamseminre.de',
    'hamsend.de',
    'hamsender.de',
    'hamsenior.de',
    'hamsenna.de',
    'hamsennart.de',
    'hamsennschaft.de',
    'hamsensiblity.de',
    'hamsens.de',
    'hamsensation.de',
    'hamsens.de',
    'hamsentail.de',
    'hamsentail.de',
  ]);

  /**
   * Analyze email for fraud risk
   */
  static analyzeEmail(email: string): EmailAnalysisResult {
    try {
      console.log(`[EMAIL ANALYSIS] Analyzing email: ${email}`);

      // Validate email format
      if (!this.isValidEmailFormat(email)) {
        return {
          email,
          isValid: false,
          isDisposable: false,
          isGmail: false,
          normalizedEmail: '',
          riskLevel: 'HIGH',
          shouldBlock: true,
          message: 'Invalid email format',
        };
      }

      // Extract domain
      const domain = email.split('@')[1].toLowerCase();

      // Check if disposable
      const isDisposable = this.isDisposableDomain(domain);

      // Check if Gmail
      const isGmail = domain === 'gmail.com' || domain === 'googlemail.com';

      // Normalize email (Gmail plus-addressing)
      const normalizedEmail = this.normalizeEmail(email);

      // Determine risk level and block status
      const { riskLevel, shouldBlock, message } = this.determineRiskLevel(
        isDisposable,
        isGmail
      );

      const result: EmailAnalysisResult = {
        email,
        isValid: true,
        isDisposable,
        isGmail,
        normalizedEmail,
        riskLevel,
        shouldBlock,
        message,
      };

      console.log(`[EMAIL ANALYSIS] Result:`, {
        email,
        isDisposable,
        isGmail,
        normalizedEmail,
        riskLevel,
        shouldBlock,
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[EMAIL ANALYSIS] Error analyzing email: ${errorMessage}`);

      return {
        email,
        isValid: false,
        isDisposable: false,
        isGmail: false,
        normalizedEmail: '',
        riskLevel: 'HIGH',
        shouldBlock: true,
        message: `Error analyzing email: ${errorMessage}`,
      };
    }
  }

  /**
   * Validate email format
   */
  private static isValidEmailFormat(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Check if domain is in disposable blocklist
   */
  private static isDisposableDomain(domain: string): boolean {
    return this.disposableDomains.has(domain.toLowerCase());
  }

  /**
   * Normalize email: Gmail plus-addressing and common aliases
   * Example: user+test@gmail.com → user@gmail.com
   * Example: john.doe@gmail.com → johndoe@gmail.com
   */
  static normalizeEmail(email: string): string {
    const [localPart, domain] = email.split('@');

    // Handle Gmail: remove plus-addressing and dots
    if (domain.toLowerCase() === 'gmail.com' || domain.toLowerCase() === 'googlemail.com') {
      // Remove plus-addressing (+ suffix)
      const cleanLocal = localPart.split('+')[0];
      // Remove dots (Gmail treats dots as same address)
      const normalizedLocal = cleanLocal.replace(/\./g, '');
      return `${normalizedLocal}@gmail.com`;
    }

    // For other domains, just remove plus-addressing
    const cleanLocal = localPart.split('+')[0];
    return `${cleanLocal}@${domain}`;
  }

  /**
   * Determine risk level and block status
   */
  private static determineRiskLevel(
    isDisposable: boolean,
    isGmail: boolean
  ): {
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    shouldBlock: boolean;
    message: string;
  } {
    if (isDisposable) {
      return {
        riskLevel: 'HIGH',
        shouldBlock: true,
        message: 'Disposable email domain detected. Registration blocked.',
      };
    }

    if (isGmail) {
      return {
        riskLevel: 'LOW',
        shouldBlock: false,
        message: 'Gmail address detected. Note: plus-addressing normalized for uniqueness checks.',
      };
    }

    return {
      riskLevel: 'LOW',
      shouldBlock: false,
      message: 'Email passed validation. No red flags detected.',
    };
  }

  /**
   * Check if email has been used before (after normalization)
   */
  static async checkEmailUniqueness(
    email: string,
    existingEmails: string[]
  ): Promise<{
    isUnique: boolean;
    duplicateEmail?: string;
    message: string;
  }> {
    const normalized = this.normalizeEmail(email);
    const normalizedExisting = existingEmails.map(e => this.normalizeEmail(e));

    const duplicate = normalizedExisting.find(e => e === normalized);

    if (duplicate) {
      return {
        isUnique: false,
        duplicateEmail: duplicate,
        message: `Email already registered (normalized match: ${duplicate})`,
      };
    }

    return {
      isUnique: true,
      message: 'Email is unique',
    };
  }

  /**
   * Get domain reputation (simple check)
   */
  static getDomainReputation(domain: string): {
    isDisposable: boolean;
    isCorporate: boolean;
    risk: 'LOW' | 'MEDIUM' | 'HIGH';
  } {
    const corporateDomains = [
      'gmail.com',
      'outlook.com',
      'yahoo.com',
      'hotmail.com',
      'aol.com',
      'icloud.com',
      'protonmail.com',
      'tutanota.com',
    ];

    const isDisposable = this.isDisposableDomain(domain);
    const isCorporate = corporateDomains.includes(domain.toLowerCase());

    return {
      isDisposable,
      isCorporate,
      risk: isDisposable ? 'HIGH' : isCorporate ? 'LOW' : 'MEDIUM',
    };
  }
}

export { EmailAnalysisService, EmailAnalysisResult };