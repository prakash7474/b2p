import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Card, EmptyState, SectionTitle } from "@/src/components/cards";
import { Button, FieldInput, SecondaryButton } from "@/src/components/controls";
import { Screen } from "@/src/components/layout";
import { AlertBox } from "@/src/components/status";
import { api } from "@/src/lib/api";
import { messageOf, useAuth } from "@/src/lib/auth";
import {
  useLiveLocation,
  useLiveTracking,
  type CapturedLocation,
} from "@/src/lib/use-live-location";
import { colors, fonts } from "@/src/theme";

/** Customer home: shops near the customer that have stock, and a quick buy. */
export default function CustomerHomeScreen() {
  const { customer, nearbyVendors, customerLocation, loadNearby, signOut } = useAuth();
  const { error: locationError, capturing, capture } = useLiveLocation();

  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState("");

  /** Where the list was last loaded from, so we only reload once the customer moves on. */
  const lastLoadedRef = useRef<{ latitude: number; longitude: number } | null>(null);

  const loadNearbyFrom = useCallback(
    async (latitude: number, longitude: number) => {
      lastLoadedRef.current = { latitude, longitude };
      await loadNearby(latitude, longitude);
    },
    [loadNearby],
  );

  /** Live high-accuracy fixes keep the nearby list current while the customer moves. */
  const handleFix = useCallback(
    (fix: CapturedLocation) => {
      const last = lastLoadedRef.current;
      if (last && metresBetween(last, fix) < LIVE_RELOAD_METRES) return;
      void loadNearbyFrom(fix.latitude, fix.longitude).catch((caught) =>
        setNotice({ type: "error", text: messageOf(caught) }),
      );
    },
    [loadNearbyFrom],
  );

  const { position: liveFix, error: trackingError, start } = useLiveTracking({
    onFix: handleFix,
  });

  // The customer already shared a location at sign-in, so track live from the start.
  useEffect(() => {
    if (customerLocation) void start();
  }, [customerLocation, start]);

  const refresh = async () => {
    try {
      setRefreshing(true);
      setNotice(null);
      const here = customerLocation ?? (await capture());
      if (here) {
        await loadNearbyFrom(here.latitude, here.longitude);
        // Location is shared now — keep the list fresh in the background.
        void start();
      }
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
      portal="B2P CUSTOMER"
      title="Eat fresh"
      subtitle={`Hi ${String(customer?.name ?? "there")}, these shops within 5 km have batter in stock`}
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
      {locationError || trackingError ? (
        <AlertBox type="error" message={locationError || trackingError} />
      ) : null}

      <SectionTitle title="Nearby Shops" subtitle={customerLocation?.address || undefined} />

      {/* Live GPS quality of the fix the list is based on. */}
      {liveFix ? (
        <View style={styles.liveRow}>
          <MaterialCommunityIcons name="crosshairs-gps" size={12} color={colors.primary} />
          <Text style={styles.liveMeta}>
            {`Accuracy ± ${liveFix.accuracy !== null ? `${Math.round(liveFix.accuracy)} m` : "unknown"}`}
            {"  ·  "}
            {`updated ${new Date(liveFix.capturedAt).toLocaleTimeString()}`}
          </Text>
        </View>
      ) : null}

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
                      icon={<MaterialCommunityIcons name="cart-plus" size={18} color={colors.primary} />}
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

/** Refresh nearby results once the customer has moved at least this far. */
const LIVE_RELOAD_METRES = 50;

/** Great-circle distance in metres between two fixes. */
function metresBetween(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const haversine =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(haversine));
}

const styles = StyleSheet.create({
  liveRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: -2,
    marginBottom: 10,
  },
  liveMeta: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: fonts.regular,
  },
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
    fontSize: 18,
    fontFamily: fonts.medium,
    color: colors.text,
    flex: 1,
  },
  meta: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: fonts.regular,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  itemText: {
    flex: 1,
    gap: 2,
  },
  itemName: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: fonts.semibold,
    color: colors.text,
  },
  qty: {
    width: 70,
  },
});
