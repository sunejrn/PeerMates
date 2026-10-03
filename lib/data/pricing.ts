/**
 * Mobile-data price table for the session cost estimate.
 *
 * Approximate prepaid mobile-data prices (USD per GB, 2025-2026 public
 * tariff data, rounded). These are *estimates* for cost awareness — the UI
 * always labels them as such. Free to extend; unknown regions fall back to
 * DEFAULT (global average ~$2.50/GB).
 */

export interface DataPrice {
  country: string;
  currency: string;
  /** e.g. "$", "₹", "€" — placed before the amount. */
  symbol: string;
  /** Approximate USD price per GB. */
  usdPerGB: number;
}

export const DATA_PRICES: Record<string, DataPrice> = {
  US: { country: "United States", currency: "USD", symbol: "$", usdPerGB: 5.5 },
  IN: { country: "India", currency: "INR", symbol: "₹", usdPerGB: 0.17 },
  GB: { country: "United Kingdom", currency: "GBP", symbol: "£", usdPerGB: 1.2 },
  DE: { country: "Germany", currency: "EUR", symbol: "€", usdPerGB: 2.1 },
  FR: { country: "France", currency: "EUR", symbol: "€", usdPerGB: 1.6 },
  NG: { country: "Nigeria", currency: "NGN", symbol: "₦", usdPerGB: 0.7 },
  KE: { country: "Kenya", currency: "KES", symbol: "KSh", usdPerGB: 0.9 },
  ZA: { country: "South Africa", currency: "ZAR", symbol: "R", usdPerGB: 1.4 },
  BR: { country: "Brazil", currency: "BRL", symbol: "R$", usdPerGB: 1.8 },
  MX: { country: "Mexico", currency: "MXN", symbol: "$", usdPerGB: 2.2 },
  PH: { country: "Philippines", currency: "PHP", symbol: "₱", usdPerGB: 1.1 },
  ID: { country: "Indonesia", currency: "IDR", symbol: "Rp", usdPerGB: 0.8 },
  PK: { country: "Pakistan", currency: "PKR", symbol: "₨", usdPerGB: 0.6 },
  BD: { country: "Bangladesh", currency: "BDT", symbol: "৳", usdPerGB: 0.5 },
  EG: { country: "Egypt", currency: "EGP", symbol: "E£", usdPerGB: 1.0 },
  TR: { country: "Türkiye", currency: "TRY", symbol: "₺", usdPerGB: 1.3 },
  SA: { country: "Saudi Arabia", currency: "SAR", symbol: "﷼", usdPerGB: 3.0 },
  AE: { country: "UAE", currency: "AED", symbol: "د.إ", usdPerGB: 4.2 },
  JP: { country: "Japan", currency: "JPY", symbol: "¥", usdPerGB: 3.4 },
  KR: { country: "South Korea", currency: "KRW", symbol: "₩", usdPerGB: 4.0 },
  AU: { country: "Australia", currency: "AUD", symbol: "A$", usdPerGB: 2.6 },
  CA: { country: "Canada", currency: "CAD", symbol: "C$", usdPerGB: 4.8 },
  AR: { country: "Argentina", currency: "ARS", symbol: "$", usdPerGB: 1.5 },
  CO: { country: "Colombia", currency: "COP", symbol: "$", usdPerGB: 1.7 },
};

export const DEFAULT_PRICE: DataPrice = {
  country: "Global average",
  currency: "USD",
  symbol: "$",
  usdPerGB: 2.5,
};

export function priceForRegion(regionCode: string | null | undefined): DataPrice {
  if (regionCode && DATA_PRICES[regionCode.toUpperCase()]) {
    return DATA_PRICES[regionCode.toUpperCase()];
  }
  return DEFAULT_PRICE;
}

/** e.g. "en-US" -> "US", "fr" -> null. */
export function regionFromLocale(locale: string | undefined): string | null {
  if (!locale) return null;
  const parts = locale.replace("_", "-").split("-");
  if (parts.length >= 2) {
    const region = parts[parts.length - 1].toUpperCase();
    if (/^[A-Z]{2}$/.test(region)) return region;
  }
  return null;
}

/** "128.4 MB" / "1.24 GB" formatting. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

/**
 * Estimated per-source video bitrates (bits/sec) used ONLY when exact bytes
 * can't be measured. HLS is measured exactly via segment sizes; local files
 * cost zero network bytes. YouTube/progressive MP4 can't be measured from
 * the page, so the meter labels those "~estimated".
 */
export const ESTIMATED_BITRATES: Record<string, number> = {
  youtube: 2_500_000, // ~720p average
  mp4: 4_000_000, // ~720-1080p progressive average
  hls: 0, // measured exactly — never estimated
  localfile: 0, // on-device bytes — zero network cost
};
