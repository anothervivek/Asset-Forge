export const DEFAULT_LIST_LIMIT = 60;
export const MAX_LIST_LIMIT = 200;

export function clampLimit(raw: string | null): number {
  const n = raw === null ? NaN : parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIST_LIMIT;
  return Math.min(n, MAX_LIST_LIMIT);
}
