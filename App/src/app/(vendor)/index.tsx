import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Card, EmptyState, SectionTitle, StatCard, StatGrid } from "@/src/components/cards";
import { LoadingScreen, Screen } from "@/src/components/layout";
import { Button, SecondaryButton } from "@/src/components/controls";
import { AlertBox, BarMeter, RiskBadge } from "@/src/components/status";
import { api, madeLabel, type ActivityLog, type RiskReport, type ShopAlert } from "@/src/lib/api";
import { messageOf, useAuth } from "@/src/lib/auth";
import { colors, fonts, radius, riskColor } from "@/src/theme";

type Notice = { type: "success" | "error"; text: string } | null;

export default function DashboardScreen() {
  const { vendor, vendorId, session } = useAuth();

  const [report, setReport] = useState<RiskReport | null>(null);
  const [logs, setLogs] = useState<ActivityLog[] | null>(null);
  const [restockKg, setRestockKg] = useState<number | null>(null);
  const [alerts, setAlerts] = useState<ShopAlert[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    if (!vendorId) return;

    try {
      // The spoilage report lists every held batch with stock + risk, plus the shop aggregate.
      const [riskData, logData] = await Promise.all([api.getRisk(vendorId), api.getLogs()]);
      setReport(riskData);
      setLogs(logData);
      // Alerts and the restock figure are extras: a failure there must not hide the rest.
      api.getAlerts(vendorId).then(setAlerts).catch(() => setAlerts([]));
      api.getForecast(vendorId)
        .then((result) => setRestockKg(Number(result.summary?.refill_quantity ?? 0)))
        .catch(() => setRestockKg(null));
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

  const confirm = async (batchId: string) => {
    try {
      setBusyId(batchId);
      setNotice(null);
      const result = await api.receiveBatch(vendorId, batchId);
      setNotice({ type: "success", text: result.message ?? "Assignment confirmed." });
      await load();
    } catch (caught) {
      setNotice({ type: "error", text: messageOf(caught) });
    } finally {
      setBusyId("");
    }
  };

  const refresh = () => {
    setRefreshing(true);
    void load();
  };

  if (loading) {
    return <LoadingScreen label="Loading dashboard..." />;
  }

  const batches = report?.evaluations ?? [];
  const toConfirm = batches.filter((batch) => batch.status === "assigned");
  // Assigned batches count as stock only after the vendor confirms receipt; expired ones never do.
  const inStore = batches.filter((batch) => batch.status !== "assigned" && !batch.expired);
  const currentStock = inStore.reduce((sum, batch) => sum + Number(batch.remaining_kg ?? 0), 0);
  const lowStock = inStore.filter((batch) => batch.low_stock).length;
  const aggregate = report?.aggregateScore;
  const aggregateLabel = report?.aggregateLabel;

  const ownLogs = (logs ?? []).filter((log) => {
    const blob = JSON.stringify(log).toLowerCase();
    return [vendorId, session?.email, vendor?.shop_name]
      .filter(Boolean)
      .some((needle) => blob.includes(String(needle).toLowerCase()));
  });

  return (
    <Screen
      title={String(vendor?.shop_name ?? "Dashboard")}
      subtitle="Your shop at a glance: deliveries to confirm, stock and risk"
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
    >
      {notice ? <AlertBox type={notice.type} message={notice.text} /> : null}

      {alerts.length > 0 ? (
        <View>
          <SectionTitle title="Needs attention" subtitle="Your stock right now, most urgent first" />
          <Card style={styles.alertCard}>
            {alerts.map((alert, index) => (
              <View key={`${alert.kind}-${index}`} style={[styles.alertRow, index === alerts.length - 1 && styles.rowLast]}>
                <MaterialCommunityIcons
                  name={alert.level === "info" ? "truck-delivery-outline" : "alert-circle-outline"}
                  size={20}
                  color={ALERT_COLORS[alert.level]}
                />
                <Text style={[styles.alertText, alert.level !== "info" && { color: ALERT_COLORS[alert.level] }]}>
                  {alert.text}
                </Text>
              </View>
            ))}
            <View style={styles.alertActions}>
              <Button label="View batches" compact onPress={() => router.push("/(vendor)/inventory")} />
              <SecondaryButton label="Request batches" compact onPress={() => router.push("/(vendor)/request-batches")} />
            </View>
          </Card>
        </View>
      ) : null}

      <StatGrid>
        <StatCard
          icon={(color) => <MaterialCommunityIcons name="scale" size={18} color={color} />}
          label="Current Stock"
          value={currentStock.toFixed(1)}
          sub={`kg in ${inStore.length} batches`}
          action={{ label: "View batches", onPress: () => router.push("/(vendor)/inventory") }}
        />
        <StatCard
          icon={(color) => <MaterialCommunityIcons name="shield-alert-outline" size={18} color={color} />}
          label="Overall Risk"
          value={aggregate == null ? "—" : `${aggregate.toFixed(1)}%`}
          sub={aggregateLabel ?? "no batches"}
          tone={aggregateLabel === "High" ? "danger" : aggregateLabel === "Medium" ? "warning" : "success"}
          action={{ label: "Spoilage risk", onPress: () => router.push("/(vendor)/risk") }}
        />
        <StatCard
          icon={(color) => <MaterialCommunityIcons name="truck-delivery-outline" size={18} color={color} />}
          label="Restock Needed"
          value={restockKg == null ? "—" : restockKg.toFixed(1)}
          sub={restockKg == null ? "forecast unavailable" : restockKg > 0 ? "kg for this window" : "kg, stock covers demand"}
          tone={restockKg ? "danger" : "success"}
          action={{ label: "Demand forecast", onPress: () => router.push("/(vendor)/forecast") }}
        />
        <StatCard
          icon={(color) => <MaterialCommunityIcons name="alert-decagram-outline" size={18} color={color} />}
          label="Low Stock"
          value={lowStock}
          sub={lowStock > 0 ? "below threshold" : "all healthy"}
          tone={lowStock > 0 ? "danger" : "success"}
          action={{ label: "View batches", onPress: () => router.push("/(vendor)/inventory") }}
        />
      </StatGrid>

      <View>
        <SectionTitle
          title="Confirm Assigned Batches"
          subtitle="The admin assigned these to you. Confirm to add them to your stock."
        />
        <Card>
          {toConfirm.length === 0 ? (
            <EmptyState
              icon={<MaterialCommunityIcons name="truck-check-outline" size={26} color={colors.muted} />}
              title="Nothing to confirm"
              text="Request batches from the Forecast tab; assigned ones appear here."
            >
              <Button
                label="Request batches"
                compact
                onPress={() => router.push("/(vendor)/request-batches")}
              />
            </EmptyState>
          ) : (
            toConfirm.map((batch, index) => {
              const id = String(batch.batch_id ?? index);
              return (
                <View key={id} style={[styles.row, index === toConfirm.length - 1 && styles.rowLast]}>
                  <View style={styles.rowMain}>
                    <Text style={styles.rowTitle}>{String(batch.product_name ?? "Batch")}</Text>
                    <Text style={styles.rowMeta}>
                      {[`${Number(batch.remaining_kg ?? 0)} kg`, madeLabel(batch.manufactured_at)].filter(Boolean).join(" · ")}
                    </Text>
                  </View>
                  <Button
                    label="Confirm"
                    compact
                    loading={busyId === id}
                    icon={<MaterialCommunityIcons name="check-circle-outline" size={18} color={colors.primary} />}
                    onPress={() => void confirm(id)}
                  />
                </View>
              );
            })
          )}
        </Card>
      </View>

      <View>
        <SectionTitle
          title="Batch Risk"
          subtitle="Spoilage risk of each batch · ≤30% Low, 30-70% Medium, >70% High"
        />
        <Card>
          {aggregate != null ? (
            <View style={[styles.row, styles.aggregateRow]}>
              <View style={styles.rowMain}>
                <Text style={styles.rowTitle}>Overall shop risk</Text>
                <BarMeter percent={aggregate} color={riskColor(aggregateLabel)} />
              </View>
              <View style={styles.aggregateSide}>
                <Text style={[styles.aggregateValue, { color: riskColor(aggregateLabel) }]}>
                  {aggregate.toFixed(1)}%
                </Text>
                {aggregateLabel ? <RiskBadge label={aggregateLabel} /> : null}
              </View>
            </View>
          ) : null}

          {batches.length === 0 ? (
            <EmptyState
              icon={<MaterialCommunityIcons name="shield-alert-outline" size={26} color={colors.muted} />}
              title="No batches assigned"
              text={report?.message ?? "Risk appears once batches are assigned to your shop."}
            />
          ) : (
            batches.map((batch, index) => {
              const label = String(batch.risk_label ?? "Low");
              const score = Number(batch.risk_score ?? 0);
              return (
                <View
                  key={String(batch.batch_id ?? index)}
                  style={[styles.riskRow, index === batches.length - 1 && styles.rowLast]}
                >
                  <View style={styles.riskHeader}>
                    <View style={styles.rowMain}>
                      <Text style={styles.rowTitle}>{String(batch.product_name ?? "Batch")}</Text>
                      <Text style={styles.rowMeta}>
                        {[`${Number(batch.remaining_kg ?? 0)} kg`, madeLabel(batch.manufactured_at)].filter(Boolean).join(" · ")}
                      </Text>
                    </View>
                    <RiskBadge label={batch.expired ? "Expired" : label} />
                  </View>
                  <BarMeter
                    label="Risk score"
                    value={`${score.toFixed(1)}%`}
                    percent={score}
                    color={riskColor(label)}
                  />
                </View>
              );
            })
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
                style={[styles.activityItem, index === Math.min(ownLogs.length, 6) - 1 && styles.rowLast]}
              >
                <View style={styles.activityIcon}>
                  <MaterialCommunityIcons name="file-document-outline" size={14} color={colors.primary} />
                </View>
                <View style={styles.rowMain}>
                  <Text style={styles.activityText}>
                    {String(log.message ?? log.action ?? log.event ?? "System activity recorded")}
                  </Text>
                  <Text style={styles.rowMeta}>{String(log.created_at ?? log.timestamp ?? "")}</Text>
                </View>
              </View>
            ))
          )}
        </Card>
      </View>
    </Screen>
  );
}

const ALERT_COLORS = { danger: colors.danger, warning: colors.warning, info: colors.primary };

const styles = StyleSheet.create({
  alertCard: {
    borderColor: colors.danger,
  },
  alertRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  alertText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 21,
    color: colors.text,
    fontFamily: fonts.medium,
  },
  alertActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    padding: 16,
    paddingTop: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rowMain: {
    flex: 1,
    gap: 3,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: "700",
    fontFamily: fonts.bold,
    color: colors.text,
  },
  rowMeta: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: fonts.regular,
  },
  aggregateRow: {
    backgroundColor: colors.tableHeader,
  },
  aggregateSide: {
    alignItems: "flex-end",
    gap: 6,
  },
  aggregateValue: {
    fontSize: 26,
    fontFamily: fonts.black,
  },
  riskRow: {
    padding: 14,
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  riskHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  cardPadding: {
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  activityItem: {
    flexDirection: "row",
    gap: 11,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  activityIcon: {
    width: 28,
    height: 28,
    borderRadius: radius.control,
    backgroundColor: colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  activityText: {
    fontSize: 13,
    lineHeight: 16,
    color: colors.text,
    fontFamily: fonts.regular,
  },
});
