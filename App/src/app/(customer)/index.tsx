import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Card, EmptyState, SectionTitle } from "@/src/components/cards";
import { Button, FieldInput, SecondaryButton } from "@/src/components/controls";
import { Screen } from "@/src/components/layout";
import { AlertBox } from "@/src/components/status";
import { api } from "@/src/lib/api";
import { messageOf, useAuth } from "@/src/lib/auth";
import { useLiveLocation } from "@/src/lib/use-live-location";
import { colors, fonts } from "@/src/theme";

/** Customer home: shops near the customer that have stock, and a quick buy. */
export default function CustomerHomeScreen() {
  const { customer, nearbyVendors, customerLocation, loadNearby, signOut } = useAuth();
  const { error: locationError, capturing, capture } = useLiveLocation();

  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState("");

  const refresh = async () => {
    try {
      setRefreshing(true);
      setNotice(null);
      const here = customerLocation ?? (await capture());
      if (here) await loadNearby(here.latitude, here.longitude);
    } catch (caught) {
      setNotice({ type: "error", text: messageOf(caught) });
    } finally {
      setRefreshing(false);
    }
  };

  const buy = async (vendorKey: string, productName: string) => {
    const key = `${vendorKey}:${productName}`;
    const kg = Number(qty[key]);
    if (!Number.isFinite(kg) || kg <= 0) {
      setNotice({ type: "error", text: "Enter how many kg you want (greater than 0)." });
      return;
    }
    try {
      setBusyKey(key);
      setNotice(null);
      await api.buy(vendorKey, productName, kg);
      setNotice({ type: "success", text: `Ordered ${kg} kg of ${productName}.` });
      setQty((prev) => ({ ...prev, [key]: "" }));
      await refresh();
    } catch (caught) {
      setNotice({ type: "error", text: messageOf(caught) });
    } finally {
      setBusyKey("");
    }
  };

  return (
    <Screen
      portal="CUSTOMER PORTAL"
      title={`Hi ${String(customer?.name ?? "there")}`}
      subtitle="Shops within 5 km that have batter in stock"
      action={
        <SecondaryButton
          label="Refresh"
          compact
          icon={<MaterialCommunityIcons name="refresh" size={13} color={colors.text} />}
          onPress={() => void refresh()}
          loading={refreshing || capturing}
        />
      }
      refreshing={refreshing}
      onRefresh={() => void refresh()}
      keyboardShouldPersistTaps="handled"
    >
      {notice ? <AlertBox type={notice.type} message={notice.text} /> : null}
      {locationError ? <AlertBox type="error" message={locationError} /> : null}

      <SectionTitle title="Nearby Shops" subtitle={customerLocation?.address || undefined} />

      {nearbyVendors.length === 0 ? (
        <Card>
          <EmptyState
            icon={<MaterialCommunityIcons name="store-search-outline" size={26} color={colors.muted} />}
            title={customerLocation ? "No shops with stock nearby" : "Share your location"}
            text={
              customerLocation
                ? "Try again later; shops restock through the day."
                : "Tap Refresh to use your location and find shops near you."
            }
          />
        </Card>
      ) : (
        nearbyVendors.map((vendor) => {
          const vendorKey = String(vendor.vendor_id ?? vendor._id ?? "");
          const items = (vendor.available_inventory ?? []) as { product_name?: string; quantity?: number }[];
          return (
            <Card key={vendorKey} style={styles.card}>
              <View style={styles.header}>
                <Text style={styles.title}>{String(vendor.shop_name ?? vendorKey)}</Text>
                <Text style={styles.meta}>{Number(vendor.distance_km ?? 0).toFixed(1)} km</Text>
              </View>
              {vendor.location?.address ? <Text style={styles.meta}>{vendor.location.address}</Text> : null}

              {items.map((item) => {
                const product = String(item.product_name ?? "Batter");
                const key = `${vendorKey}:${product}`;
                return (
                  <View key={key} style={styles.itemRow}>
                    <View style={styles.itemText}>
                      <Text style={styles.itemName}>{product}</Text>
                      <Text style={styles.meta}>{Number(item.quantity ?? 0)} kg in stock</Text>
                    </View>
                    <View style={styles.qty}>
                      <FieldInput
                        value={qty[key] ?? ""}
                        onChangeText={(text) => setQty((prev) => ({ ...prev, [key]: text }))}
                        placeholder="kg"
                        keyboardType="decimal-pad"
                        accessibilityLabel={`Kilograms of ${product} to buy`}
                      />
                    </View>
                    <Button
                      label="Buy"
                      compact
                      loading={busyKey === key}
                      icon={<MaterialCommunityIcons name="cart-plus" size={13} color="#fff" />}
                      onPress={() => void buy(vendorKey, product)}
                    />
                  </View>
                );
              })}
            </Card>
          );
        })
      )}

      <Button
        label="Sign out"
        tone="secondary"
        icon={<MaterialCommunityIcons name="logout" size={14} color={colors.text} />}
        onPress={() => {
          signOut();
          router.replace("/(auth)/customer-login");
        }}
        full
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 15,
    gap: 6,
    marginBottom: 12,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  title: {
    fontSize: 13,
    fontWeight: "700",
    fontFamily: fonts.bold,
    color: colors.text,
    flex: 1,
  },
  meta: {
    fontSize: 10,
    color: colors.muted,
    fontFamily: fonts.regular,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  itemText: {
    flex: 1,
    gap: 2,
  },
  itemName: {
    fontSize: 12,
    fontWeight: "600",
    fontFamily: fonts.semibold,
    color: colors.text,
  },
  qty: {
    width: 70,
  },
});
