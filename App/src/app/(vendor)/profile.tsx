import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Card, InfoRow, SectionTitle } from "@/src/components/cards";
import { Button, SecondaryButton } from "@/src/components/controls";
import { Screen } from "@/src/components/layout";
import { AlertBox, StatusPill } from "@/src/components/status";
import { API_BASE } from "@/src/lib/config";
import { messageOf, useAuth } from "@/src/lib/auth";
import { colors, fonts, formatStatus, radius } from "@/src/theme";

function formatCoord(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(6) : "—";
}

export default function ProfileScreen() {
  const { vendor, session, signOut, refreshVendor } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const location = vendor?.location;
  const shopName = String(vendor?.shop_name ?? "Shop");
  const initials = shopName
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");

  const refresh = async () => {
    try {
      setRefreshing(true);
      setError("");
      await refreshVendor();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Screen
      title="Profile"
      subtitle="Your shop account and session details"
      action={
        <SecondaryButton
          label="Refresh"
          compact
          icon={<MaterialCommunityIcons name="refresh" size={13} color={colors.text} />}
          onPress={() => void refresh()}
          loading={refreshing}
        />
      }
      refreshing={refreshing}
      onRefresh={() => void refresh()}
    >
      {error ? <AlertBox type="error" message={error} /> : null}

      <Card>
        <View style={styles.header}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials || "V"}</Text>
          </View>
          <View style={styles.headerText}>
            <Text style={styles.name}>{shopName}</Text>
            <Text style={styles.email}>{String(vendor?.email ?? session?.email ?? "—")}</Text>
          </View>
          <StatusPill status={vendor?.status ?? "pending"} />
        </View>

        <InfoRow label="Phone" value={String(vendor?.phone || "—")} />
        <InfoRow label="Area type" value={formatStatus(vendor?.locality_tier ?? "mixed")} last />
      </Card>

      <View>
        <SectionTitle title="Shop Location" subtitle="Coordinates recorded at sign-up" />
        <Card style={styles.locationCard}>
          <View style={styles.mapIcon}>
            <MaterialCommunityIcons name="map-marker-outline" size={22} color={colors.primary} />
          </View>
          <View style={styles.locationText}>
            <Text style={styles.locationTitle}>
              {formatCoord(location?.latitude)}, {formatCoord(location?.longitude)}
            </Text>
            <Text style={styles.locationSubtitle}>
              {String(location?.address || "No address recorded")}
            </Text>
          </View>
        </Card>
      </View>

      <View>
        <SectionTitle title="Session" subtitle="Signed-in account and backend" />
        <Card>
          <InfoRow label="Signed in as" value={String(session?.email ?? "—")} />
          <InfoRow label="Role" value={String(session?.role ?? "vendor")} />
          <InfoRow label="Backend" value={API_BASE} last />
        </Card>
      </View>

      <Button
        label="Logout"
        icon={<MaterialCommunityIcons name="logout" size={14} color={colors.danger} />}
        tone="danger"
        full
        onPress={() => {
          signOut();
          router.replace("/(auth)/login");
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
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.butter,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: colors.primary,
    fontSize: 17,
    fontFamily: fonts.black,
  },
  headerText: {
    flex: 1,
    gap: 3,
  },
  name: {
    fontSize: 18,
    fontFamily: fonts.bold,
    color: colors.text,
  },
  email: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: fonts.regular,
  },
  locationCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
  },
  mapIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.chip,
    backgroundColor: colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  locationText: {
    flex: 1,
    gap: 4,
  },
  locationTitle: {
    fontSize: 15,
    fontWeight: "600",
    fontFamily: fonts.semibold,
    color: colors.text,
  },
  locationSubtitle: {
    fontSize: 13,
    color: colors.muted,
    lineHeight: 15,
    fontFamily: fonts.regular,
  },
});
