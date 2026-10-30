import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { Card, EmptyState, SectionTitle } from "@/src/components/cards";
import { Button, SecondaryButton } from "@/src/components/controls";
import { Screen } from "@/src/components/layout";
import { AlertBox } from "@/src/components/status";
import { messageOf, useAuth } from "@/src/lib/auth";
import { freshest, fromPrice, kg, madeWhen, rupees, shopId } from "@/src/lib/shop-format";
import {
  useLiveLocation,
  useLiveTracking,
  type CapturedLocation,
} from "@/src/lib/use-live-location";
import { colors, fonts } from "@/src/theme";

const CHIPS = ["All", "Idli Batter", "Dosa Batter", "Combo Pack"];

/** Customer home: shops near the customer with fresh batter in stock. */
export default function CustomerHomeScreen() {
  const { customer, nearbyVendors, customerLocation, loadNearby } = useAuth();
  const { error: locationError, capturing, capture } = useLiveLocation();

  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [product, setProduct] = useState("All");

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

  const shops = nearbyVendors.filter(
    (shop) => product === "All" || (shop.available_inventory ?? []).some((item) => item.product_name === product),
  );

  return (
    <Screen
      portal="B2P CUSTOMER"
      title="Eat fresh"
      subtitle={`Hi ${String(customer?.name ?? "there")}, ${customerLocation?.address || "shops within 5 km of you"}`}
      action={
        <SecondaryButton label="Refresh" compact onPress={() => void refresh()} loading={refreshing || capturing} />
      }
      refreshing={refreshing}
      onRefresh={() => void refresh()}
    >
      {notice ? <AlertBox type={notice.type} message={notice.text} /> : null}
      {locationError || trackingError ? <AlertBox type="error" message={locationError || trackingError} /> : null}

      <View style={styles.chips}>
        {CHIPS.map((chip) => (
          <TouchableOpacity
            key={chip}
            accessibilityRole="button"
            accessibilityState={{ selected: product === chip }}
            style={[styles.chip, product === chip && styles.chipActive]}
            onPress={() => setProduct(chip)}
          >
            <Text style={styles.chipText}>{chip.replace(" Batter", "").replace(" Pack", "")}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View>
        <SectionTitle title="Open near you" subtitle={liveFix ? "Following your location" : "Within 5 km"} />
        {shops.length === 0 ? (
          <Card>
            <EmptyState
              icon={<MaterialCommunityIcons name="store-search-outline" size={26} color={colors.muted} />}
              title={customerLocation ? "No fresh batter nearby" : "Share your location"}
              text={
                customerLocation
                  ? "Shops restock through the day; pull down to check again."
                  : "Tap Refresh to use your location and find shops near you."
              }
            />
          </Card>
        ) : (
          <View style={styles.list}>
            {shops.map((shop) => {
              const fresh = freshest(shop, product === "All" ? undefined : product);
              const made = fresh?.made_at ? madeWhen(fresh.made_at) : "";
              const today = made.startsWith("today");
              const price = fromPrice(shop);
              const stock = (shop.available_inventory ?? [])
                .map((item) => `${String(item.product_name ?? "").replace(" Batter", "")} ${kg(item.quantity)}`)
                .join(" · ");
              return (
                <Card key={shopId(shop)} style={styles.shopCard}>
                  <View style={[styles.stamp, { borderColor: today ? colors.primary : colors.warning }]}>
                    <Text style={[styles.stampSmall, { color: today ? colors.primary : colors.warning }]}>MADE</Text>
                    <Text style={[styles.stampBig, { color: today ? colors.primary : colors.warning }]}>
                      {/* Today: the time; older batter says how old, so it never looks fresher than it is. */}
                      {!made ? "—" : today ? made.split(", ")[1].replace(/:00| /g, "") : made.startsWith("yesterday") ? "YDAY" : made.split(", ")[0]}
                    </Text>
                  </View>
                  <View style={styles.shopText}>
                    <Text style={styles.shopName}>{String(shop.shop_name ?? "Shop")}</Text>
                    <Text style={styles.meta}>
                      {[`${Number(shop.distance_km ?? 0).toFixed(1)} km`, price !== null && `from ${rupees(price)}/kg`]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                    <Text style={styles.stock} numberOfLines={2}>{stock}</Text>
                  </View>
                  <Button
                    label="Order"
                    compact
                    onPress={() => router.push({ pathname: "/(customer)/shop", params: { vendorId: shopId(shop) } })}
                  />
                </Card>
              );
            })}
          </View>
        )}
      </View>
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
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    minHeight: 40,
    paddingHorizontal: 16,
    justifyContent: "center",
    borderRadius: 100,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  chipActive: {
    backgroundColor: colors.butter,
  },
  chipText: {
    fontSize: 14,
    fontFamily: fonts.semibold,
    color: colors.primary,
  },
  list: {
    gap: 12,
  },
  shopCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
  },
  stamp: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  stampSmall: {
    fontSize: 9,
    letterSpacing: 1,
    fontFamily: fonts.bold,
  },
  stampBig: {
    fontSize: 14,
    fontFamily: fonts.black,
  },
  shopText: {
    flex: 1,
    gap: 3,
  },
  shopName: {
    fontSize: 17,
    fontFamily: fonts.bold,
    color: colors.text,
  },
  meta: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: fonts.regular,
  },
  stock: {
    fontSize: 13,
    color: colors.primary,
    fontFamily: fonts.semibold,
  },
});
