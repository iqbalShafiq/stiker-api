import { config } from '../config';

const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;

function useJakartaTimezone(): boolean {
  return config.billing.dailyResetTimezone === 'Asia/Jakarta';
}

/** Day key YYYY-MM-DD in configured billing timezone. */
export function dayKeyForBillingDate(date: Date): string {
  if (!useJakartaTimezone()) {
    return date.toISOString().slice(0, 10);
  }
  const jakarta = new Date(date.getTime() + JAKARTA_OFFSET_MS);
  return jakarta.toISOString().slice(0, 10);
}

export function periodBoundsForBilling(date: Date): { periodStart: Date; periodEnd: Date } {
  if (!useJakartaTimezone()) {
    const periodStart = new Date(date);
    periodStart.setUTCHours(0, 0, 0, 0);
    const periodEnd = new Date(periodStart);
    periodEnd.setUTCHours(24, 0, 0, 0);
    return { periodStart, periodEnd };
  }

  const jakartaNow = new Date(date.getTime() + JAKARTA_OFFSET_MS);
  const y = jakartaNow.getUTCFullYear();
  const m = jakartaNow.getUTCMonth();
  const d = jakartaNow.getUTCDate();
  const periodStart = new Date(Date.UTC(y, m, d, 0, 0, 0, 0) - JAKARTA_OFFSET_MS);
  const periodEnd = new Date(periodStart.getTime() + 24 * 60 * 60 * 1000);
  return { periodStart, periodEnd };
}

export function billingResetTimezoneLabel(): string {
  return config.billing.dailyResetTimezone;
}
