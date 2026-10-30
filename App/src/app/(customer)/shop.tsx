import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { Card, EmptyState, SectionTitle } from "@/src/components/cards";
import { Button, SecondaryButton } from "@/src/components/controls";
import { Screen } from "@/src/components/layout";
import { useAuth } from "@/src/lib/auth";
import { useCart, type CartLines } from "@/src/lib/cart";
import { kg, madeWhen, rupees, shopId } from "@/src/lib/shop-format";
import { colors, fonts } from "@/src/theme";

// Batter is sold in half-kilo steps.
const STEP = 0.5;

/** One shop: what it has fresh today, and how much of each the customer wants. */
export default function ShopScreen() {
  const { vendorId } = useLocalSearchParams<{ vendorId: string }>();
  const { nearbyVendors } = useAuth();
  const cart = useCart();
  const shop = nearbyVendors.find((item) => shopId(item) === vendorId) ?? null;
  // Coming back from Review keeps what was picked for this shop.
  const [lines, setLines] = useState<CartLines>(cart.shop && shopId(cart.shop) === vendorId ? cart.lines : {});

  const items = shop?.available_inventory ?? [];
  const chosen = items.filter((item) => (lines[String(item.product_name)] ?? 0) > 0);
  const totalKg = chosen.reduce((sum, item) => sum + lines[String(item.product_name)], 0);
  const total = chosen.reduce((sum, item) => sum + lines[String(item.product_name)] * Number(item.price ?? 0), 0);

  const change = (name: string, max: number, delta: number) =>
    setLines((prev) => {
      const next = Math.min(max, Math.max(0, (prev[name] ?? 0) + delta));
      return { ...prev, [name]: Number(next.toFixed(2)) };
    });

  return (
    <Screen
      portal="B2P CUSTOMER"
      title={String(shop?.shop_name ?? "Shop")}
      subtitle={shop ? `${Number(shop.distance_km ?? 0).toFixed(1)} km away · pick up and pay at the shop` : undefined}
      action={<SecondaryButton label="Back" compact onPress={() => router.back()} />}
      footer={
        shop ? (
          <View style={styles.footer}>
            <View>
              <Text style={styles.footerMeta}>
                {chosen.length} item{chosen.length === 1 ? "" : "s"} · {kg(totalKg)}
              </Text>
              <Text style={styles.footerTotal}>{rupees(total) || "—"}</Text>
            </View>
            <Button
              label="Review order"
              disabled={chosen.length === 0}
              onPress={() => {
                cart.setOrder(shop, lines);
                router.push("/(customer)/review");
              }}
            />
          </View>
        ) : null
      }
    >
      {!shop ? (
        <Card>
          <EmptyState title="Shop not found" text="Go back and pick a shop near you." />
        </Card>
      ) : (
        <View>
          <SectionTitle title="In stock now" subtitle="Freshest batch shown for each product" />
          <View style={styles.list}>
            {items.map((item) => {
              const name = String(item.product_name ?? "Batter");
              const max = Number(item.quantity ?? 0);
              const qty = lines[name] ?? 0;
              const made = madeWhen(item.made_at);
              return (
                <Card key={name} style={[styles.item, qty > 0 && styles.itemChosen]}>
                  <View style={styles.itemHead}>
                    <View style={styles.itemText}>
                      <Text style={styles.itemName}>{name}</Text>
                      <Text style={styles.meta}>{kg(max)} left</Text>
                    </View>
                    {item.price !== null && item.price !== undefined ? (
                      <Text style={styles.price}>
                        {rupees(item.price)}
                        <Text style={styles.per}>/kg</Text>
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.itemFoot}>
                    <Text style={[styles.made, { color: made.startsWith("today") ? colors.primary : colors.warning }]}>
                      {made ? `Made ${made}` : ""}
                    </Text>
                    <View style={styles.stepper}>
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={`Less ${name}`}
                        style={styles.stepButton}
                        disabled={qty <= 0}
                        onPress={() => change(name, max, -STEP)}
                      >
                        <Text style={styles.stepText}>−</Text>
                      </TouchableOpacity>
                      <Text style={styles.qty}>{kg(qty)}</Text>
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={`More ${name}`}
                        style={[styles.stepButton, styles.stepPlus]}
                        disabled={qty + STEP > max}
                        onPress={() => change(name, max, STEP)}
                      >
                        <Text style={styles.stepText}>+</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </Card>
              );
            })}
          </View>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 12,
  },
  item: {
    padding: 16,
    gap: 12,
  },
  itemChosen: {
    backgroundColor: colors.tableHeader,
  },
  itemHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 10,
  },
  itemText: {
    flex: 1,
    gap: 3,
  },
  itemName: {
    fontSize: 17,
    fontFamily: fonts.bold,
    color: colors.text,
  },
  meta: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: fonts.regular,
  },
  price: {
    fontSize: 22,
    fontFamily: fonts.black,
    color: colors.primary,
  },
  per: {
    fontSize: 12,
    fontFamily: fonts.semibold,
    color: colors.muted,
  },
  itemFoot: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  made: {
    flex: 1,
    fontSize: 13,
    fontFamily: fonts.semibold,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: 100,
    overflow: "hidden",
  },
  stepButton: {
    width: 44,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  stepPlus: {
    backgroundColor: colors.butter,
  },
  stepText: {
    fontSize: 22,
    fontFamily: fonts.bold,
    color: colors.primary,
  },
  qty: {
    minWidth: 64,
    textAlign: "center",
    fontSize: 15,
    fontFamily: fonts.bold,
    color: colors.text,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  footerMeta: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: fonts.regular,
  },
  footerTotal: {
    fontSize: 26,
    fontFamily: fonts.black,
    color: colors.primary,
  },
});
