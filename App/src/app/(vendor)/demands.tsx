import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Card, EmptyState, SectionTitle } from "@/src/components/cards";
import {
  Button,
  FieldInput,
  FormField,
  SecondaryButton,
  SelectField,
} from "@/src/components/controls";
import { LoadingScreen, Screen } from "@/src/components/layout";
import { AlertBox, StatusPill } from "@/src/components/status";
import { api, type DemandRequest, type InventoryItem } from "@/src/lib/api";
import { messageOf, useAuth } from "@/src/lib/auth";
import { colors, fonts } from "@/src/theme";

type Notice = { type: "success" | "error"; text: string } | null;

function shortId(id: unknown): string {
  const value = String(id ?? "");
  return value.length > 8 ? `#${value.slice(-6)}` : value ? `#${value}` : "#—";
}

function demandItems(demand: DemandRequest): string {
  const items = demand.items ?? [];
  if (items.length === 0) return "No items";
  return items
    .map((item) => `${item.product_name ?? item.product_id ?? "Item"} × ${item.quantity ?? 0}`)
    .join(", ");
}

export default function DemandsScreen() {
  const { vendorId } = useAuth();

  const [demands, setDemands] = useState<DemandRequest[] | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [priority, setPriority] = useState("normal");

  const load = useCallback(async () => {
    if (!vendorId) return;

    const [demandData, inventoryData] = await Promise.all([
      api.getDemands(vendorId),
      api.getInventory(vendorId).catch(() => [] as InventoryItem[]),
    ]);

    setDemands(demandData);
    setInventory(inventoryData);
    setLoading(false);
    setRefreshing(false);
  }, [vendorId]);

  useEffect(() => {
    void load().catch((caught) => {
      setNotice({ type: "error", text: messageOf(caught) });
      setLoading(false);
      setRefreshing(false);
    });
  }, [load]);

  const productOptions = useMemo(
    () =>
      inventory
        .filter((item) => item.product_id)
        .map((item) => ({
          value: String(item.product_id),
          label: `${item.product_name ?? item.product_id} (${item.product_id})`,
        })),
    [inventory],
  );

  const createDemand = async () => {
    if (!productId) {
      setNotice({ type: "error", text: "Select a product for the demand." });
      return;
    }

    const parsed = Number(quantity);
    if (!quantity.trim() || !Number.isFinite(parsed) || parsed <= 0) {
      setNotice({ type: "error", text: "Quantity must be greater than 0." });
      return;
    }

    try {
      setBusy(true);
      setNotice(null);
      const result = await api.createDemand(vendorId, {
        items: [{ product_id: productId, quantity: parsed }],
        priority,
      });
      setNotice({
        type: "success",
        text: result.message ?? "Demand created.",
      });
      setQuantity("");
      setProductId("");
      await load();
    } catch (caught) {
      setNotice({ type: "error", text: messageOf(caught) });
    } finally {
      setBusy(false);
    }
  };

  const confirmDemand = async (demand: DemandRequest) => {
    const id = demand._id;
    if (!id) return;

    try {
      setBusy(true);
      setNotice(null);
      const result = await api.confirmDemand(vendorId, String(id));
      setNotice({ type: "success", text: result.message ?? "Demand confirmed." });
      await load();
    } catch (caught) {
      setNotice({ type: "error", text: messageOf(caught) });
    } finally {
      setBusy(false);
    }
  };

  const syncInventory = async () => {
    try {
      setBusy(true);
      setNotice(null);
      const result = await api.syncInventory(vendorId);
      setNotice({
        type: "success",
        text: `${result.message ?? "Inventory synchronized."} (${result.synced_demands ?? 0} demands)`,
      });
      await load();
    } catch (caught) {
      setNotice({ type: "error", text: messageOf(caught) });
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <LoadingScreen label="Loading demands..." />;
  }

  const demandList = demands ?? [];
  const pending = demandList.filter(
    (demand) => String(demand.status ?? "").toLowerCase() === "pending",
  ).length;

  return (
    <Screen
      title="Demand Center"
      subtitle="Create and track your restock demands"
      action={
        <SecondaryButton
          label="Refresh"
          compact
          icon={<MaterialCommunityIcons name="refresh" size={13} color={colors.text} />}
          onPress={() => {
            setRefreshing(true);
            void load().catch((caught) => {
              setNotice({ type: "error", text: messageOf(caught) });
              setRefreshing(false);
            });
          }}
          loading={refreshing}
        />
      }
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void load().catch((caught) => {
          setNotice({ type: "error", text: messageOf(caught) });
          setRefreshing(false);
        });
      }}
    >
      {notice ? <AlertBox type={notice.type} message={notice.text} /> : null}

      <View>
        <SectionTitle title="Create Demand" subtitle="Raise a new restock requirement" />
        <Card style={styles.formCard}>
          {productOptions.length === 0 ? (
            <EmptyState
              icon={<MaterialCommunityIcons name="cart-outline" size={24} color={colors.muted} />}
              title="No products mapped"
              text="Products appear here once they are mapped to your shop's inventory."
            />
          ) : (
            <>
              <SelectField
                label="Product *"
                value={productId}
                onValueChange={setProductId}
                options={productOptions}
                placeholder="Select product"
              />

              <View style={styles.formRow}>
                <View style={styles.formColumn}>
                  <FormField label="Quantity *">
                    <FieldInput
                      value={quantity}
                      onChangeText={setQuantity}
                      placeholder="e.g. 10"
                      keyboardType="number-pad"
                    />
                  </FormField>
                </View>

                <View style={styles.formColumn}>
                  <SelectField
                    label="Priority"
                    value={priority}
                    onValueChange={setPriority}
                    placeholder="Priority"
                    options={[
                      { label: "Normal", value: "normal" },
                      { label: "High", value: "high" },
                      { label: "Urgent", value: "urgent" },
                    ]}
                  />
                </View>
              </View>

              <Button
                label="Create Demand"
                icon={<MaterialCommunityIcons name="file-plus-outline" size={14} color="#fff" />}
                onPress={() => void createDemand()}
                loading={busy}
                full
              />
            </>
          )}
        </Card>
      </View>

      <View>
        <SectionTitle
          title="Demand Requests"
          subtitle={`${demandList.length} requests · ${pending} pending`}
        />

        <Card>
          <View style={styles.listHeader}>
            <Text style={styles.listHeaderText}>Restock requests</Text>
            <Button
              label="Sync Inventory"
              compact
              tone="secondary"
              icon={<MaterialCommunityIcons name="sync" size={13} color={colors.text} />}
              onPress={() => void syncInventory()}
              loading={busy}
              disabled={demandList.length === 0}
            />
          </View>

          {demandList.length === 0 ? (
            <EmptyState
              icon={<MaterialCommunityIcons name="clipboard-text-outline" size={26} color={colors.muted} />}
              title="No demand requests"
              text="Create your first demand using the form above."
            />
          ) : (
            demandList.map((demand, index) => {
              const status = String(demand.status ?? "pending");
              const isPending = status.toLowerCase() === "pending";

              return (
                <View
                  key={String(demand._id ?? index)}
                  style={[
                    styles.requestRow,
                    index === demandList.length - 1 && styles.rowLast,
                  ]}
                >
                  <View style={styles.requestMain}>
                    <View style={styles.requestTitleRow}>
                      <Text style={styles.requestTitle}>
                        Request {shortId(demand._id)}
                      </Text>
                      <StatusPill status={status} />
                    </View>
                    <Text style={styles.requestItems}>{demandItems(demand)}</Text>
                    <Text style={styles.requestMeta}>
                      {String(demand.priority ?? "normal")} priority
                    </Text>
                  </View>

                  {isPending ? (
                    <SecondaryButton
                      label="Confirm"
                      compact
                      icon={
                        <MaterialCommunityIcons
                          name="check-circle-outline"
                          size={13}
                          color={colors.text}
                        />
                      }
                      onPress={() => void confirmDemand(demand)}
                      loading={busy}
                    />
                  ) : null}
                </View>
              );
            })
          )}
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  formCard: {
    padding: 16,
  },
  formRow: {
    flexDirection: "row",
    gap: 12,
  },
  formColumn: {
    flex: 1,
  },
  listHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  listHeaderText: {
    fontSize: 12,
    fontWeight: "700",
    fontFamily: fonts.bold,
    color: colors.text,
  },
  requestRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  requestMain: {
    flex: 1,
    gap: 4,
  },
  requestTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  requestTitle: {
    fontSize: 11,
    fontWeight: "700",
    fontFamily: fonts.bold,
    color: colors.text,
  },
  requestItems: {
    fontSize: 11,
    color: colors.text,
    fontFamily: fonts.regular,
  },
  requestMeta: {
    fontSize: 10,
    color: colors.muted,
    fontFamily: fonts.regular,
  },
});
