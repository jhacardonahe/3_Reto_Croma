/** Helpers de fecha en ISO 8601 (yyyy-mm-dd). */

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Días entre hoy y una fecha yyyy-mm-dd. Positivo = en el futuro. null si inválida. */
export function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null;
  const target = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(target)) return null;
  const now = Date.parse(`${today()}T00:00:00Z`);
  return Math.round((target - now) / 86_400_000);
}
