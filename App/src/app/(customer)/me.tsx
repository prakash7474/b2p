import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Card, InfoRow, SectionTitle } from "@/src/components/cards";
import { Button } from "@/src/components/controls";
import { Screen } from "@/src/components/layout";
import { AlertBox } from "@/src/components/status";
import { api } from "@/src/lib/api";
import { messageOf, useAuth } from "@/src/lib/auth";
import { useLiveLocation } from "@/src/lib/use-live-location";
import { colors, fonts } from "@/src/theme";

/** The customer's account, where shops are searched from, and sign out. */
export default function MeScreen() {
  const { customer, customerLocation, loadNearby, signOut } = useAuth();
  const { capturing, capture, error: locationError } = useLiveLocation();
  const [orderCount, setOrderCount] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useFocusEffect(
    useCallback(() => {
      api.getMyOrders().then((orders) => setOrderCount(orders.length)).catch(() => setOrderCount(null));
    }, []),
  );

  const name = String(customer?.name ?? "there");
  const initials = name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();

  const shareLocation = async () => {
    try {
      setNotice(null);
      const here = await capture();
      if (!here) return;
      await loadNearby(here.latitude, here.longitude);
      setNotice({ type: "success", text: "Shops near your current location are now listed on Home." });
    } catch (caught) {
      setNotice({ type: "error", text: messageOf(caught) });
    }
  };

  return (
    <Screen portal="B2P CUSTOMER" title={`Hi, ${name.split(" ")[0]}`}>
      {notice ? <AlertBox type={notice.type} message={notice.text} /> : null}
      {locationError ? <AlertBox type="error" message={locationError} /> : null}

      <Card>
        <View style={styles.header}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials || "B"}</Text>
          </View>
          <View style={styles.flex}>
            <Text style={styles.name}>{name}</Text>
            <Text style={styles.meta}>Customer</Text>
          </View>
        </View>
        <InfoRow label="Phone" value={String(customer?.phone || "—")} />
        <InfoRow label="Email" value={String(customer?.email || "—")} />
        <InfoRow label="Orders so far" value={orderCount === null ? "—" : String(orderCount)} last />
      </Card>

      <View>
        <SectionTitle title="Shops near" subtitle="Home lists shops within 5 km of here" />
        <Card style={styles.location}>
          <View style={styles.row}>
            <MaterialCommunityIcons name="map-marker-outline" size={22} color={colors.primary} />
            <Text style={[styles.flex, styles.place]}>
              {customerLocation?.address ||
                (customerLocation
                  ? `${customerLocation.latitude.toFixed(4)}, ${customerLocation.longitude.toFixed(4)}`
                  : "No location shared yet")}
            </Text>
          </View>
          <Button label="Use my current location" full loading={capturing} onPress={() => void shareLocation()} />
        </Card>
      </View>

      <Button
        label="Sign out"
        tone="danger"
        full
        icon={<MaterialCommunityIcons name="logout" size={18} color={colors.danger} />}
        onPress={() => {
          signOut();
          router.replace("/(auth)/customer-login");
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.butter,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 20,
    fontFamily: fonts.black,
    color: colors.primary,
  },
  flex: {
    flex: 1,
  },
  name: {
    fontSize: 18,
    fontFamily: fonts.bold,
    color: colors.text,
  },
  meta: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: fonts.regular,
  },
  location: {
    padding: 16,
    gap: 14,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  place: {
    fontSize: 15,
    fontFamily: fonts.semibold,
    color: colors.text,
  },
});
