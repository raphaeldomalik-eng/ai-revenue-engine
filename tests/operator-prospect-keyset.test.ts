import assert from "node:assert/strict";
import test from "node:test";
import { decodeProspectQueueCursor, encodeProspectQueueCursor, prospectQueueKey, type ProspectQueuePosition } from "../src/operator-ui/prospect-queue-cursor.ts";

const key = prospectQueueKey({ queue: "ALL", search: "", territory: "ALL", prospectType: "ALL", reviewState: "ALL", contactState: "ALL", emailState: "ALL", priority: "ALL", sort: "attention", pageSize: "25" });
const rows = Array.from({ length: 6001 }, (_, index) => ({
  id: `00000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`,
  sort_value: "same-sort-value",
  updated_at: "2026-08-25T10:00:00.000Z",
}));

function after(position: ProspectQueuePosition | null) {
  if (!position) return rows;
  return rows.filter((row) => row.id > position.id);
}

test("synthetic 6001-row traversal has no skipped or repeated records", () => {
  const seen: string[] = [];
  let position: ProspectQueuePosition | null = null;
  let page = 1;
  while (true) {
    const current = after(position).slice(0, 25);
    if (!current.length) break;
    seen.push(...current.map((row) => row.id));
    const next = current.at(-1)!;
    const cursor = encodeProspectQueueCursor(next, key, page, "attention");
    if (!cursor) throw new Error("cursor was not created");
    position = decodeProspectQueueCursor(cursor, key, page + 1, "attention", "next");
    page += 1;
  }
  assert.equal(seen.length, 6001);
  assert.equal(new Set(seen).size, 6001);
  assert.deepEqual(seen, rows.map((row) => row.id));
});

test("opaque cursors use updated_at and id as tie-breakers and reject incompatible state", () => {
  const position = rows[24];
  const cursor = encodeProspectQueueCursor(position, key, 1, "attention");
  assert.ok(cursor);
  assert.deepEqual(decodeProspectQueueCursor(cursor, key, 2, "attention", "next"), position);
  assert.throws(() => decodeProspectQueueCursor(cursor, prospectQueueKey({ ...JSON.parse(JSON.stringify({ queue: "ALL", search: "changed" })), pageSize: "25" }), 2, "attention", "next"), /PAGINATION_CURSOR_INVALID/);
  assert.throws(() => decodeProspectQueueCursor("not-a-cursor", key, 2, "attention", "next"), /PAGINATION_CURSOR_INVALID/);
  assert.throws(() => decodeProspectQueueCursor(cursor, key, 1, "attention", "previous"), /PAGINATION_CURSOR_INVALID/);
});
