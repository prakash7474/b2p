import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Card, EmptyState, StatCard, StatGrid } from "@/src/components/cards";
import { Button, FieldInput, SecondaryButton } from "@/src/components/controls";
import { LoadingScreen, Screen } from "@/src/components/layout";
import { AlertBox, BarMeter, StatusPill } from "@/src/components/status";
import { api, type VendorBatch } from "@/src/lib/api";
import { messageOf, useAuth } from "@/src/lib/auth";
import { colors, fonts, riskColor } from "@/src/theme";

type Notice = { type: "success" | "error"; text: string } | null;

export default function BatchesScreen() {
  const { vendorId } = useAuth();

  const [batches, setBatches] = useState<VendorBatch[] | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [saleKg, setSaleKg] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!vendorId) return;

    try {
      setBatches(await api.getBatches(vendorId));
    } catch (caught) {
      setNotice({ type: "error", text: messageOf(caught) });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [vendorId]);

  useEffect(() => {
    void load();
  }, [load]);

  const receive = async (batchId: string) => {
    try {
      setBusyId(batchId);
      setNotice(null);
      const result = await api.receiveBatch(vendorId, batchId);
      setNotice({ type: "success", text: result.message ?? "Batch received." });
      await load();
    } catch (caught) {
      setNotice({ type: "error", text: messageOf(caught) });
    } finally {
      setBusyId("");
    }
  };

  const sell = async (batchId: string) => {
    const kg = Number(saleKg[batchId]);
    if (!Number.isFinite(kg) || kg <= 0) {
      setNotice({ type: "error", text: "Enter the kg sold (greater than 0)." });
      return;
    }
    try {
      setBusyId(batchId);
      setNotice(null);
      const result = await api.recordSale(vendorId, batchId, kg);
      const alert = result.alerts?.[0]?.alert_message;
      setNotice({ type: alert ? "error" : "success", text: alert ?? `Recorded sale of ${kg} kg.` });
      setSaleKg((prev) => ({ ...prev, [batchId]: "" }));
      await load();
    } catch (caught) {
      setNotice({ type: "error", text: messageOf(caught) });
    } finally {
      setBusyId("");
    }
  };

  const sendBack = async (batch: VendorBatch) => {
    const id = String(batch.batch_id ?? "");
    try {
      setBusyId(id);
      setNotice(null);
      const reason = batch.expired ? "expired" : `spoilage risk ${String(batch.risk_label ?? "").toLowerCase()}`;
      const result = await api.returnBatch(vendorId, id, reason);
      setNotice({ type: "success", text: result.message ?? "Batch returned." });
      await load();
    } catch (caught) {
      setNotice({ type: "error", text: messageOf(caught) });
    } finally {
      setBusyId("");
    }
  };

  if (loading) {
    return <LoadingScreen label="Loading batches..." />;
  }

  const all = batches ?? [];
  // Assigned batches count as stock only after the vendor confirms receipt.
  const inStore = all.filter((batch) => batch.status !== "assigned");
  const low = inStore.filter((batch) => batch.low_stock);
  const refresh = () => {
    setRefreshing(true);
    void load();
  };

  return (
    <Screen
      title="My Batches"
      subtitle="Stock left in each batch you hold, with its spoilage risk"
      action={
        <SecondaryButton
          label="Refresh"
          compact
          icon={<MaterialCommunityIcons name="refresh" size={13} color={colors.text} />}
          onPress={refresh}
          loading={refreshing}
        />
      }
      refreshing={refreshing}
      onRefresh={refresh}
      keyboardShouldPersistTaps="handled"
    >
      {notice ? <AlertBox type={notice.type} message={notice.text} /> : null}

      {low.map((batch) => (
        <AlertBox
          key={`alert-${batch.batch_id}`}
          type="error"
          message={`Batch ${batch.batch_id} (${batch.product_name}) is low: ${batch.remaining_kg} kg left, threshold ${batch.threshold_kg} kg.`}
        />
      ))}

      <StatGrid>
        <StatCard
          icon={(color) => <MaterialCommunityIcons name="package-variant" size={18} color={color} />}
          label="Batches Held"
          value={inStore.length}
          sub={`${inStore.reduce((sum, b) => sum + Number(b.remaining_kg ?? 0), 0).toFixed(1)} kg`}
        />
        <StatCard
          icon={(color) => <MaterialCommunityIcons name="alert-decagram-outline" size={18} color={color} />}
          label="Below Threshold"
          value={low.length}
          sub={low.length > 0 ? "request a batch" : "all healthy"}
          tone={low.length > 0 ? "danger" : "success"}
        />
      </StatGrid>

      <Card>
        {all.length === 0 ? (
          <EmptyState
            icon={<MaterialCommunityIcons name="package-variant" size={26} color={colors.muted} />}
            title="No batches assigned"
            text="Request batches from the Forecast tab. Assigned batches appear here."
          />
        ) : (
          all.map((batch, index) => {
            const id = String(batch.batch_id ?? index);
            const remaining = Number(batch.remaining_kg ?? 0);
            const volume = Number(batch.volume_kg ?? remaining) || 1;
            const assigned = batch.status === "assigned";
            const label = String(batch.risk_label ?? "");

            return (
              <View key={id} style={[styles.row, index === all.length - 1 && styles.rowLast]}>
                <View style={styles.header}>
                  <View style={styles.headerText}>
                    <Text style={styles.title}>{String(batch.product_name ?? "Batch")}</Text>
                    <Text style={styles.meta}>Batch {id}</Text>
                  </View>
                  <StatusPill
                    status={assigned ? "pending" : batch.expired ? "rejected" : "active"}
                    label={assigned ? "Awaiting your confirmation" : batch.expired ? "Expired" : "In store"}
                  />
                </View>

                <BarMeter
                  label="Remaining"
                  value={`${remaining} / ${volume} kg`}
                  percent={(remaining / volume) * 100}
                  color={batch.low_stock ? colors.danger : colors.primary}
                />
                <Text style={styles.meta}>Alert threshold {Number(batch.threshold_kg ?? 0)} kg</Text>

                {batch.action ? <Text style={styles.meta}>{batch.action}</Text> : null}

                {batch.risk_score !== undefined ? (
                  <BarMeter
                    label={`Spoilage risk · ${label}`}
                    value={`${Number(batch.risk_score).toFixed(1)}%`}
                    percent={Number(batch.risk_score)}
                    color={riskColor(label)}
                  />
                ) : null}

                {assigned ? (
                  <Button
                    label="Confirm"
                    compact
                    loading={busyId === id}
                    icon={<MaterialCommunityIcons name="check-circle-outline" size={13} color="#fff" />}
                    onPress={() => void receive(id)}
                  />
                ) : batch.expired ? (
                  // Expired stock cannot be sold (the backend refuses it), only sent back.
                  <Button
                    label="Return batch"
                    tone="danger"
                    compact
                    loading={busyId === id}
                    icon={<MaterialCommunityIcons name="keyboard-return" size={13} color={colors.danger} />}
                    onPress={() => void sendBack(batch)}
                  />
                ) : (
                  <View style={styles.saleRow}>
                    <View style={styles.saleInput}>
                      <FieldInput
                        value={saleKg[id] ?? ""}
                        onChangeText={(text) => setSaleKg((prev) => ({ ...prev, [id]: text }))}
                        placeholder="kg sold"
                        keyboardType="decimal-pad"
                      />
                    </View>
                    <SecondaryButton
                      label="Record sale"
                      compact
                      loading={busyId === id}
                      icon={<MaterialCommunityIcons name="cart-minus" size={13} color={colors.text} />}
                      onPress={() => void sell(id)}
                    />
                  </View>
                )}
              </View>
            );
          })
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    padding: 15,
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 4,
  },
  headerText: {
    flex: 1,
    gap: 3,
  },
  title: {
    fontSize: 12,
    fontWeight: "700",
    fontFamily: fonts.bold,
    color: colors.text,
  },
  meta: {
    fontSize: 10,
    color: colors.muted,
    fontFamily: fonts.regular,
  },
  saleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  saleInput: {
    flex: 1,
  },
});
