import { describe, it, expect } from "vitest";
import {
  parsePagination,
  buildMeta,
  paginate,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from "./pagination";

describe("parsePagination", () => {
  it("falls back to page 1 and the default page size", () => {
    expect(parsePagination({})).toEqual({
      page: 1,
      limit: DEFAULT_PAGE_SIZE,
      skip: 0,
      take: DEFAULT_PAGE_SIZE,
    });
  });

  it("handles a missing query object", () => {
    expect(parsePagination(undefined).page).toBe(1);
  });

  it("parses numeric strings from the query string", () => {
    expect(parsePagination({ page: "3", limit: "5" })).toEqual({
      page: 3,
      limit: 5,
      skip: 10,
      take: 5,
    });
  });

  it("clamps limit to the maximum page size", () => {
    expect(parsePagination({ limit: "9999" }).limit).toBe(MAX_PAGE_SIZE);
    expect(parsePagination({ limit: "9999" }, { maxLimit: 30 }).limit).toBe(30);
  });

  it("ignores garbage, zero and negative values", () => {
    expect(parsePagination({ page: "abc", limit: "-4" }).page).toBe(1);
    expect(parsePagination({ page: "abc", limit: "-4" }).limit).toBe(DEFAULT_PAGE_SIZE);
    expect(parsePagination({ page: "0" }).page).toBe(1);
  });

  it("floors fractional values", () => {
    expect(parsePagination({ page: "2.9" }).page).toBe(2);
  });

  it("uses the first value when a param is repeated", () => {
    expect(parsePagination({ page: ["4", "9"] }).page).toBe(4);
  });

  it("honours a custom default limit", () => {
    expect(parsePagination({}, { defaultLimit: 3 }).limit).toBe(3);
  });
});

describe("buildMeta", () => {
  it("computes the page count by rounding up", () => {
    expect(buildMeta(25, 1, 10)).toEqual({ total: 25, page: 1, limit: 10, pages: 3 });
  });

  it("reports zero pages for an empty result set", () => {
    expect(buildMeta(0, 1, 10).pages).toBe(0);
  });
});

describe("paginate", () => {
  it("wraps rows in the standard { data, meta } envelope", () => {
    const request = parsePagination({ page: "2", limit: "2" });
    expect(paginate(["c", "d"], 5, request)).toEqual({
      data: ["c", "d"],
      meta: { total: 5, page: 2, limit: 2, pages: 3 },
    });
  });
});
