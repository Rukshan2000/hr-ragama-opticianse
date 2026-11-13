const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Date-only values ("2025-01-31") are calendar days: parse them as local, not UTC midnight. */
const parseDay = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00`) : new Date(v));
export const formatDate = (v: string | null | undefined) => (v ? dateFmt.format(parseDay(v)) : "—");
/** Today's calendar date in the browser's zone, as YYYY-MM-DD. */
export const today = () => new Date().toLocaleDateString("en-CA");
export const formatDateTime = (v: string | null | undefined) => (v ? dateTimeFmt.format(new Date(v)) : "Never");

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}
