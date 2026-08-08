import { describe, it, expect } from "vitest";
import {
  POPUP_FIELDS,
  siteConfigUpdateSchema,
  type SiteConfigUpdateInput,
} from "./siteConfig.validation";
import { MAX_POPUP_DELAY_SECONDS, SITE_TEXT_LIMITS } from "../data/siteConfig";

/**
 * Tests for the site-config request schema (White-label week · Day 2).
 *
 * Pure zod — no database, no Express. The value of a suite like this is that it
 * pins the *boundary*: exactly which requests get a 400 before a single query
 * runs, and — just as importantly — which requests must be allowed through
 * because their legality depends on the stored row and is therefore the
 * service's job.
 */

/** Parse and return the error messages, or `[]` on success. */
function errorsFor(body: unknown): string[] {
  const result = siteConfigUpdateSchema.safeParse(body);
  if (result.success) return [];
  return result.error.issues.map((issue) => issue.message);
}

function parse(body: unknown): SiteConfigUpdateInput {
  return siteConfigUpdateSchema.parse(body);
}

describe("siteConfigUpdateSchema — shape", () => {
  it("accepts an empty object (the service decides what an empty patch means)", () => {
    // Deliberate division of labour: zod says "well-formed", the service says
    // "PATCH {} is a client bug". Rejecting it here would give a message about
    // shape for a problem that is about intent.
    expect(siteConfigUpdateSchema.safeParse({}).success).toBe(true);
  });

  it("rejects unknown keys instead of silently dropping them", () => {
    // Without `.strict()` this returns 200 and changes nothing — the worst
    // failure mode on a screen whose switches take a website offline.
    const result = siteConfigUpdateSchema.safeParse({ topBarEnable: true });
    expect(result.success).toBe(false);
  });

  it("rejects a near-miss on one of the long similar field names", () => {
    // The reason `.strict()` matters twice as much here as it did on Day 1:
    // nineteen fields, several within one character of each other.
    expect(siteConfigUpdateSchema.safeParse({ popupDelaySecond: 5 }).success).toBe(false);
    expect(siteConfigUpdateSchema.safeParse({ topBarDismissable: true }).success).toBe(false);
  });

  it("rejects an attempt to name another agency in the body", () => {
    // Multi-tenancy, enforced at the cheapest possible layer. `.strict()` gets
    // this for free, which is a large part of why it is worth having.
    expect(siteConfigUpdateSchema.safeParse({ agencyId: "someone-else" }).success).toBe(false);
  });

  it("rejects a string where a boolean belongs", () => {
    // `"false"` is truthy in JavaScript. A schema that coerced it would turn a
    // form bug into a published website.
    expect(siteConfigUpdateSchema.safeParse({ underConstruction: "false" }).success).toBe(false);
  });
});

describe("siteConfigUpdateSchema — text fields", () => {
  it("trims before measuring length", () => {
    expect(parse({ topBarText: "  15% off  " }).topBarText).toBe("15% off");
  });

  it("treats an all-whitespace string as empty, not as content", () => {
    expect(errorsFor({ topBarText: "   " }).length).toBeGreaterThan(0);
  });

  it("allows apostrophes and ampersands in an announcement", () => {
    // The deliberate asymmetry with Day 1's currency-symbol rule. "Don't miss
    // Bed & Breakfast deals" is normal English; rejecting it produces a form
    // agencies work around by writing worse copy.
    const parsed = parse({ topBarText: "Don't miss our Bed & Breakfast \"special\"" });
    expect(parsed.topBarText).toContain("Don't");
    expect(parsed.topBarText).toContain("&");
  });

  it("rejects angle brackets in every rendered text field", () => {
    // No sentence about a trek needs one, and they are the character that turns
    // text into markup. Defence in depth — the renderer must still escape.
    for (const field of [
      "topBarText",
      "constructionHeadline",
      "constructionMessage",
      "popupTitle",
      "popupBody",
      "popupCtaLabel",
    ]) {
      const result = siteConfigUpdateSchema.safeParse({
        [field]: "<script>alert(1)</script>",
      });
      expect(result.success, `${field} should reject angle brackets`).toBe(false);
    }
  });

  it("caps the announcement at one SMS worth of characters", () => {
    const max = SITE_TEXT_LIMITS.topBarText.max;
    expect(errorsFor({ topBarText: "a".repeat(max) })).toEqual([]);
    expect(errorsFor({ topBarText: "a".repeat(max + 1) }).length).toBeGreaterThan(0);
  });

  it("accepts null on every clearable text field", () => {
    // `null` is how an agency removes something. Without it there is no way to
    // express "delete my announcement" and people type a space instead.
    const parsed = parse({
      topBarText: null,
      topBarLinkUrl: null,
      constructionHeadline: null,
      constructionMessage: null,
      popupTitle: null,
      popupBody: null,
      popupCtaLabel: null,
      popupCtaUrl: null,
      topBarBackgroundColor: null,
    });

    expect(parsed.topBarText).toBeNull();
    expect(parsed.popupCtaUrl).toBeNull();
  });
});

describe("siteConfigUpdateSchema — link safety", () => {
  it("accepts http and https URLs", () => {
    expect(errorsFor({ topBarLinkUrl: "https://example.com/autumn" })).toEqual([]);
    expect(errorsFor({ popupCtaUrl: "http://example.com" })).toEqual([]);
  });

  it("rejects javascript: URLs — the attack this whole rule exists for", () => {
    // `href="javascript:..."` is working XSS that needs no <script> tag and
    // survives every HTML-escaping function ever written, because escaping
    // protects an attribute's text, not its meaning.
    expect(errorsFor({ popupCtaUrl: "javascript:alert(1)" }).length).toBeGreaterThan(0);
    expect(errorsFor({ topBarLinkUrl: "javascript:alert(1)" }).length).toBeGreaterThan(0);
  });

  it("rejects the casing and whitespace variants a regex would miss", () => {
    // Browsers happily run `JaVaScRiPt:` and `java\tscript:`. Parsing with the
    // platform `URL` class instead of a hand-written regex closes both.
    for (const url of ["JaVaScRiPt:alert(1)", "java\tscript:alert(1)", " javascript:alert(1)"]) {
      expect(errorsFor({ popupCtaUrl: url }).length, url).toBeGreaterThan(0);
    }
  });

  it("rejects data: URLs", () => {
    // `data:text/html,<script>…` is the same attack wearing a different hat.
    expect(
      errorsFor({ popupCtaUrl: "data:text/html,<script>alert(1)</script>" }).length,
    ).toBeGreaterThan(0);
  });

  it("rejects a relative path", () => {
    // Not an attack, but a mistake worth catching: a relative URL on a
    // white-label site resolves against whichever domain rendered it, which is
    // not always the one the agency was thinking of.
    expect(errorsFor({ topBarLinkUrl: "/packages/everest" }).length).toBeGreaterThan(0);
  });

  it("rejects a sentence typed into the URL box", () => {
    expect(errorsFor({ topBarLinkUrl: "our website" }).length).toBeGreaterThan(0);
  });
});

describe("siteConfigUpdateSchema — colour and numbers", () => {
  it("normalises the top bar colour to uppercase", () => {
    // Same normalisation Day 1 does on `primaryColor`, so the swatch lookup in
    // the tier check is a plain string compare.
    expect(parse({ topBarBackgroundColor: "#0f766e" }).topBarBackgroundColor).toBe("#0F766E");
  });

  it("rejects three-digit hex shorthand", () => {
    expect(errorsFor({ topBarBackgroundColor: "#0F7" }).length).toBeGreaterThan(0);
  });

  it("rejects a colour name", () => {
    expect(errorsFor({ topBarBackgroundColor: "red" }).length).toBeGreaterThan(0);
  });

  it("requires a whole number of delay seconds", () => {
    // Without `.int()` a 2.5 reaches Prisma, which rejects a float for an
    // INTEGER column with an error mentioning neither "delay" nor "seconds".
    expect(errorsFor({ popupDelaySeconds: 2.5 }).length).toBeGreaterThan(0);
  });

  it("accepts zero and the ceiling, rejects beyond them", () => {
    expect(errorsFor({ popupDelaySeconds: 0 })).toEqual([]);
    expect(errorsFor({ popupDelaySeconds: MAX_POPUP_DELAY_SECONDS })).toEqual([]);
    expect(errorsFor({ popupDelaySeconds: MAX_POPUP_DELAY_SECONDS + 1 }).length).toBeGreaterThan(0);
    expect(errorsFor({ popupDelaySeconds: -1 }).length).toBeGreaterThan(0);
  });
});

describe("siteConfigUpdateSchema — enums", () => {
  it("accepts the documented enum values", () => {
    expect(errorsFor({ topBarBehavior: "SCROLLING" })).toEqual([]);
    expect(errorsFor({ popupTrigger: "ON_EXIT_INTENT" })).toEqual([]);
    expect(errorsFor({ popupFrequency: "ONCE_EVER" })).toEqual([]);
  });

  it("rejects lowercase enum values rather than coercing them", () => {
    // These are stored straight into Postgres enum columns. Accepting
    // `"scrolling"` here would push the failure down to a Prisma error.
    expect(errorsFor({ topBarBehavior: "scrolling" }).length).toBeGreaterThan(0);
  });

  it("rejects an enum value that does not exist", () => {
    expect(errorsFor({ popupTrigger: "ON_SCROLL" }).length).toBeGreaterThan(0);
  });
});

describe("what the schema deliberately does NOT check", () => {
  it("allows enabling the top bar with no text in the request", () => {
    // Legality depends on the stored row: the text may have been saved last
    // week. Rejecting here would break a legitimate PATCH. The service checks
    // this against the merged state.
    expect(errorsFor({ topBarEnabled: true })).toEqual([]);
  });

  it("allows enabling the popup with no title in the request", () => {
    expect(errorsFor({ popupEnabled: true })).toEqual([]);
  });

  it("allows a popup label with no URL", () => {
    // Also a merged-state question — the URL may already be stored.
    expect(errorsFor({ popupCtaLabel: "Book now" })).toEqual([]);
  });

  it("allows a Small-tier-illegal popup field, because it does not know the tier", () => {
    // Tier needs a database read. Answering 400 here would also be the wrong
    // status: it is a permission problem, not a shape problem.
    expect(errorsFor({ popupEnabled: true })).toEqual([]);
  });
});

describe("POPUP_FIELDS", () => {
  it("lists every popup key the schema accepts", () => {
    // Derived in one place because the service asks "did this touch the popup?"
    // to apply the Medium+ rule. A field missing from this list is an ungated
    // field, and nothing else would fail.
    const schemaPopupKeys = Object.keys(siteConfigUpdateSchema.shape)
      .filter((key) => key.startsWith("popup"))
      .sort();

    expect([...POPUP_FIELDS].sort()).toEqual(schemaPopupKeys);
  });
});
