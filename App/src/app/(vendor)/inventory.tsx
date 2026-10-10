import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Card, EmptyState, StatCard, StatGrid } from "@/src/components/cards";
import { SecondaryButton, SearchField } from "@/src/components/controls";
import { LoadingScreen, Screen } from "@/src/components/layout";
import { AlertBox, StatusPill } from "@/src/components/status";
import { api, type InventoryItem } from "@/src/lib/api";
import { messageOf, useAuth } from "@/src/lib/auth";
import { colors, fonts, pick } from "@/src/theme";

function isLowStock(item: InventoryItem): boolean {
  const quantity = Number(pick(item, ["quantity", "stock", "available_quantity"], 0));
  const threshold = Number(pick(item, ["reorder_level", "minimum_stock", "threshold"], 10));
  return quantity <= threshold;
}

export default function InventoryScreen() {
  const { vendorId } = useAuth();

  const [items, setItems] = useState<InventoryItem[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    if (!vendorId) return;

    try {
      setError("");
      setItems(await api.getInventory(vendorId));
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

  const filtered = useMemo(() => {
    const list = items ?? [];
    if (!search.trim()) return list;
    const needle = search.toLowerCase();
    return list.filter((item) => JSON.stringify(item).toLowerCase().includes(needle));
  }, [items, search]);

  if (loading) {
    return <LoadingScreen label="Loading inventory..." />;
  }

  const all = items ?? [];
  const low = all.filter(isLowStock).length;

  return (
    <Screen
      title="Inventory"
      subtitle="Current stock levels in your shop"
      action={
        <SecondaryButton
          label="Refresh"
          compact
          icon={<MaterialCommunityIcons name="refresh" size={13} color={colors.text} />}
          onPress={() => {
            setRefreshing(true);
            void load();
          }}
          loading={refreshing}
        />
      }
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void load();
      }}
    >
      <StatGrid>
        <StatCard
          icon={(color) => <MaterialCommunityIcons name="package-variant" size={18} color={color} />}
          label="Products"
          value={all.length}
          sub="mapped items"
        />
        <StatCard
          icon={(color) => <MaterialCommunityIcons name="alert-decagram-outline" size={18} color={color} />}
          label="Low Stock"
          value={low}
          sub={low > 0 ? "reorder suggested" : "all healthy"}
          tone={low > 0 ? "danger" : "success"}
        />
      </StatGrid>

      <SearchField value={search} onChangeText={setSearch} placeholder="Search inventory..." />

      {error ? <AlertBox type="error" message={error} /> : null}

      <Card style={styles.list}>
        {filtered.length === 0 ? (
          <EmptyState
            icon={<MaterialCommunityIcons name="package-variant" size={26} color={colors.muted} />}
            title={all.length === 0 ? "No inventory records" : "No matches"}
            text={
              all.length === 0
                ? "Inventory appears once products are mapped to your shop."
                : "Try a different search term."
            }
          />
        ) : (
          filtered.map((item, index) => {
            const quantity = Number(
              pick(item, ["quantity", "stock", "available_quantity"], 0),
            );
            const threshold = Number(
              pick(item, ["reorder_level", "minimum_stock", "threshold"], 10),
            );
            const lowItem = quantity <= threshold;

            return (
              <View
                key={String(item._id ?? item.product_id ?? index)}
                style={[
                  styles.row,
                  index === filtered.length - 1 && styles.rowLast,
                ]}
              >
                <View style={styles.rowMain}>
                  <Text style={styles.rowTitle}>
                    {String(pick(item, ["product_name", "product_id", "name"], "Unnamed product"))}
                  </Text>
                  <Text style={styles.rowSubtitle}>
                    {String(pick(item, ["product_id", "productId"], "—"))} · reorder level {threshold}
                  </Text>
                </View>

                <View style={styles.rowRight}>
                  <Text style={[styles.quantity, lowItem && styles.quantityLow]}>
                    {quantity}
                  </Text>
                  <StatusPill
                    status={lowItem ? "high" : "active"}
                    label={lowItem ? "Low Stock" : "Healthy"}
                  />
                </View>
              </View>
            );
          })
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rowMain: {
    flex: 1,
    gap: 4,
  },
  rowTitle: {
    fontSize: 12,
    fontWeight: "600",
    fontFamily: fonts.semibold,
    color: colors.text,
  },
  rowSubtitle: {
    fontSize: 10,
    color: colors.muted,
    fontFamily: fonts.regular,
  },
  rowRight: {
    alignItems: "flex-end",
    gap: 6,
  },
  quantity: {
    fontSize: 16,
    fontWeight: "700",
    fontFamily: fonts.bold,
    color: colors.text,
  },
  quantityLow: {
    color: colors.danger,
  },
});
