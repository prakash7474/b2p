import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import type { NearbyVendor, PickupOrder } from "./api";

/** kg chosen per product name, for one shop at a time. */
export type CartLines = Record<string, number>;

type CartState = {
  shop: NearbyVendor | null;
  lines: CartLines;
  /** Start (or replace) the order for a shop. */
  setOrder: (shop: NearbyVendor, lines: CartLines) => void;
  clear: () => void;
  /** The order just placed, for the confirmation screen. */
  lastOrder: PickupOrder | null;
  setLastOrder: (order: PickupOrder | null) => void;
};

const CartContext = createContext<CartState | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [shop, setShop] = useState<NearbyVendor | null>(null);
  const [lines, setLines] = useState<CartLines>({});
  const [lastOrder, setLastOrder] = useState<PickupOrder | null>(null);

  const value = useMemo<CartState>(
    () => ({
      shop,
      lines,
      setOrder: (next, nextLines) => {
        setShop(next);
        setLines(nextLines);
      },
      clear: () => {
        setShop(null);
        setLines({});
      },
      lastOrder,
      setLastOrder,
    }),
    [shop, lines, lastOrder],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartState {
  const value = useContext(CartContext);
  if (!value) throw new Error("useCart must be used inside CartProvider");
  return value;
}
