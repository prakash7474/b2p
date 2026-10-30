import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Linking, StyleSheet, Text, View } from "react-native";

import { Card, EmptyState } from "@/src/components/cards";
import { Button, SecondaryButton } from "@/src/components/controls";
import { Screen } from "@/src/components/layout";
import { parseServerDate } from "@/src/lib/api";
import { useCart } from "@/src/lib/cart";
import { directionsUrl, kg, rupees } from "@/src/lib/shop-format";
import { colors, fonts } from "@/src/theme";

/** Order placed: the pickup code to show at the counter. */
export default function DoneScreen() {
  const cart = useCart();
  const order = cart.lastOrder;
  const directions = directionsUrl(cart.shop);
  const until = order ? parseServerDate(order.hold_until).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "";

  const goToOrders = () => {
    cart.clear();
    router.replace("/(customer)/orders");
  };

  return (
    <Screen
      portal="B2P CUSTOMER"
      title="Order placed"
      subtitle={order ? `${order.shop_name ?? "The shop"} has set your batter aside until ${until}.` : undefined}
      icon="check-decagram-outline"
    >
      {!order ? (
        <Card>
          <EmptyState title="No order yet" text="Your placed orders are under Orders." />
        </Card>
      ) : (
        <>
          <Card style={styles.code}>
            <Text style={styles.label}>SHOW AT THE COUNTER</Text>
            <Text style={styles.codeText} accessibilityLabel={`Pickup code ${order.pickup_code.split("").join(" ")}`}>
              {order.pickup_code}
            </Text>
            <Text style={styles.meta}>Pickup code · pay {rupees(order.total) || "at the shop"} when you collect</Text>
          </Card>

          <Card style={styles.lines}>
            {order.items.map((item) => (
              <View key={item.product_name} style={styles.line}>
                <Text style={styles.lineText}>
                  {item.product_name} · {kg(item.quantity_kg)}
                </Text>
                <Text style={styles.lineTotal}>{rupees(item.line_total)}</Text>
              </View>
            ))}
            <View style={[styles.line, styles.lineLast]}>
              <Text style={styles.meta}>Ready to collect until</Text>
              <Text style={styles.lineTotal}>{until}</Text>
            </View>
          </Card>

          <View style={styles.actions}>
            {directions ? (
              <Button
                label="Directions to the shop"
                full
                icon={<MaterialCommunityIcons name="navigation-variant-outline" size={18} color={colors.primary} />}
                onPress={() => void Linking.openURL(directions)}
              />
            ) : null}
            <SecondaryButton label="See my orders" full onPress={goToOrders} />
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  code: {
    padding: 20,
    alignItems: "center",
    gap: 4,
    borderStyle: "dashed",
  },
  label: {
    fontSize: 12,
    letterSpacing: 1.2,
    color: colors.primary,
    fontFamily: fonts.bold,
  },
  codeText: {
    fontSize: 56,
    letterSpacing: 8,
    fontFamily: fonts.black,
    color: colors.primary,
  },
  meta: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: fonts.regular,
    textAlign: "center",
  },
  lines: {
    paddingHorizontal: 16,
  },
  line: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  lineLast: {
    borderBottomWidth: 0,
  },
  lineText: {
    fontSize: 15,
    fontFamily: fonts.medium,
    color: colors.text,
  },
  lineTotal: {
    fontSize: 15,
    fontFamily: fonts.bold,
    color: colors.text,
  },
  actions: {
    gap: 10,
  },
});
