import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";

import { Card, EmptyState, SectionTitle } from "@/src/components/cards";
import { Button, SecondaryButton } from "@/src/components/controls";
import { LoadingScreen, Screen } from "@/src/components/layout";
import { AlertBox } from "@/src/components/status";
import { api, parseServerDate, type PickupOrder } from "@/src/lib/api";
import { messageOf, useAuth } from "@/src/lib/auth";
import { useCart } from "@/src/lib/cart";
import { directionsUrl, kg, rupees, shopId } from "@/src/lib/shop-format";
import { colors, fonts } from "@/src/theme";

const STATUS: Record<string, { label: string; fg: string; bg: string }> = {
  to_collect: { label: "Ready", fg: colors.primary, bg: colors.butter },
  collecting: { label: "Ready", fg: colors.primary, bg: colors.butter },
  collected: { label: "Collected", fg: colors.primary, bg: colors.successBg },
  expired: { label: "Not collected", fg: colors.muted, bg: colors.neutralBg },
};

const when = (value: string) =>
  parseServerDate(value).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** The customer's orders: what to collect now, then earlier ones to order again. */
export default function OrdersScreen() {
  const { nearbyVendors } = useAuth();
  const cart = useCart();
  const [orders, setOrders] = useState<PickupOrder[] | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError("");
      setOrders(await api.getMyOrders());
    } catch (caught) {
      setError(messageOf(caught));
      setOrders((prev) => prev ?? []);
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Reload each time the tab opens, so a collected order moves down on its own.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (orders === null) return <LoadingScreen label="Loading your orders..." />;

  const open = orders.filter((order) => order.status === "to_collect" || order.status === "collecting");
  const earlier = orders.filter((order) => !open.includes(order));
  const shopFor = (order: PickupOrder) => nearbyVendors.find((shop) => shopId(shop) === order.vendor_id);

  const orderAgain = (order: PickupOrder) => {
    const shop = shopFor(order);
    if (!shop) {
      setError(`${order.shop_name ?? "That shop"} has no fresh batter near you right now.`);
      return;
    }
    cart.setOrder(shop, Object.fromEntries(order.items.map((item) => [item.product_name, item.quantity_kg])));
    router.push({ pathname: "/(customer)/shop", params: { vendorId: shopId(shop) } });
  };

  const summary = (order: PickupOrder) =>
    [order.items.map((item) => `${item.product_name.replace(" Batter", "")} ${kg(item.quantity_kg)}`).join(" · "),
      rupees(order.total)].filter(Boolean).join(" · ");

  return (
    <Screen
      portal="B2P CUSTOMER"
      title="My orders"
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void load();
      }}
    >
      {error ? <AlertBox type="error" message={error} /> : null}

      {orders.length === 0 ? (
        <Card>
          <EmptyState
            icon={<MaterialCommunityIcons name="shopping-outline" size={26} color={colors.muted} />}
            title="No orders yet"
            text="Order fresh batter from a shop near you; it shows up here."
          >
            <Button label="Find a shop" compact onPress={() => router.navigate("/(customer)")} />
          </EmptyState>
        </Card>
      ) : null}

      {open.length > 0 ? (
        <View>
          <SectionTitle title="To collect" subtitle="Show the code at the counter and pay there" />
          <View style={styles.list}>
            {open.map((order) => {
              const directions = directionsUrl(shopFor(order));
              return (
                <Card key={order.order_id} style={styles.card}>
                  <View style={styles.head}>
                    <View style={styles.flex}>
                      <Text style={styles.shop}>{order.shop_name ?? "Shop"}</Text>
                      <Text style={styles.meta}>{summary(order)}</Text>
                    </View>
                    <Badge status={order.status} />
                  </View>
                  <View style={styles.codeRow}>
                    <Text style={styles.meta}>
                      Code <Text style={styles.code}>{order.pickup_code}</Text> · until{" "}
                      {parseServerDate(order.hold_until).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                    </Text>
                    {directions ? (
                      <SecondaryButton label="Directions" compact onPress={() => void Linking.openURL(directions)} />
                    ) : null}
                  </View>
                </Card>
              );
            })}
          </View>
        </View>
      ) : null}

      {earlier.length > 0 ? (
        <View>
          <SectionTitle title="Earlier" />
          <View style={styles.list}>
            {earlier.map((order) => (
              <Card key={order.order_id} style={[styles.card, styles.past]}>
                <View style={styles.head}>
                  <View style={styles.flex}>
                    <Text style={styles.shop}>{order.shop_name ?? "Shop"}</Text>
                    <Text style={styles.meta}>{summary(order)}</Text>
                    <Text style={styles.meta}>{when(order.created_at)}</Text>
                  </View>
                  <Badge status={order.status} />
                </View>
                <Button label="Order again" compact onPress={() => orderAgain(order)} />
              </Card>
            ))}
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

function Badge({ status }: { status: string }) {
  const badge = STATUS[status] ?? STATUS.expired;
  return (
    <View style={[styles.badge, { backgroundColor: badge.bg }]}>
      <Text style={[styles.badgeText, { color: badge.fg }]}>{badge.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 12,
  },
  card: {
    padding: 16,
    gap: 12,
  },
  past: {
    borderColor: colors.line,
  },
  head: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  flex: {
    flex: 1,
    gap: 3,
  },
  shop: {
    fontSize: 16,
    fontFamily: fonts.bold,
    color: colors.text,
  },
  meta: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: fonts.regular,
  },
  codeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  code: {
    fontSize: 17,
    fontFamily: fonts.black,
    color: colors.primary,
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 100,
  },
  badgeText: {
    fontSize: 13,
    fontFamily: fonts.bold,
  },
});
