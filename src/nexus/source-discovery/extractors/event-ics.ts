import { canonicalHttpsUrl } from "../network.ts";
import type { FetchedDocument } from "../types.ts";

export type CalendarEventFacts = {
  sourcePageUrl: string;
  sourceEventUrl: string;
  sourceExternalId: string;
  title: string;
  startAt: string;
  endAt: string | null;
  timezone: string | null;
  venueText: string | null;
  description: string | null;
  sourceHash: string;
};

function unescapeValue(value: string): string {
  return value.replace(/\\[nN]/g, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();
}

function validTimezone(value: string | null): string | null {
  if (!value) return null;
  try { new Intl.DateTimeFormat("en-GB", { timeZone: value }); return value; }
  catch { return null; }
}

function localParts(instant: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second"));
}

function calendarDate(value: string | undefined, timezone: string | null): string | null {
  if (!value) return null;
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!match) return null;
  const wall = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] ?? 0));
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 16) !== `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}`) return null;
  if (match[7]) return new Date(wall).toISOString();
  if (!timezone) return null;
  let instant = wall;
  for (let index = 0; index < 3; index += 1) instant += wall - localParts(instant, timezone);
  return localParts(instant, timezone) === wall ? new Date(instant).toISOString() : null;
}

function properties(lines: string[]) {
  const result = new Map<string, { value: string; timezone: string | null }>();
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon < 1) continue;
    const head = line.slice(0, colon).split(";");
    const name = head[0]!.toUpperCase();
    const timezone = validTimezone(head.find((item) => /^TZID=/i.test(item))?.slice(5) ?? null);
    if (!result.has(name)) result.set(name, { value: unescapeValue(line.slice(colon + 1)), timezone });
  }
  return result;
}

export function parseCalendarDocument(document: FetchedDocument): { events: CalendarEventFacts[]; warning: string | null } {
  const lines = document.body.replace(/\r\n[ \t]|\n[ \t]/g, "").split(/\r?\n/);
  if (!lines.includes("BEGIN:VCALENDAR") || !lines.includes("END:VCALENDAR")) return { events: [], warning: `${document.url}: malformed ICS was ignored.` };
  const calendar = properties(lines.slice(0, lines.indexOf("BEGIN:VEVENT")));
  const calendarTimezone = validTimezone(calendar.get("X-WR-TIMEZONE")?.value ?? null);
  const events: CalendarEventFacts[] = [];
  let truncated = false;
  let start = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] === "BEGIN:VEVENT") start = index + 1;
    if (lines[index] !== "END:VEVENT" || start < 0) continue;
    if (events.length >= 100) { truncated = true; break; }
    const props = properties(lines.slice(start, index));
    start = -1;
    const uid = props.get("UID")?.value;
    const title = props.get("SUMMARY")?.value;
    const timezone = props.get("DTSTART")?.timezone ?? calendarTimezone;
    const startAt = calendarDate(props.get("DTSTART")?.value, timezone);
    if (!uid || !title || !startAt) continue;
    const fallbackUrl = new URL(document.url);
    fallbackUrl.search = "";
    const sourceEventUrl = canonicalHttpsUrl(props.get("URL")?.value ?? fallbackUrl.toString(), document.url);
    if (!sourceEventUrl || new URL(sourceEventUrl).origin !== new URL(document.url).origin) continue;
    events.push({
      sourcePageUrl: fallbackUrl.toString(), sourceEventUrl, sourceExternalId: uid,
      title, startAt, endAt: calendarDate(props.get("DTEND")?.value, props.get("DTEND")?.timezone ?? timezone),
      timezone, venueText: props.get("LOCATION")?.value ?? null,
      description: props.get("DESCRIPTION")?.value?.slice(0, 10_000) ?? null,
      sourceHash: document.sourceHash,
    });
  }
  return { events, warning: truncated ? `${document.url}: ICS event limit reached; remainder was ignored.` : events.length ? null : `${document.url}: malformed ICS was ignored.` };
}
