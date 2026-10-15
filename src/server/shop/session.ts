import "server-only";
import { cookies } from "next/headers";
import { CART_COOKIE, findCart } from "./cart";

/** The visitor's cart from their cookie (read-only; carts are created by Server Actions). */
export async function cookieCart() {
  return findCart((await cookies()).get(CART_COOKIE)?.value);
}
