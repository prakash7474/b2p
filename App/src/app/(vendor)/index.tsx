import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { Card, EmptyState, InfoRow, SectionTitle, StatCard, StatGrid } from "@/src/components/cards";
import { LoadingScreen, Screen } from "@/src/components/layout";
import { Button, SecondaryButton } from "@/src/components/controls";
import { AlertBox, StatusPill } from "@/src/components/status";
import {
  api,
  type ActivityLog,
  type DemandRequest,
  type InventoryItem,
} from "@/src/lib/api";
import { messageOf, useAuth } from "@/src/lib/auth";
import { colors, fonts, pick, radius } from "@/src/theme";

function isLowStock(item: InventoryItem): boolean {
  const quantity = Number(pick(item, ["quantity", "stock", "available_quantity"], 0));
  const threshold = Number(pick(item, ["reorder_level", "minimum_stock", "threshold"], 10));
  return quantity <= threshold;
}

function formatCoord(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(6) : "—";
}

function demandItems(demand: DemandRequest): string {
  const items = demand.items ?? [];
  if (items.length === 0) return "No items";
  return items
    .map((item) => `${item.product_name ?? item.product_id ?? "Item"} × ${item.quantity ?? 0}`)
    .join(", ");
}

function shortId(id: unknown): string {
  const value = String(id ?? "");
  return value.length > 8 ? `#${value.slice(-6)}` : value ? `#${value}` : "#—";
}

export default function DashboardScreen() {
  const { vendor, vendorId, session, refreshVendor } = useAuth();

  const [inventory, setInventory] = useState<InventoryItem[] | null>(null);
  const [demands, setDemands] = useState<DemandRequest[] | null>(null);
  const [logs, setLogs] = useState<ActivityLog[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!vendorId) return;

    try {
      setError("");
      const [inventoryData, demandData, logData] = await Promise.all([
        api.getInventory(vendorId),
        api.getDemands(vendorId),
        api.getLogs(),
      ]);

      setInventory(inventoryData);
      setDemands(demandData);
      setLogs(logData);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [vendorId]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([load(), refreshVendor()]);
  }, [load, refreshVendor]);

  if (loading) {
    return <LoadingScreen label="Loading dashboard..." />;
  }

  const inventoryItems = inventory ?? [];
  const demandList = demands ?? [];
  const lowStock = inventoryItems.filter(isLowStock).length;
  const pendingDemands = demandList.filter((demand) => {
    const status = String(demand.status ?? "").toLowerCase();
    return !["synchronized", "completed", "cancelled"].includes(status);
  }).length;

  const ownLogs = (logs ?? []).filter((log) => {
    const blob = JSON.stringify(log).toLowerCase();
    return [vendorId, session?.email, vendor?.shop_name]
      .filter(Boolean)
      .some((needle) => blob.includes(String(needle).toLowerCase()));
  });

  const location = vendor?.location;

  return (
    <Screen
      title="Dashboard"
      subtitle="Your shop at a glance"
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
      {error ? (
        <AlertBox
          type="error"
          message={error}
        />
      ) : null}

      <StatGrid>
        <StatCard
          icon={(color) => <MaterialCommunityIcons name="package-variant" size={18} color={color} />}
          label="Inventory Items"
          value={inventoryItems.length}
          sub="products mapped"
        />
        <StatCard
          icon={(color) => <MaterialCommunityIcons name="alert-decagram-outline" size={18} color={color} />}
          label="Low Stock"
          value={lowStock}
          sub={lowStock > 0 ? "needs attention" : "all healthy"}
          tone={lowStock > 0 ? "danger" : "success"}
        />
        <StatCard
          icon={(color) => <MaterialCommunityIcons name="clipboard-text-outline" size={18} color={color} />}
          label="Pending Demands"
          value={pendingDemands}
          sub={`${demandList.length} total requests`}
        />
        <StatCard
          icon={(color) => <MaterialCommunityIcons name="file-document-outline" size={18} color={color} />}
          label="Activity"
          value={ownLogs.length}
          sub="logged events"
        />
      </StatGrid>

      <View>
        <SectionTitle title="Shop Profile" subtitle="Registered details of your shop" />
        <Card>
          <View style={styles.profileHeader}>
            <View style={styles.profileIcon}>
              <MaterialCommunityIcons name="storefront-outline" size={18} color={colors.primary} />
            </View>
            <View style={styles.profileHeaderText}>
              <Text style={styles.profileName}>
                {String(vendor?.shop_name ?? "Shop name not set")}
              </Text>
              <Text style={styles.profileId}>{String(vendorId || "—")}</Text>
            </View>
            <StatusPill status={vendor?.status ?? "pending"} />
          </View>

          <InfoRow label="Email" value={String(vendor?.email ?? session?.email ?? "—")} />
          <InfoRow label="Phone" value={String(vendor?.phone || "—")} />
          <InfoRow label="Locality Tier" value={String(vendor?.locality_tier ?? "mixed")} />
          <InfoRow
            label="Latitude"
            value={formatCoord(location?.latitude)}
          />
          <InfoRow
            label="Longitude"
            value={formatCoord(location?.longitude)}
          />
          <InfoRow
            label="Address"
            value={String(location?.address || "—")}
            last
          />
        </Card>
      </View>

      <View>
        <SectionTitle title="Demand Queue" subtitle="Your latest restock requests" />
        <Card style={styles.cardPadding}>
          {demandList.length === 0 ? (
            <EmptyState
              icon={
                <MaterialCommunityIcons
                  name="clipboard-text-outline"
                  size={26}
                  color={colors.muted}
                />
              }
              title="No demand requests"
              text="Raise a restock demand from the Demands tab."
            >
              <Button
                label="Open demand center"
                compact
                onPress={() => router.push("/(vendor)/demands")}
              />
            </EmptyState>
          ) : (
            demandList.slice(0, 5).map((demand, index) => (
              <View
                key={String(demand._id ?? index)}
                style={[
                  styles.queueItem,
                  index === Math.min(demandList.length, 5) - 1 && styles.queueItemLast,
                ]}
              >
                <View style={styles.queueMain}>
                  <Text style={styles.queueTitle}>
                    Request {shortId(demand._id)} · {demandItems(demand)}
                  </Text>
                  <Text style={styles.queueSubtitle}>
                    {String(demand.priority ?? "normal")} priority
                  </Text>
                </View>
                <StatusPill status={demand.status ?? "pending"} />
              </View>
            ))
          )}
        </Card>
      </View>

      <View>
        <SectionTitle title="Recent Activity" subtitle="Latest events for your account" />
        <Card style={styles.cardPadding}>
          {ownLogs.length === 0 ? (
            <EmptyState
              icon={<MaterialCommunityIcons name="history" size={26} color={colors.muted} />}
              title="No activity yet"
              text="Events recorded by the backend will appear here."
            />
          ) : (
            ownLogs.slice(0, 6).map((log, index) => (
              <View
                key={String(log._id ?? index)}
                style={[
                  styles.activityItem,
                  index === Math.min(ownLogs.length, 6) - 1 && styles.queueItemLast,
                ]}
              >
                <View style={styles.activityIcon}>
                  <MaterialCommunityIcons
                    name="file-document-outline"
                    size={14}
                    color={colors.primary}
                  />
                </View>
                <View style={styles.activityBody}>
                  <Text style={styles.activityText}>
                    {String(
                      log.message ?? log.action ?? "System activity recorded",
                    )}
                  </Text>
                  <Text style={styles.activityTime}>
                    {String(log.created_at ?? log.timestamp ?? "")}
                  </Text>
                </View>
              </View>
            ))
          )}
        </Card>
      </View>

      <TouchableOpacity
        accessibilityRole="button"
        activeOpacity={0.7}
        style={styles.logoutHint}
        onPress={() => router.push("/(vendor)/profile")}
      >
        <Text style={styles.logoutHintText}>Manage your account in Profile</Text>
        <MaterialCommunityIcons name="chevron-right" size={14} color={colors.primary} />
      </TouchableOpacity>
    </Screen>
  );
}

const styles = StyleSheet.create({
  profileHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  profileIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.chip,
    backgroundColor: colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  profileHeaderText: {
    flex: 1,
  },
  profileName: {
    fontSize: 14,
    fontWeight: "700",
    fontFamily: fonts.bold,
    color: colors.text,
  },
  profileId: {
    fontSize: 10,
    color: colors.muted,
    marginTop: 2,
    fontFamily: fonts.regular,
  },
  cardPadding: {
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  queueItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  queueItemLast: {
    borderBottomWidth: 0,
  },
  queueMain: {
    flex: 1,
    gap: 3,
  },
  queueTitle: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: fonts.semibold,
    color: colors.text,
  },
  queueSubtitle: {
    fontSize: 10,
    color: colors.muted,
    fontFamily: fonts.regular,
  },
  activityItem: {
    flexDirection: "row",
    gap: 11,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  activityIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  activityBody: {
    flex: 1,
    gap: 3,
  },
  activityText: {
    fontSize: 11,
    lineHeight: 16,
    color: colors.text,
    fontFamily: fonts.regular,
  },
  activityTime: {
    fontSize: 9,
    color: colors.muted,
    fontFamily: fonts.regular,
  },
  logoutHint: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 4,
  },
  logoutHintText: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: fonts.semibold,
    color: colors.primary,
  },
});
