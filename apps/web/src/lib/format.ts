import type { NumberFormat } from "@/types/api";

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

export function formatNumber(value: unknown, format: NumberFormat = "auto", currency = "USD"): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  switch (format) {
    case "compact":
      return compact.format(n);
    case "integer":
      return integer.format(n);
    case "decimal":
      return decimal.format(n);
    case "percent":
      return new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 }).format(n);
    case "currency":
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        notation: Math.abs(n) >= 1e6 ? "compact" : "standard",
        maximumFractionDigits: Math.abs(n) >= 1e6 ? 1 : 2,
      }).format(n);
    default:
      if (Math.abs(n) >= 1e6) return compact.format(n);
      return Number.isInteger(n) ? integer.format(n) : decimal.format(n);
  }
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return "just now";
  const units: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [30, "day"],
    [12, "month"],
    [Infinity, "year"],
  ];
  let value = seconds;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [size, unit] of units) {
    if (Math.abs(value) < size) return rtf.format(-Math.round(value), unit);
    value /= size;
  }
  return formatDate(iso);
}

const fractional = new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 });

/** Render a cell for grids. Formatting follows the column type, so a column is formatted consistently. */
export function formatCell(value: unknown, type = ""): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    if (/float|double|decimal|real/i.test(type)) return fractional.format(value);
    return Number.isInteger(value) ? String(value) : fractional.format(value); // ints stay raw (ids, years)
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

export function pluralize(n: number, word: string, plural = `${word}s`): string {
  return `${formatNumber(n, "integer")} ${n === 1 ? word : plural}`;
}
