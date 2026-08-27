import { strict as assert } from "node:assert";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const migrationDirectory = new URL("../supabase/migrations/", import.meta.url);

const markers = new Map([
  ["20260818210522_legacy_foundation_compatibility.sql", "20260818000000_foundation.sql"],
  ["20260818210534_legacy_seed_event_suite_programs_compatibility.sql", null],
  ["20260818232137_legacy_secure_persistence_foundation_compatibility.sql", "20260819000001_secure_persistence_foundation.sql"],
  ["20260819111449_legacy_ai_sales_team_mvp_compatibility.sql", "20260819000002_ai_sales_team_mvp.sql"],
  ["20260819121242_legacy_ai_outreach_follow_up_v1_compatibility.sql", "20260819000003_ai_outreach_follow_up.sql"],
  ["20260819222258_legacy_autonomous_prospect_discovery_v1_compatibility.sql", "20260819000004_autonomous_prospect_discovery_v1.sql"],
]);

test("legacy production migration markers are exact and comment-only", async () => {
  const files = await readdir(migrationDirectory);
  const allMigrations = files.filter((file) => file.endsWith(".sql"));

  for (const [marker, equivalent] of markers) {
    assert.equal(allMigrations.filter((file) => file.startsWith(marker.slice(0, 14))).length, 1, marker);
    const contents = await readFile(new URL(marker, migrationDirectory), "utf8");
    assert.match(contents, /Production already applied this/);
    assert.match(contents, /comments only and no executable SQL/);
    assert.equal(
      contents
        .split(/\r?\n/)
        .some((line) => line.trim() && !line.trimStart().startsWith("--")),
      false,
      marker,
    );
    if (equivalent) assert.match(contents, new RegExp(equivalent.replaceAll(".", "\\.")));
    else assert.match(contents, /No canonical local equivalent exists/);
  }
});
