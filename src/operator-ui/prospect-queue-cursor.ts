import { createHash } from "node:crypto";

export type ProspectQueueCursor = { v: 1; key: string; page: number; sort: string; sort_value: string; updated_at: string; id: string };
export type ProspectQueuePosition = { sort_value: string; updated_at: string; id: string };

export function prospectQueueKey(input: Record<string, string>) {
  return createHash("sha256").update(JSON.stringify(input)).digest("base64url");
}

export function encodeProspectQueueCursor(position: ProspectQueuePosition | null | undefined, key: string, page: number, sort: string) {
  if (!position?.sort_value || !position.updated_at || !position.id) return null;
  const cursor: ProspectQueueCursor = { v: 1, key, page, sort, sort_value: String(position.sort_value), updated_at: String(position.updated_at), id: String(position.id) };
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeProspectQueueCursor(raw: string | null, expectedKey: string, expectedPage: number, expectedSort: string, direction: "next" | "previous") {
  if (!raw) return null;
  try {
    const cursor = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<ProspectQueueCursor>;
    const expectedCursorPage = direction === "next" ? expectedPage - 1 : expectedPage + 1;
    if (cursor.v !== 1 || cursor.key !== expectedKey || cursor.sort !== expectedSort || cursor.page !== expectedCursorPage || typeof cursor.sort_value !== "string" || !cursor.updated_at || !cursor.id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor.id) || Number.isNaN(Date.parse(cursor.updated_at))) throw new Error("invalid cursor");
    return { sort_value: cursor.sort_value, updated_at: cursor.updated_at, id: cursor.id };
  } catch {
    throw new Error("PAGINATION_CURSOR_INVALID");
  }
}
