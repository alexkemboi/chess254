import "server-only";
import { safeEqual, signedKey } from "@/server/crypto";

/** Customers (guests or members) open their order with an unforgeable per-order key. */
export function shopOrderKey(number: string) {
  return signedKey("shop-order", number);
}

export function verifyShopOrderKey(number: string, key: string | null | undefined) {
  return Boolean(key) && safeEqual(key!, shopOrderKey(number));
}

export function shopOrderPath(number: string) {
  return `/shop/orders/${number}?k=${shopOrderKey(number)}`;
}
