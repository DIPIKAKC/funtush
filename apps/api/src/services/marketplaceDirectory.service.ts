import { db } from "@funtush/database";

/**
 * ── Marketplace directory service (Week 3 · Day 3) ───────────────────────────
 *
 * Powers the PUBLIC, browse-by-hand surfaces of the central marketplace:
 *
 *   GET /marketplace/agencies            → agency directory (list)
 *   GET /marketplace/agencies/:slug      → one agency's public profile
 *   GET /marketplace/destinations        → destination directory (list)
 *   GET /marketplace/destinations/:slug  → one master destination page
 *
 * Why Postgres and not Meilisearch?
 * ─────────────────────────────────
 * Day 1/Day 2 routed *search* (a typed query + relevance ranking) through
 * Meilisearch — that's the right tool for fuzzy text matching. These Day 3
 * endpoints are *directory* pages: deterministic listings, aggregations
 * (rating averages, package counts) and joins across relational tables. That is
 * exactly what Postgres is good at, so we query Prisma directly. The Backend
 * Guide rule "search goes through Meilisearch" is about the search box, not
 * these browse pages.
 *
 * Marketplace visibility rule (Backend Guide §6 & §14)
 * ────────────────────────────────────────────────────
 * Only ACTIVE, non-FREE agencies are listed. Trial and Locked agencies are
 * explicitly "not listed" on the marketplace, and the FREE tier has
 * `features.marketplace = false`. Every query in this file therefore filters
 * through `LISTABLE_AGENCY` so we never leak a non-public agency.
 */

/**
 * Prisma `where` fragment for "an agency that may appear on the marketplace".
 * Reused by every query here so the visibility rule lives in exactly one place.
 */
const LISTABLE_AGENCY = {
  status: "ACTIVE" as const,
  tier: { name: { not: "FREE" } },
};

/**
 * Turn a human destination name into a URL-safe slug.
 * "Everest Base Camp" → "everest-base-camp". Mirrors the package slug logic in
 * package.service.ts so the whole platform slugifies the same way.
 */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "") // drop punctuation
    .replace(/\s+/g, "-"); // spaces → hyphens
}

/** Round a rating average to one decimal, or null when there are no reviews yet. */
function roundRating(avg: number | null | undefined): number | null {
  return typeof avg === "number" ? Math.round(avg * 10) / 10 : null;
}

/* ── 1. Agency directory ─────────────────────────────────────────────────── */

export interface AgencyListItem {
  id: string;
  name: string;
  slug: string;
  tier: string;
  logo: string | null;
  description: string | null;
  rating: { average: number | null; count: number };
  topDestinations: string[];
}

/**
 * List every marketplace-listable agency with its tier, review rating and a few
 * "top destination" tags (the destinations it runs the most packages in).
 */
export async function listAgencies(): Promise<AgencyListItem[]> {
  const agencies = await db.agency.findMany({
    where: LISTABLE_AGENCY,
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      tier: { select: { name: true } },
      profile: { select: { logo: true, description: true } },
      destinations: {
        // each destination + how many packages reference it (ranking signal)
        select: { name: true, _count: { select: { packages: true } } },
      },
    },
  });

  // One grouped query gets the rating average + count for every agency at once,
  // instead of N per-agency queries.
  const ratings = await db.review.groupBy({
    by: ["agencyId"],
    _avg: { rating: true },
    _count: { rating: true },
  });
  const ratingByAgency = new Map(ratings.map((r) => [r.agencyId, r]));

  return agencies.map((a) => {
    const r = ratingByAgency.get(a.id);
    const topDestinations = [...a.destinations]
      .sort((x, y) => y._count.packages - x._count.packages) // busiest destinations first
      .slice(0, 5)
      .map((d) => d.name);

    return {
      id: a.id,
      name: a.name,
      slug: a.slug,
      tier: a.tier.name,
      logo: a.profile?.logo ?? null,
      description: a.profile?.description ?? null,
      rating: { average: roundRating(r?._avg.rating), count: r?._count.rating ?? 0 },
      topDestinations,
    };
  });
}

/* ── 2. Agency public profile ────────────────────────────────────────────── */

/**
 * Full public profile for one agency, addressed by its slug. Bundles the
 * published packages, recent reviews and computed badges that the public agency
 * page renders. Returns null if the slug doesn't resolve to a listable agency
 * (so the controller can answer 404).
 */
export async function getAgencyProfile(slug: string) {
  const agency = await db.agency.findFirst({
    where: { slug, ...LISTABLE_AGENCY },
    select: {
      id: true,
      name: true,
      slug: true,
      createdAt: true,
      tier: { select: { name: true } },
      kyc: { select: { status: true } },
      profile: {
        select: {
          logo: true,
          description: true,
          address: true,
          phone: true,
          email: true,
          regions: true,
          logoShowOnWebsite: true,
          descriptionShowOnWebsite: true,
          phoneShowOnWebsite: true,
          emailShowOnWebsite: true,
          regionsShowOnWebsite: true,
          addressShowOnWebsite: true,
        },
      },
      packages: {
        where: { status: "PUBLISHED" },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          slug: true,
          description: true,
          durationDays: true,
          pricePerPerson: true,
          difficulty: true,
          destinations: { select: { name: true } },
        },
      },
      // Only show genuine, non-removed reviews on the public profile. Reviews are
      // verified-by-default (gated on Completed bookings); a REMOVED flag hides one.
      reviews: {
        where: { verified: true, flags: { none: { status: "REMOVED" } } },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          rating: true,
          text: true,
          photos: true,
          createdAt: true,
          trekker: { select: { fullName: true } },
          response: { select: { responseText: true, respondedAt: true } },
        },
      },
    },
  });

  if (!agency) return null;

  // Rating summary over ALL public reviews (not just the 20 we return), so the
  // headline number is accurate even when the list is truncated.
  const ratingAgg = await db.review.aggregate({
    where: { agencyId: agency.id, verified: true, flags: { none: { status: "REMOVED" } } },
    _avg: { rating: true },
    _count: { rating: true },
  });

  const averageRating = roundRating(ratingAgg._avg.rating);
  const reviewCount = ratingAgg._count.rating;

  // Badges — derived purely from data we already hold.
  const badges: string[] = [];
  if (agency.kyc?.status === "APPROVED") badges.push("Verified");
  if (averageRating !== null && averageRating >= 4.5 && reviewCount >= 5) badges.push("Top Rated");
  // NOTE: the "Sponsored"/"Featured" badge (Correction #2) is applied when an
  // agency's priority_override exceeds its tier baseline. That field doesn't
  // exist in the schema yet, so it's intentionally omitted here.

  const p = agency.profile;
  return {
    id: agency.id,
    name: agency.name,
    slug: agency.slug,
    tier: agency.tier.name,
    memberSince: agency.createdAt,
    badges,
    // Honour the per-field "show on website" toggles the agency configured.
    profile: p
      ? {
          logo: p.logoShowOnWebsite ? p.logo : null,
          description: p.descriptionShowOnWebsite ? p.description : null,
          address: p.addressShowOnWebsite ? p.address : null,
          phone: p.phoneShowOnWebsite ? p.phone : null,
          email: p.emailShowOnWebsite ? p.email : null,
          regions: p.regionsShowOnWebsite ? p.regions : null,
        }
      : null,
    rating: { average: averageRating, count: reviewCount },
    packages: agency.packages.map((pkg) => ({
      id: pkg.id,
      title: pkg.title,
      slug: pkg.slug,
      description: pkg.description,
      durationDays: pkg.durationDays,
      pricePerPerson: Number(pkg.pricePerPerson),
      difficulty: pkg.difficulty,
      destinations: pkg.destinations.map((d) => d.name),
    })),
    reviews: agency.reviews.map((rev) => ({
      id: rev.id,
      rating: rev.rating,
      text: rev.text,
      photos: rev.photos,
      createdAt: rev.createdAt,
      trekkerName: rev.trekker?.fullName ?? "Anonymous",
      response: rev.response
        ? { text: rev.response.responseText, respondedAt: rev.response.respondedAt }
        : null,
    })),
  };
}

/* ── 3. Destination directory ────────────────────────────────────────────── */

/**
 * Destinations in this codebase are stored per-agency (each agency creates its
 * own `TrekDestination` rows). The marketplace, however, presents ONE master
 * page per destination that aggregates every agency operating there — and the
 * Day 3 spec notes these master pages are conceptually owned by the Super Admin
 * team, not individual agencies.
 *
 * Until a dedicated master-destination table exists, we synthesize those master
 * pages by grouping the per-agency rows by their slugified name. So three
 * agencies that each have an "Everest Base Camp" destination collapse into a
 * single master destination with slug `everest-base-camp`.
 */
export interface DestinationListItem {
  slug: string;
  name: string;
  region: string | null;
  altitudeM: number | null;
  bestSeason: string | null;
  packageCount: number;
  agencyCount: number;
}

export async function listDestinations(): Promise<DestinationListItem[]> {
  const rows = await db.trekDestination.findMany({
    where: { agency: LISTABLE_AGENCY },
    select: {
      name: true,
      region: true,
      altitudeM: true,
      bestSeason: true,
      agencyId: true,
      // only published packages count toward the public package tally
      packages: { where: { status: "PUBLISHED" }, select: { id: true } },
    },
  });

  // Fold the per-agency rows into master destinations keyed by slug.
  const masters = new Map<
    string,
    {
      name: string;
      region: string | null;
      altitudeM: number | null;
      bestSeason: string | null;
      agencyIds: Set<string>;
      packageIds: Set<string>;
    }
  >();

  for (const row of rows) {
    const slug = slugify(row.name);
    if (!slug) continue; // skip un-sluggable names (e.g. all punctuation)

    let master = masters.get(slug);
    if (!master) {
      master = {
        name: row.name,
        region: row.region,
        altitudeM: row.altitudeM,
        bestSeason: row.bestSeason,
        agencyIds: new Set(),
        packageIds: new Set(),
      };
      masters.set(slug, master);
    }
    // backfill any descriptive field the first row left null
    master.region ??= row.region;
    master.altitudeM ??= row.altitudeM;
    master.bestSeason ??= row.bestSeason;
    master.agencyIds.add(row.agencyId);
    for (const pkg of row.packages) master.packageIds.add(pkg.id);
  }

  return [...masters.entries()]
    .map(([slug, m]) => ({
      slug,
      name: m.name,
      region: m.region,
      altitudeM: m.altitudeM,
      bestSeason: m.bestSeason,
      packageCount: m.packageIds.size,
      agencyCount: m.agencyIds.size,
    }))
    .sort((a, b) => b.packageCount - a.packageCount || a.name.localeCompare(b.name));
}

/* ── 4. Master destination page ──────────────────────────────────────────── */

/**
 * One master destination page: the destination's stats plus every listable
 * agency operating there, each with the published packages it runs in that
 * destination. Returns null if no listable agency has a destination with this
 * slug (controller answers 404).
 */
export async function getDestinationBySlug(slug: string) {
  // We can't filter by slug in SQL (the slug isn't stored), so fetch the
  // destination rows for listable agencies and match the slug in app code.
  const rows = await db.trekDestination.findMany({
    where: { agency: LISTABLE_AGENCY },
    select: {
      name: true,
      region: true,
      altitudeM: true,
      bestSeason: true,
      agency: {
        select: {
          id: true,
          name: true,
          slug: true,
          tier: { select: { name: true } },
        },
      },
      packages: {
        where: { status: "PUBLISHED" },
        select: {
          id: true,
          title: true,
          slug: true,
          durationDays: true,
          pricePerPerson: true,
          difficulty: true,
          agencyId: true,
        },
      },
    },
  });

  const matching = rows.filter((row) => slugify(row.name) === slug);
  if (matching.length === 0) return null;

  // Canonical destination facts: take the first non-null we encounter.
  let name = matching[0].name;
  let region: string | null = null;
  let altitudeM: number | null = null;
  let bestSeason: string | null = null;

  // Group the published packages by the agency that runs them.
  const agencyMap = new Map<
    string,
    {
      id: string;
      name: string;
      slug: string;
      tier: string;
      packages: {
        id: string;
        title: string;
        slug: string;
        durationDays: number;
        pricePerPerson: number;
        difficulty: string;
      }[];
    }
  >();

  for (const row of matching) {
    name = row.name || name;
    region ??= row.region;
    altitudeM ??= row.altitudeM;
    bestSeason ??= row.bestSeason;

    const a = row.agency;
    let entry = agencyMap.get(a.id);
    if (!entry) {
      entry = { id: a.id, name: a.name, slug: a.slug, tier: a.tier.name, packages: [] };
      agencyMap.set(a.id, entry);
    }
    for (const pkg of row.packages) {
      entry.packages.push({
        id: pkg.id,
        title: pkg.title,
        slug: pkg.slug,
        durationDays: pkg.durationDays,
        pricePerPerson: Number(pkg.pricePerPerson),
        difficulty: pkg.difficulty,
      });
    }
  }

  // Drop agencies that, after filtering to published packages, run nothing here.
  const agencies = [...agencyMap.values()].filter((a) => a.packages.length > 0);
  const packageCount = agencies.reduce((sum, a) => sum + a.packages.length, 0);

  return {
    slug,
    name,
    region,
    altitudeM,
    bestSeason,
    agencyCount: agencies.length,
    packageCount,
    agencies,
  };
}
