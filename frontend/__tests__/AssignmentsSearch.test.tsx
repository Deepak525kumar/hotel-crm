import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "node:fs";

/**
 * Search on the web assignments list (owner decision, 2026-08-30).
 *
 * Asserted against the source rather than by rendering: the properties that
 * make this search correct are structural -- WHERE the filtering happens, and
 * that the page resets -- and both are invisible to a render test that only
 * sees the rows a mocked hook returned.
 */
const page = readFileSync("app/(protected)/assignments/page.tsx", "utf8");

describe("assignments search", () => {
  it("sends the term to the SERVER instead of filtering the loaded page", () => {
    // This list is paginated. Filtering the page the browser happens to hold
    // reports "no assignments" while the match sits on page 3 -- the failure
    // that decided this had to be a query parameter.
    expect(page).toMatch(/useAssignments\(\{[\s\S]*?q:\s*debounced/);
    // And no client-side filter crept in alongside it.
    expect(page).not.toMatch(/assignments\.filter\(/);
  });

  it("debounces, so typing is not one request per keystroke", () => {
    expect(page).toMatch(/setTimeout\([\s\S]*?setDebounced/);
    expect(page).toMatch(/clearTimeout/);
  });

  it("returns to page 1 when the term changes", () => {
    // Staying on page 4 of the previous result set shows an empty table for a
    // search that does have matches -- indistinguishable from "none found".
    const effect = page.slice(page.indexOf("setDebounced"), page.indexOf("}, [query])"));
    expect(effect).toContain("setPage(1)");
  });

  it("tells a fruitless search apart from an empty list", () => {
    // Three distinct facts: no match for the search, no match for the status
    // filter, and no assignments at all. Showing "assignments appear once
    // workers are placed" to someone mid-search reads as data loss.
    expect(page).toContain("assignments.searchNoMatch");
    expect(page).toContain("assignments.filterNoMatch");
    expect(page).toContain("assignments.noneYet");
  });

  it("leaves no untranslated user-facing string behind", () => {
    // These two were the only hardcoded English on the page.
    expect(page).not.toContain("Try adjusting your filters.");
    expect(page).not.toContain("Assignments appear once workers are placed");
  });
});
