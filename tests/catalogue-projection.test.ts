import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCatalogueQuery,
  buildCatalogueCountQuery,
  type CatalogueFilterParams,
} from "../src/nexus/catalogue.ts";

test("buildCatalogueQuery generates default unbounded query with bounded pagination", () => {
  const { text, values } = buildCatalogueQuery();
  assert.match(text, /SELECT \*\s+FROM integration\.v_aire_catalogue/);
  assert.match(text, /ORDER BY entity_name ASC NULLS LAST/);
  assert.match(text, /LIMIT 50 OFFSET 0/);
  assert.equal(values.length, 0);
});

test("buildCatalogueQuery filters by single and multiple normalized profiles", () => {
  const single = buildCatalogueQuery({ normalizedProfile: "food_beverage" });
  assert.match(single.text, /normalized_profile = \$1/);
  assert.deepEqual(single.values, ["food_beverage"]);

  const multi = buildCatalogueQuery({ normalizedProfile: ["hospitality", "accommodation"] });
  assert.match(multi.text, /normalized_profile = ANY\(\$1\)/);
  assert.deepEqual(multi.values, [["hospitality", "accommodation"]]);
});

test("buildCatalogueQuery filters by event capability and research disposition", () => {
  const query = buildCatalogueQuery({
    eventCapability: "VENUE_CAPABLE_NEEDS_WEB_VERIFICATION",
    researchDisposition: "FIRST_PARTY_WEB_VERIFICATION",
  });
  assert.match(query.text, /event_capability = \$1 AND research_disposition = \$2/);
  assert.deepEqual(query.values, [
    "VENUE_CAPABLE_NEEDS_WEB_VERIFICATION",
    "FIRST_PARTY_WEB_VERIFICATION",
  ]);
});

test("buildCatalogueQuery handles product route filters accurately", () => {
  const query = buildCatalogueQuery({
    resourcesRoute: "NEEDS_MORE_EVIDENCE",
    contextPosRoute: "STRONG_FIT",
    eventBusinessRoute: "NOT_APPLICABLE",
    ownerConfirmationRoute: "STRONG_FIT",
  });
  assert.match(query.text, /resources_route = \$1 AND context_pos_route = \$2 AND event_business_route = \$3 AND owner_confirmation_route = \$4/);
  assert.deepEqual(query.values, ["NEEDS_MORE_EVIDENCE", "STRONG_FIT", "NOT_APPLICABLE", "STRONG_FIT"]);
});

test("buildCatalogueQuery filters flags: invalid reference, duplicate, permanently closed", () => {
  const query = buildCatalogueQuery({
    isInvalidReference: false,
    isDuplicate: false,
    isPermanentlyClosed: true,
  });
  assert.match(query.text, /is_invalid_reference = \$1 AND is_duplicate = \$2 AND is_permanently_closed = \$3/);
  assert.deepEqual(query.values, [false, false, true]);
});

test("buildCatalogueQuery enforces search queries across name, locality, discovery query, and reference ID", () => {
  const query = buildCatalogueQuery({ searchQuery: "sandton" });
  assert.match(query.text, /\(entity_name ILIKE \$1 OR locality ILIKE \$1 OR discovery_query ILIKE \$1 OR external_reference_id ILIKE \$1\)/);
  assert.deepEqual(query.values, ["%sandton%"]);
});

test("buildCatalogueCountQuery generates exact count query without order by or limit", () => {
  const query = buildCatalogueCountQuery({ searchQuery: "sandton", limit: 50, offset: 100 });
  assert.match(query.text, /SELECT COUNT\(\*\)::int AS total/);
  assert.match(query.text, /FROM integration\.v_aire_catalogue/);
  assert.match(query.text, /WHERE \(entity_name ILIKE \$1/);
  assert.doesNotMatch(query.text, /LIMIT/);
  assert.doesNotMatch(query.text, /ORDER BY/);
  assert.deepEqual(query.values, ["%sandton%"]);
});

test("buildCatalogueQuery clamps limit bounds between 1 and 1000", () => {
  const zeroLimit = buildCatalogueQuery({ limit: -5 });
  assert.match(zeroLimit.text, /LIMIT 1 OFFSET 0/);

  const giantLimit = buildCatalogueQuery({ limit: 50000, offset: 250 });
  assert.match(giantLimit.text, /LIMIT 1000 OFFSET 250/);
});

test("buildCatalogueQuery handles custom sorting safely", () => {
  const query = buildCatalogueQuery({
    sortBy: "last_routed_at",
    sortOrder: "desc",
  });
  assert.match(query.text, /ORDER BY last_routed_at DESC NULLS LAST/);
});
