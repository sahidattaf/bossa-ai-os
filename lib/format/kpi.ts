export interface TrendInfo {
  /** Signed percentage change, e.g. 4.2 or -3.1. Zero means no change. */
  deltaPercent: number;
  /** e.g. "vs last week" */
  comparisonLabel: string;
}

export type TrendDirection = "up" | "down" | "flat";

export interface FormattedTrend {
  direction: TrendDirection;
  label: string;
  toneClassName: string;
}

export function formatCurrency(amount: number, currency: string, locale = "en-US"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatNumber(value: number, locale = "en-US"): string {
  return new Intl.NumberFormat(locale).format(value);
}

export function formatPercentage(value: number, fractionDigits = 1): string {
  return `${value.toFixed(fractionDigits)}%`;
}

export type TrendPolarity = "increase-is-good" | "increase-is-bad";

/**
 * @param polarity For metrics like food cost % or labor %, a rising number is
 * bad even though the delta is positive — pass "increase-is-bad" to flip the
 * success/danger tone without changing the +/- sign or arrow direction.
 */
export function formatTrend(
  trend: TrendInfo,
  polarity: TrendPolarity = "increase-is-good",
): FormattedTrend {
  const { deltaPercent, comparisonLabel } = trend;

  if (deltaPercent === 0) {
    return {
      direction: "flat",
      label: `No change ${comparisonLabel}`,
      toneClassName: "text-muted-foreground",
    };
  }

  const direction: TrendDirection = deltaPercent > 0 ? "up" : "down";
  const sign = deltaPercent > 0 ? "+" : "";
  const isFavorable = polarity === "increase-is-good" ? direction === "up" : direction === "down";

  return {
    direction,
    label: `${sign}${deltaPercent.toFixed(1)}% ${comparisonLabel}`,
    toneClassName: isFavorable ? "text-success" : "text-danger",
  };
}
