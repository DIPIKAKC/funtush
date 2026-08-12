import { describe, it, expect, beforeEach, afterEach } from "vitest";

/**
 * Unit tests for the static-page dependency map (White-label week · Day 4).
 *
 * Pure functions only — no database, no network, no mocks. That is the point of
 * the file being in `data/`: the question "what did this save invalidate?" is
 * answerable with a calculator, and answering it here means the service layer
 * never has to be tested against a real CDN to prove it purges the right things.
 *
 * The suite is organised around the ways this can be wrong in production:
 *
 *   1. **Tags** — the multi-tenancy rule (a tag without a slug purges the whole
 *      platform) and the byte-stability the response header depends on.
 *   2. **Hosts** — a mapped custom domain is a second live cache, and the stored
 *      value is free text an agency typed.
 *   3. **Targets** — the API-vs-page split that encodes the pipeline order.
 */

import {
  REGENERATION_SCOPES,
  SITE_PAGES,
  affectedPagePaths,
  apiPathForScope,
  buildRegenerationTargets,
  cacheTagHeaderValue,
  isRegenerationScope,
  normalizeCustomDomain,
  scopeTag,
  siteOrigins,
  tagsForScopes,
} from "./staticPages";

const SLUG = "himalayan-trails";

/**
 * The URL builders read `process.env` on every call (deliberately — see the
 * comment on `siteBaseDomain`), so the suite pins both variables and restores
 * whatever the developer's shell had. Leaking an env var out of a test file is
 * how an unrelated suite starts failing only when run second.
 */
const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.SITE_BASE_DOMAIN = "funtush.io";
  process.env.API_PUBLIC_URL = "https://api.funtush.com";
});

afterEach(() => {
  process.env = { ...originalEnv };
});

/* ── 1. Tags ─────────────────────────────────────────────────────────────── */

describe("scopeTag", () => {
  it("puts the slug in every tag", () => {
    // The multi-tenancy rule of this file (Backend Guide §4). A tag of just
    // "branding" would be shared by every agency, so one save would purge the
    // whole platform's caches.
    expect(scopeTag("branding", SLUG)).toBe("branding:himalayan-trails");
    expect(scopeTag("siteConfig", SLUG)).toBe("config:himalayan-trails");
    expect(scopeTag("navigation", SLUG)).toBe("nav:himalayan-trails");
  });

  it("gives two agencies disjoint tags", () => {
    const mine = tagsForScopes("agency-a", REGENERATION_SCOPES);
    const theirs = tagsForScopes("agency-b", REGENERATION_SCOPES);

    expect(mine.some((tag) => theirs.includes(tag))).toBe(false);
  });
});

describe("tagsForScopes", () => {
  it("de-duplicates a repeated scope", () => {
    expect(tagsForScopes(SLUG, ["branding", "branding"])).toEqual([
      "branding:himalayan-trails",
    ]);
  });

  it("is order-independent", () => {
    // Two saves that touch the same things must produce byte-identical tag
    // lists, or the response header changes for no reason and every comparison
    // downstream (tests, purge de-duplication, log grepping) becomes unstable.
    expect(tagsForScopes(SLUG, ["navigation", "branding"])).toEqual(
      tagsForScopes(SLUG, ["branding", "navigation"]),
    );
  });

  it("returns nothing for no scopes", () => {
    expect(tagsForScopes(SLUG, [])).toEqual([]);
  });
});

describe("cacheTagHeaderValue", () => {
  it("formats the header a CDN accepts", () => {
    expect(cacheTagHeaderValue(SLUG, ["branding", "navigation"])).toBe(
      "branding:himalayan-trails, nav:himalayan-trails",
    );
  });
});

describe("isRegenerationScope", () => {
  it("accepts the three real scopes and nothing else", () => {
    for (const scope of REGENERATION_SCOPES) expect(isRegenerationScope(scope)).toBe(true);
    expect(isRegenerationScope("branding ")).toBe(false);
    expect(isRegenerationScope("packages")).toBe(false);
    expect(isRegenerationScope("")).toBe(false);
  });
});

/* ── 2. The page table ───────────────────────────────────────────────────── */

describe("SITE_PAGES", () => {
  it("has no duplicate paths", () => {
    // A duplicated row would purge the same URL twice per save — harmless, but
    // it is also the shape a bad merge takes, and it is free to catch here.
    const paths = SITE_PAGES.map((page) => page.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("uses site-relative paths, never absolute URLs", () => {
    for (const page of SITE_PAGES) {
      expect(page.path.startsWith("/")).toBe(true);
      expect(page.path.startsWith("//")).toBe(false);
    }
  });
});

describe("affectedPagePaths", () => {
  it("returns every page for a layout-level scope", () => {
    // Branding is the theme and the theme is in the layout, so today this is
    // "everything". The assertion is written against the table rather than a
    // hard-coded six, so adding a page does not fail this test spuriously.
    expect(affectedPagePaths(["branding"])).toEqual(SITE_PAGES.map((page) => page.path));
  });

  it("returns nothing for no scopes", () => {
    // "Nothing changed" must never quietly mean "purge the world".
    expect(affectedPagePaths([])).toEqual([]);
  });
});

describe("apiPathForScope", () => {
  it("names the Day 1, 2 and 3 public reads", () => {
    expect(apiPathForScope("branding", SLUG)).toBe("/site/himalayan-trails/branding");
    expect(apiPathForScope("siteConfig", SLUG)).toBe("/site/himalayan-trails/config");
    expect(apiPathForScope("navigation", SLUG)).toBe("/site/himalayan-trails/navigation");
  });
});

/* ── 3. Hosts ────────────────────────────────────────────────────────────── */

describe("normalizeCustomDomain", () => {
  it("strips the protocol, the trailing slash, the case and the whitespace", () => {
    expect(normalizeCustomDomain("  HTTPS://WWW.Everest-Treks.com/ ")).toBe(
      "www.everest-treks.com",
    );
    expect(normalizeCustomDomain("http://everest.com")).toBe("everest.com");
  });

  it("rejects anything that is not a bare hostname", () => {
    // A whitelist, matching Day 3's `isSafeInternalPath`. Everything here is a
    // value that would otherwise be concatenated into a URL we then POST to a
    // purge API.
    for (const bad of [
      "",
      "   ",
      "localhost",
      "everest.com/packages",
      "everest.com?x=1",
      "user@everest.com",
      "ever est.com",
      "everest.com:8080",
    ]) {
      expect(normalizeCustomDomain(bad)).toBeNull();
    }
  });

  it("treats null and undefined as no domain", () => {
    expect(normalizeCustomDomain(null)).toBeNull();
    expect(normalizeCustomDomain(undefined)).toBeNull();
  });
});

describe("siteOrigins", () => {
  it("returns the subdomain when there is no mapped domain", () => {
    expect(siteOrigins({ slug: SLUG })).toEqual(["https://himalayan-trails.funtush.io"]);
  });

  it("returns BOTH origins when a domain is mapped", () => {
    // The bug this prevents: purging only the pretty URL leaves the
    // *.funtush.io copy stale — and that is the URL the agency's own staff have
    // bookmarked, so they are the ones who see the old logo and file the ticket.
    expect(siteOrigins({ slug: SLUG, customDomain: "www.everest-treks.com" })).toEqual([
      "https://himalayan-trails.funtush.io",
      "https://www.everest-treks.com",
    ]);
  });

  it("ignores an unusable stored domain instead of building a broken URL", () => {
    expect(siteOrigins({ slug: SLUG, customDomain: "not a domain" })).toEqual([
      "https://himalayan-trails.funtush.io",
    ]);
  });

  it("follows SITE_BASE_DOMAIN at call time, not at import time", () => {
    // Reading the variable lazily is what stops a staging deploy from purging
    // production URLs because a module constant was frozen at import.
    process.env.SITE_BASE_DOMAIN = "funtush.test";
    expect(siteOrigins({ slug: SLUG })).toEqual(["https://himalayan-trails.funtush.test"]);
  });
});

/* ── 4. Targets — the pipeline order, expressed as data ──────────────────── */

describe("buildRegenerationTargets", () => {
  it("splits API reads from page HTML", () => {
    const targets = buildRegenerationTargets({ slug: SLUG }, ["branding"]);

    // Step 1 of the pipeline purges these: the JSON the renderer is about to
    // read. One URL, because only branding changed.
    expect(targets.apiUrls).toEqual([
      "https://api.funtush.com/site/himalayan-trails/branding",
    ]);

    // Step 3 purges these: the rendered pages, one per site page.
    expect(targets.pageUrls).toHaveLength(SITE_PAGES.length);
    expect(targets.pageUrls).toContain("https://himalayan-trails.funtush.io/");
    expect(targets.pageUrls).toContain("https://himalayan-trails.funtush.io/packages");

    expect(targets.tags).toEqual(["branding:himalayan-trails"]);
  });

  it("covers both origins when a domain is mapped", () => {
    const targets = buildRegenerationTargets(
      { slug: SLUG, customDomain: "everest-treks.com" },
      ["branding"],
    );

    expect(targets.pageUrls).toHaveLength(SITE_PAGES.length * 2);
    expect(targets.pageUrls).toContain("https://everest-treks.com/");
    expect(targets.pageUrls).toContain("https://himalayan-trails.funtush.io/");
  });

  it("lists one API URL per scope, de-duplicated", () => {
    const targets = buildRegenerationTargets({ slug: SLUG }, [
      "branding",
      "navigation",
      "branding",
    ]);

    expect(targets.apiUrls).toEqual([
      "https://api.funtush.com/site/himalayan-trails/branding",
      "https://api.funtush.com/site/himalayan-trails/navigation",
    ]);
    expect(targets.tags).toEqual(["branding:himalayan-trails", "nav:himalayan-trails"]);
  });

  it("returns nothing at all for no scopes", () => {
    expect(buildRegenerationTargets({ slug: SLUG }, [])).toEqual({
      tags: [],
      apiUrls: [],
      pageUrls: [],
      paths: [],
    });
  });

  it("never builds a URL with a doubled slash", () => {
    // `API_PUBLIC_URL` written with a trailing slash is the classic way a purge
    // request ends up naming `//site/...`, which the CDN treats as a different
    // (and never-requested) URL — so the purge silently clears nothing.
    process.env.API_PUBLIC_URL = "https://api.funtush.com/";

    const targets = buildRegenerationTargets({ slug: SLUG }, REGENERATION_SCOPES);

    for (const url of [...targets.apiUrls, ...targets.pageUrls]) {
      expect(url.slice("https://".length)).not.toContain("//");
    }
  });
});
