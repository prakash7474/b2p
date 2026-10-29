import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Card, EmptyState, StatCard, StatGrid } from "@/src/components/cards";
import { Button, FieldInput, SecondaryButton } from "@/src/components/controls";
import { LoadingScreen, Screen } from "@/src/components/layout";
import { AlertBox, BarMeter } from "@/src/components/status";
import { api, type VendorBatch } from "@/src/lib/api";
import { messageOf, useAuth } from "@/src/lib/auth";
import { colors, fonts, radius } from "@/src/theme";

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
  // Assigned batches count as stock only after the vendor confirms receipt; expired ones never do.
  const inStore = all.filter((batch) => batch.status !== "assigned" && !batch.expired);
  const expired = all.filter((batch) => batch.expired);
  const low = inStore.filter((batch) => batch.low_stock);
  const atRisk = all.filter((batch) => batch.expired || batch.risk_label === "High");
  const heldKg = all
    .filter((batch) => !batch.expired)
    .reduce((sum, b) => sum + Number(b.remaining_kg ?? 0), 0);
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

      {expired.length > 0 ? (
        <AlertBox
          type="error"
          message={`${expired.length} batch${expired.length === 1 ? " has" : "es have"} expired (${expired
            .map((b) => b.product_name)
            .join(", ")}). They can no longer be sold; return them below.`}
        />
      ) : null}

      <StatGrid>
        <StatCard
          icon={(color) => <MaterialCommunityIcons name="package-variant" size={18} color={color} />}
          label="Total batches"
          value={all.length}
          sub={`${heldKg.toFixed(1)} kg good stock`}
        />
        <StatCard
          icon={(color) => <MaterialCommunityIcons name="alert-octagon-outline" size={18} color={color} />}
          label="At risk"
          value={atRisk.length}
          sub={atRisk.length > 0 ? "high spoilage risk or expired" : "none"}
          tone={atRisk.length > 0 ? "danger" : "success"}
        />
        <StatCard
          icon={(color) => <MaterialCommunityIcons name="alert-decagram-outline" size={18} color={color} />}
          label="Below threshold"
          value={low.length}
          sub={low.length > 0 ? "running low" : "all healthy"}
          tone={low.length > 0 ? "warning" : "success"}
        />
      </StatGrid>

      <Button
        label="Request Batches"
        full
        icon={<MaterialCommunityIcons name="truck-delivery-outline" size={18} color={colors.primary} />}
        onPress={() => router.push("/(vendor)/request-batches")}
      />

      <Card>
        {all.length === 0 ? (
          <EmptyState
            icon={<MaterialCommunityIcons name="package-variant" size={26} color={colors.muted} />}
            title="No batches yet"
            text="Tap Request Batches above. Batches the admin assigns to you appear here."
          />
        ) : (
          all.map((batch, index) => {
            const id = String(batch.batch_id ?? index);
            const remaining = Number(batch.remaining_kg ?? 0);
            const volume = Number(batch.volume_kg ?? remaining) || 1;
            const assigned = batch.status === "assigned";
            const hoursLeft = Number(batch.hours_to_expiry ?? 0);

            return (
              <View key={id} style={[styles.row, index === all.length - 1 && styles.rowLast]}>
                <View style={styles.header}>
                  <View style={styles.headerText}>
                    <Text style={styles.title}>{String(batch.product_name ?? "Batch")}</Text>
                    <Text style={styles.meta}>
                      {assigned
                        ? "On its way: confirm when it arrives"
                        : batch.expired
                          ? "Expired"
                          : `${Math.round(hoursLeft)} h of shelf life left`}
                    </Text>
                  </View>
                  {batch.expired ? (
                    <RiskBadge label="Expired" />
                  ) : batch.risk_label ? (
                    <RiskBadge label={batch.risk_label} />
                  ) : null}
                </View>

                <BarMeter
                  label={batch.low_stock && !assigned ? "Remaining · low" : "Remaining"}
                  value={`${remaining} / ${volume} kg`}
                  percent={(remaining / volume) * 100}
                  color={batch.low_stock ? colors.danger : colors.primary}
                />

                {assigned ? (
                  <Button
                    label="Confirm received"
                    compact
                    loading={busyId === id}
                    icon={<MaterialCommunityIcons name="check-circle-outline" size={18} color={colors.primary} />}
                    onPress={() => void receive(id)}
                  />
                ) : batch.expired ? (
                  // Expired stock cannot be sold (the backend refuses it), only sent back.
                  <Button
                    label="Return batch"
                    tone="danger"
                    compact
                    loading={busyId === id}
                    icon={<MaterialCommunityIcons name="keyboard-return" size={18} color={colors.danger} />}
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
                        accessibilityLabel={`Kilograms of ${batch.product_name} sold`}
                      />
                    </View>
                    <SecondaryButton
                      label="Record sale"
                      compact
                      loading={busyId === id}
                      icon={<MaterialCommunityIcons name="cart-minus" size={18} color={colors.text} />}
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

const RISK_BADGES: Record<string, { label: string; fg: string; bg: string }> = {
  High: { label: "High risk", fg: "#fff", bg: colors.danger },
  Expired: { label: "Expired", fg: "#fff", bg: colors.danger },
  Medium: { label: "Medium risk", fg: colors.warning, bg: colors.butter },
  Low: { label: "Low risk", fg: colors.primary, bg: colors.successBg },
};

/** Spoilage risk as a filled badge, so a risky batch stands out at a glance. */
function RiskBadge({ label }: { label: string }) {
  const badge = RISK_BADGES[label] ?? RISK_BADGES.Low;
  return (
    <View style={[styles.badge, { backgroundColor: badge.bg }]}>
      <MaterialCommunityIcons
        name={label === "Low" ? "shield-check-outline" : "alert-octagon-outline"}
        size={15}
        color={badge.fg}
      />
      <Text style={[styles.badgeText, { color: badge.fg }]}>{badge.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    padding: 16,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  headerText: {
    flex: 1,
    gap: 3,
  },
  title: {
    fontSize: 17,
    fontFamily: fonts.bold,
    color: colors.text,
  },
  meta: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: fonts.regular,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  badgeText: {
    fontSize: 13,
    fontFamily: fonts.bold,
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
