import { parseServerDate, type NearbyVendor, type StockItem } from "./api";

/** "₹80" or "" when the catalog has no price. */
export const rupees = (value: unknown) =>
  value === null || value === undefined || value === "" ? "" : `₹${Number(Number(value).toFixed(2))}`;

export const kg = (value: unknown) => `${Number(Number(value ?? 0).toFixed(2))} kg`;

/** "today, 5:10 AM" / "yesterday, 6:05 AM" / "28 Oct, 5:10 AM". */
export function madeWhen(value: unknown): string {
  if (!value) return "";
  const date = parseServerDate(value);
  if (Number.isNaN(date.getTime())) return "";
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  const diff = Math.round((day.getTime() - new Date(date).setHours(0, 0, 0, 0)) / 86400000);
  if (diff === 0) return `today, ${time}`;
  if (diff === 1) return `yesterday, ${time}`;
  return `${date.toLocaleDateString(undefined, { day: "numeric", month: "short" })}, ${time}`;
}

/** The freshest product a shop has (for its "made" stamp), optionally of one product only. */
export function freshest(shop: NearbyVendor, product?: string): StockItem | null {
  const items = (shop.available_inventory ?? []).filter((item) => !product || item.product_name === product);
  return items.reduce<StockItem | null>(
    (best, item) => (item.made_at && (!best?.made_at || String(item.made_at) > String(best.made_at)) ? item : best),
    null,
  );
}

/** Lowest catalog price among a shop's products. */
export function fromPrice(shop: NearbyVendor): number | null {
  const prices = (shop.available_inventory ?? [])
    .map((item) => item.price)
    .filter((price): price is number => typeof price === "number");
  return prices.length ? Math.min(...prices) : null;
}

export const shopId = (shop: NearbyVendor) => String(shop.vendor_id ?? shop._id ?? "");

export function directionsUrl(shop: NearbyVendor | null | undefined): string | null {
  const lat = shop?.location?.latitude;
  const lng = shop?.location?.longitude;
  return typeof lat === "number" && typeof lng === "number"
    ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
    : null;
}
