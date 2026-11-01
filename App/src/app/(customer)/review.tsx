import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Card, EmptyState } from "@/src/components/cards";
import { Button, SecondaryButton } from "@/src/components/controls";
import { Screen } from "@/src/components/layout";
import { AlertBox } from "@/src/components/status";
import { api } from "@/src/lib/api";
import { messageOf } from "@/src/lib/auth";
import { useCart } from "@/src/lib/cart";
import { kg, rupees, shopId } from "@/src/lib/shop-format";
import { colors, fonts } from "@/src/theme";

/** Last look before ordering: where to collect, what, and the total. */
export default function ReviewScreen() {
  const cart = useCart();
  const [error, setError] = useState("");
  const [placing, setPlacing] = useState(false);

  const shop = cart.shop;
  const lines = (shop?.available_inventory ?? [])
    .map((item) => ({ name: String(item.product_name), kg: cart.lines[String(item.product_name)] ?? 0, price: item.price }))
    .filter((line) => line.kg > 0);
  const total = lines.reduce((sum, line) => sum + line.kg * Number(line.price ?? 0), 0);

  const place = async () => {
    if (!shop) return;
    try {
      setPlacing(true);
      setError("");
      const order = await api.placeOrder(
        shopId(shop),
        lines.map((line) => ({ product_name: line.name, quantity_kg: line.kg })),
      );
      cart.setLastOrder(order);
      router.replace("/(customer)/done");
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setPlacing(false);
    }
  };

  return (
    <Screen
      portal="B2P CUSTOMER"
      title="Your order"
      action={<SecondaryButton label="Back" compact onPress={() => router.back()} />}
      footer={
        lines.length > 0 ? (
          <Button label={`Place order · ${rupees(total) || kg(lines.reduce((s, l) => s + l.kg, 0))}`} full
            loading={placing} onPress={() => void place()} />
        ) : null
      }
    >
      {error ? <AlertBox type="error" message={error} /> : null}

      {!shop || lines.length === 0 ? (
        <Card>
          <EmptyState title="Nothing in your order" text="Pick a shop and choose how much batter you want." />
        </Card>
      ) : (
        <>
          <Card style={styles.pickup}>
            <View style={styles.pickupIcon}>
              <MaterialCommunityIcons name="storefront-outline" size={22} color={colors.primary} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.label}>PICK UP AT</Text>
              <Text style={styles.shop}>{String(shop.shop_name ?? "Shop")}</Text>
              <Text style={styles.meta}>
                {[`${Number(shop.distance_km ?? 0).toFixed(1)} km away`, shop.location?.address].filter(Boolean).join(" · ")}
              </Text>
            </View>
          </Card>

          <Card style={styles.lines}>
            {lines.map((line) => (
              <View key={line.name} style={styles.line}>
                <View style={styles.flex}>
                  <Text style={styles.lineName}>{line.name}</Text>
                  <Text style={styles.meta}>
                    {kg(line.kg)}
                    {line.price !== null && line.price !== undefined ? ` × ${rupees(line.price)}/kg` : ""}
                  </Text>
                </View>
                <Text style={styles.lineTotal}>{rupees(line.kg * Number(line.price ?? 0))}</Text>
              </View>
            ))}
            <View style={styles.totalRow}>
              <Text style={styles.label}>TOTAL</Text>
              <Text style={styles.total}>{rupees(total) || "—"}</Text>
            </View>
          </Card>

          <View style={styles.note}>
            <MaterialCommunityIcons name="cash-multiple" size={20} color={colors.primary} />
            <View style={styles.flex}>
              <Text style={styles.noteTitle}>Pay at the shop</Text>
              <Text style={styles.meta}>
                Cash or UPI when you collect. The shop keeps your batter aside for 2 hours.
              </Text>
            </View>
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    gap: 2,
  },
  pickup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
  },
  pickupIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.butter,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: 12,
    letterSpacing: 1.2,
    color: colors.primary,
    fontFamily: fonts.bold,
  },
  shop: {
    fontSize: 17,
    fontFamily: fonts.bold,
    color: colors.text,
  },
  meta: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: fonts.regular,
  },
  lines: {
    paddingHorizontal: 16,
  },
  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  lineName: {
    fontSize: 15,
    fontFamily: fonts.bold,
    color: colors.text,
  },
  lineTotal: {
    fontSize: 15,
    fontFamily: fonts.bold,
    color: colors.text,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    paddingVertical: 14,
  },
  total: {
    fontSize: 32,
    fontFamily: fonts.black,
    color: colors.primary,
  },
  note: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    padding: 16,
    borderRadius: 20,
    backgroundColor: colors.tableHeader,
  },
  noteTitle: {
    fontSize: 15,
    fontFamily: fonts.bold,
    color: colors.text,
  },
});
