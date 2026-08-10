import { describe, it, expect } from "vitest";
import {
  ALLOWED_LINK_PROTOCOLS,
  DEFAULT_CONSTRUCTION_COPY,
  DEFAULT_SITE_CONFIG,
  POPUP_FREQUENCIES,
  POPUP_FREQUENCY_IDS,
  POPUP_MODAL_TIERS,
  POPUP_TRIGGERS,
  POPUP_TRIGGER_IDS,
  SITE_TEXT_LIMITS,
  TOP_BAR_BEHAVIORS,
  TOP_BAR_BEHAVIOR_IDS,
  allowsPopupModal,
  canToggleFuntushBadge,
  isSafeLinkUrl,
  isTrialTier,
  resolveFuntushBadge,
} from "./siteConfig";

/**
 * Tests for the site-config option tables (White-label week · Day 2).
 *
 * These are pure data and pure functions, so the suite is fast and total — it
 * can afford to assert every tier against every rule rather than sampling.
 *
 * That matters more than it sounds. The two tier rules of the day live here, and
 * a tier rule is exactly the kind of thing that is written once, read by
 * everyone, and never tested against the tier nobody was thinking about.
 */

const ALL_TIERS = ["FREE", "SMALL", "MEDIUM", "LARGE"] as const;

describe("allowsPopupModal", () => {
  it("is true for exactly MEDIUM and LARGE", () => {
    // Asserted exhaustively rather than by sampling: the whole table, so adding
    // a fifth tier later fails this test instead of silently getting a popup.
    expect(ALL_TIERS.filter(allowsPopupModal)).toEqual(["MEDIUM", "LARGE"]);
  });

  it("is false for a tier name nobody has heard of", () => {
    // A corrupt or renamed tier row must fail *closed* on a paid feature. The
    // opposite default would hand the popup to anything unrecognised.
    expect(allowsPopupModal("ENTERPRISE")).toBe(false);
    expect(allowsPopupModal("")).toBe(false);
  });

  it("is case sensitive, matching the seeded tier names exactly", () => {
    expect(allowsPopupModal("large")).toBe(false);
  });
});

describe("isTrialTier", () => {
  it("recognises the FREE tier row the 30-day trial sits on", () => {
    expect(isTrialTier("FREE")).toBe(true);
    expect(isTrialTier("SMALL")).toBe(false);
  });
});

describe("resolveFuntushBadge", () => {
  it("forces the badge on for the trial, whatever the agency saved", () => {
    // The stored preference is *ignored*, not defaulted. That is the difference
    // between a rule and a default — and it is what makes a downgrade to the
    // trial restore the badge with no cleanup job anywhere.
    expect(resolveFuntushBadge("FREE", false)).toBe(true);
    expect(resolveFuntushBadge("FREE", true)).toBe(true);
    expect(resolveFuntushBadge("FREE", null)).toBe(true);
    expect(resolveFuntushBadge("FREE")).toBe(true);
  });

  it("hides the badge on every paid tier by default", () => {
    // "Hidden on all paid tiers" — including SMALL, which is a change from the
    // Day 1 guess of `tier !== "LARGE"`.
    for (const tier of ["SMALL", "MEDIUM", "LARGE"]) {
      expect(resolveFuntushBadge(tier, null), tier).toBe(false);
      expect(resolveFuntushBadge(tier), tier).toBe(false);
    }
  });

  it("lets a paid tier opt back in", () => {
    expect(resolveFuntushBadge("LARGE", true)).toBe(true);
  });

  it("respects a stored false rather than treating it as unset", () => {
    // `stored ?? false` keeps a real `false`; `stored || false` would too, but
    // `stored ? true : ...` shapes have bitten this codebase before.
    expect(resolveFuntushBadge("MEDIUM", false)).toBe(false);
  });
});

describe("canToggleFuntushBadge", () => {
  it("is the inverse of the trial check", () => {
    expect(canToggleFuntushBadge("FREE")).toBe(false);
    for (const tier of ["SMALL", "MEDIUM", "LARGE"]) {
      expect(canToggleFuntushBadge(tier), tier).toBe(true);
    }
  });

  it("stays separate from resolveFuntushBadge", () => {
    // One answers "what renders?", the other "may this request write?".
    // A LARGE agency renders no badge but is allowed to change that; the two
    // answers differ, which is why they are two functions.
    expect(resolveFuntushBadge("LARGE")).toBe(false);
    expect(canToggleFuntushBadge("LARGE")).toBe(true);
  });
});

describe("isSafeLinkUrl", () => {
  it("accepts the two protocols a public link may use", () => {
    expect(isSafeLinkUrl("https://example.com")).toBe(true);
    expect(isSafeLinkUrl("http://example.com/path?a=1#b")).toBe(true);
  });

  it("rejects javascript: in every spelling a browser would still run", () => {
    for (const url of [
      "javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      "JaVaScRiPt:alert(1)",
      "java\tscript:alert(1)",
      "java\nscript:alert(1)",
    ]) {
      expect(isSafeLinkUrl(url), url).toBe(false);
    }
  });

  it("rejects other schemes that can execute or exfiltrate", () => {
    for (const url of [
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "ftp://example.com",
    ]) {
      expect(isSafeLinkUrl(url), url).toBe(false);
    }
  });

  it("rejects things that are not URLs at all", () => {
    expect(isSafeLinkUrl("")).toBe(false);
    expect(isSafeLinkUrl("/relative/path")).toBe(false);
    expect(isSafeLinkUrl("example.com")).toBe(false);
    expect(isSafeLinkUrl("just some words")).toBe(false);
  });

  it("never throws, whatever it is handed", () => {
    // It is called from inside a zod `.refine`. A throw there escapes as a 500
    // instead of the 400 the request deserves.
    expect(() => isSafeLinkUrl("http://[")).not.toThrow();
    expect(() => isSafeLinkUrl("%%%")).not.toThrow();
  });

  it("keeps the whitelist to exactly two protocols", () => {
    expect(ALLOWED_LINK_PROTOCOLS).toEqual(["http:", "https:"]);
  });
});

describe("defaults", () => {
  it("ships every switch in the quiet position", () => {
    // A platform that ships a feature switched on has decided on its customers'
    // behalf what their website says. One agency discovering an announcement bar
    // it never wrote is enough to make that a very bad day.
    expect(DEFAULT_SITE_CONFIG.underConstruction).toBe(false);
    expect(DEFAULT_SITE_CONFIG.topBarEnabled).toBe(false);
    expect(DEFAULT_SITE_CONFIG.popupEnabled).toBe(false);
    expect(DEFAULT_SITE_CONFIG.showFuntushBadge).toBe(false);
  });

  it("defaults an announcement bar to dismissible", () => {
    // A bar that cannot be closed follows a visitor through a twelve-page
    // booking flow.
    expect(DEFAULT_SITE_CONFIG.topBarDismissible).toBe(true);
  });

  it("defaults the popup to a delay rather than firing on load", () => {
    expect(DEFAULT_SITE_CONFIG.popupTrigger).toBe("AFTER_DELAY");
    expect(DEFAULT_SITE_CONFIG.popupDelaySeconds).toBeGreaterThan(0);
  });

  it("has default construction copy that does not guess at a reason", () => {
    // "Temporarily closed" or "under maintenance" is a guess that is sometimes
    // wrong and always the platform putting words in a customer's mouth.
    expect(DEFAULT_CONSTRUCTION_COPY.headline).toBeTruthy();
    expect(DEFAULT_CONSTRUCTION_COPY.message).toBeTruthy();
    expect(DEFAULT_CONSTRUCTION_COPY.message.toLowerCase()).not.toContain("closed");
  });

  it("keeps every default consistent with the Prisma column defaults", () => {
    // Two sources of truth for one default is how a fresh row and a missing row
    // resolve to different sites. Checked here in the one place both are visible
    // to a reader; the migration SQL is the other half.
    expect(DEFAULT_SITE_CONFIG.topBarBehavior).toBe("STATIC");
    expect(DEFAULT_SITE_CONFIG.popupFrequency).toBe("ONCE_PER_SESSION");
    expect(DEFAULT_SITE_CONFIG.popupDelaySeconds).toBe(5);
  });
});

describe("option tables", () => {
  it("keys every table by its own id", () => {
    // The `id` inside each entry is what gets stored; a mismatch between the key
    // and the id means the settings UI writes a value the enum column rejects.
    for (const [key, value] of Object.entries(TOP_BAR_BEHAVIORS)) expect(value.id).toBe(key);
    for (const [key, value] of Object.entries(POPUP_TRIGGERS)) expect(value.id).toBe(key);
    for (const [key, value] of Object.entries(POPUP_FREQUENCIES)) expect(value.id).toBe(key);
  });

  it("exposes the ids the validation schema builds its enums from", () => {
    expect(TOP_BAR_BEHAVIOR_IDS).toEqual(["STATIC", "SCROLLING"]);
    expect(POPUP_TRIGGER_IDS).toEqual(["ON_LOAD", "AFTER_DELAY", "ON_EXIT_INTENT"]);
    expect(POPUP_FREQUENCY_IDS).toEqual([
      "EVERY_VISIT",
      "ONCE_PER_SESSION",
      "ONCE_PER_DAY",
      "ONCE_EVER",
    ]);
  });

  it("gives every option a human label for the picker", () => {
    for (const table of [TOP_BAR_BEHAVIORS, POPUP_TRIGGERS, POPUP_FREQUENCIES]) {
      for (const option of Object.values(table)) {
        expect(option.label.length).toBeGreaterThan(0);
      }
    }
  });

  it("keeps only MEDIUM and LARGE in the popup tier list", () => {
    expect(POPUP_MODAL_TIERS).toEqual(["MEDIUM", "LARGE"]);
  });
});

describe("SITE_TEXT_LIMITS", () => {
  it("has a min below its max for every field", () => {
    for (const [field, limit] of Object.entries(SITE_TEXT_LIMITS)) {
      if ("min" in limit) {
        expect(limit.min, field).toBeLessThan(limit.max);
        expect(limit.min, field).toBeGreaterThan(0);
      }
    }
  });

  it("caps the announcement at one SMS", () => {
    expect(SITE_TEXT_LIMITS.topBarText.max).toBe(160);
  });
});
