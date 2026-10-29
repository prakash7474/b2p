import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Card, EmptyState, SectionTitle, StatCard, StatGrid } from "@/src/components/cards";
import { Button, SecondaryButton } from "@/src/components/controls";
import { LoadingScreen, Screen } from "@/src/components/layout";
import { AlertBox, BarMeter, StatusPill } from "@/src/components/status";
import { api, parseServerDate, type BatchChip, type ForecastItem, type ForecastSummary } from "@/src/lib/api";
import { messageOf, useAuth } from "@/src/lib/auth";
import { colors, fonts } from "@/src/theme";

export default function ForecastScreen() {
  const { vendorId } = useAuth();

  const [forecast, setForecast] = useState<ForecastItem[] | null>(null);
  const [summary, setSummary] = useState<ForecastSummary | null>(null);
  const [windowLabel, setWindowLabel] = useState("");
  const [note, setNote] = useState("");
  const [busyBatch, setBusyBatch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!vendorId) return;

    try {
      setError("");
      const result = await api.getForecast(vendorId);
      setForecast(result.forecast);
      setSummary(result.summary ?? null);
      setWindowLabel(result.window ? `this ${result.window.label}` : "this window");
      setNote(result.message ?? "");
    } catch (caught) {
      setError(messageOf(caught));
      setForecast([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [vendorId]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = () => {
    setRefreshing(true);
    void load();
  };

  // One-tap request for a batch the forecast suggests; the forecast then counts it as incoming.
  const requestSuggested = async (batchId: string) => {
    try {
      setBusyBatch(batchId);
      setError("");
      const result = await api.requestBatch(vendorId, batchId);
      setNote(result.message ?? `Requested ${batchId}.`);
      await load();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusyBatch("");
    }
  };

  if (loading) {
    return <LoadingScreen label="Running demand forecast..." />;
  }

  const items = forecast ?? [];

  const chartMax = Math.max(
    1,
    ...items.flatMap((item) => [
      Number(item.predicted_demand ?? 0),
      Number(item.recommended_stock ?? 0),
      Number(item.current_stock ?? 0),
    ]),
  );

  return (
    <Screen
      title="Demand Forecast"
      subtitle={`Expected sales ${windowLabel} for every product, and how much to restock`}
      icon="chart-timeline-variant"
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
      {error ? <AlertBox type="error" message={error} /> : null}
      {!error && note ? <AlertBox type="warning" message={note} /> : null}

      <Button
        label="Request Batches"
        full
        icon={<MaterialCommunityIcons name="truck-delivery-outline" size={18} color={colors.primary} />}
        onPress={() => router.push("/(vendor)/request-batches")}
      />

      <StatGrid>
        <StatCard
          icon={(color) => <MaterialCommunityIcons name="trending-up" size={18} color={color} />}
          label="Total Demand"
          value={Number(summary?.predicted_demand ?? 0).toFixed(1)}
          sub={`kg, all products, ${windowLabel}`}
        />
        <StatCard
          icon={(color) => <MaterialCommunityIcons name="package-variant-closed" size={18} color={color} />}
          label="Sellable Stock"
          value={Number(summary?.current_stock ?? 0).toFixed(1)}
          sub="kg, unexpired"
        />
        <StatCard
          icon={(color) => <MaterialCommunityIcons name="truck-delivery-outline" size={18} color={color} />}
          label="Requested"
          value={Number(summary?.requested_kg ?? 0).toFixed(1)}
          sub="kg awaiting the admin"
        />
        <StatCard
          icon={(color) => <MaterialCommunityIcons name="alert-circle-outline" size={18} color={color} />}
          label="To Restock"
          value={Number(summary?.refill_quantity ?? 0).toFixed(1)}
          sub={`kg across ${summary?.products_to_restock ?? 0} product(s)`}
          tone={(summary?.refill_quantity ?? 0) > 0 ? "danger" : "success"}
        />
      </StatGrid>

      {items.length === 0 && !error ? (
        <Card>
          <EmptyState
            icon={<MaterialCommunityIcons name="chart-timeline-variant" size={26} color={colors.muted} />}
            title="No forecast"
            text="The demand model is not available right now. Try Refresh."
          />
        </Card>
      ) : (
        <>
          <View>
            <SectionTitle
              title="Demand vs Recommended Stock vs Inventory"
              subtitle="Comparison across active product classes"
            />
            <Card style={styles.chartCard}>
              <View style={styles.legend}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: colors.primary }]} />
                  <Text style={styles.legendText}>Demand</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: colors.warning }]} />
                  <Text style={styles.legendText}>Rec. Stock (Demand + Safety)</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: colors.sidebar }]} />
                  <Text style={styles.legendText}>Current Stock</Text>
                </View>
              </View>

              {items.map((item, index) => {
                const demand = Number(item.predicted_demand ?? 0);
                const recStock = Number(item.recommended_stock ?? 0);
                const stock = Number(item.current_stock ?? 0);

                return (
                  <View
                    key={String(item.product_name ?? index)}
                    style={[
                      styles.chartRow,
                      index === items.length - 1 && styles.chartRowLast,
                    ]}
                  >
                    <Text style={styles.chartProduct} numberOfLines={1}>
                      {String(item.product_name ?? "Product")}
                    </Text>
                    <BarMeter
                      label="Demand"
                      value={demand.toFixed(1)}
                      percent={(demand / chartMax) * 100}
                      color={colors.primary}
                    />
                    <BarMeter
                      label="Rec. Stock"
                      value={recStock.toFixed(1)}
                      percent={(recStock / chartMax) * 100}
                      color={colors.warning}
                    />
                    <BarMeter
                      label="Current Stock"
                      value={stock.toFixed(1)}
                      percent={(stock / chartMax) * 100}
                      color={colors.sidebar}
                    />
                  </View>
                );
              })}
            </Card>
          </View>

          <View>
            <SectionTitle
              title="Demand & Refill"
              subtitle="Restock = demand + safety stock − sellable stock − already requested"
            />
            <Card>
              {items.map((item, index) => {
                const demand = Number(item.predicted_demand ?? 0);
                const safety = Number(item.safety_stock ?? 0);
                const current = Number(item.current_stock ?? 0);
                const requested = Number(item.requested_kg ?? 0);
                const refill = Number(item.refill_quantity ?? 0);
                const restock = Boolean(item.restock_needed);
                const suggested = item.suggested_batches ?? [];
                const uncovered = Number(item.uncovered_kg ?? 0);

                return (
                  <View
                    key={String(item.product_name ?? index)}
                    style={[
                      styles.detailRow,
                      index === items.length - 1 && styles.chartRowLast,
                    ]}
                  >
                    <View style={styles.detailHeader}>
                      <Text style={styles.detailProduct}>
                        {String(item.product_name ?? "Product")}
                      </Text>
                      <StatusPill status={restock ? "high" : "active"} label={String(item.status ?? "")} />
                    </View>

                    <View style={styles.metrics}>
                      <Metric label="Demand" value={demand} />
                      <Metric label="Safety Stock" value={safety} />
                      <Metric label="Rec. Stock" value={Number(item.recommended_stock ?? 0)} highlight />
                      <Metric label="Current" value={current} />
                    </View>

                    <View style={[styles.mismatchAlert, restock ? styles.mismatchDeficit : styles.mismatchBalanced]}>
                      <MaterialCommunityIcons
                        name={restock ? "alert-circle-outline" : "check-circle-outline"}
                        size={15}
                        color={restock ? colors.danger : colors.success}
                      />
                      <Text style={[styles.mismatchText, { color: restock ? colors.danger : colors.success }]}>
                        {restock
                          ? `Restock ${refill} kg = demand ${demand} + safety ${safety} − stock ${current}${requested ? ` − requested ${requested}` : ""}.`
                          : `Stock ${current} kg${requested ? ` + requested ${requested} kg` : ""} covers demand ${demand} kg plus ${safety} kg safety stock.`}
                      </Text>
                    </View>

                    {item.history_source === "baseline" ? (
                      <Text style={styles.coldStart}>
                        No sales here yet: baseline for a shop like yours (location, weather, festivals). It adapts after a week of sales.
                      </Text>
                    ) : null}

                    {suggested.length > 0 ? (
                      <View style={styles.suggestions}>
                        <Text style={styles.suggestTitle}>Batches that cover this restock</Text>
                        {suggested.map((batch) => (
                          <View key={String(batch.batch_id)} style={styles.suggestRow}>
                            <Text style={styles.suggestText}>
                              {String(batch.batch_id)} · {Number(batch.remaining_kg ?? 0)} kg
                              {batch.hours_to_expiry !== undefined ? ` · ${Math.round(Number(batch.hours_to_expiry))} h shelf life left` : ""}
                            </Text>
                            <SecondaryButton
                              label="Request"
                              compact
                              loading={busyBatch === batch.batch_id}
                              onPress={() => void requestSuggested(String(batch.batch_id))}
                            />
                          </View>
                        ))}
                      </View>
                    ) : null}
                    {restock && uncovered > 0 ? (
                      <Text style={styles.coldStart}>
                        {uncovered} kg has no available batch yet: the manufacturer needs to make more.
                      </Text>
                    ) : null}

                    <View style={styles.chips}>
                      {(item.batches ?? []).map((batch) => (
                        <BatchChipView key={String(batch.batch_id)} batch={batch} />
                      ))}
                    </View>
                  </View>
                );
              })}
            </Card>
          </View>
        </>
      )}
    </Screen>
  );
}

function BatchChipView({ batch }: { batch: BatchChip }) {
  const when = batch.received_at ? parseServerDate(batch.received_at) : null;
  return (
    <View style={styles.chip}>
      <Text style={styles.chipId}>{String(batch.batch_id ?? "batch")}</Text>
      <Text style={styles.chipMeta}>
        {Number(batch.remaining_kg ?? 0)} kg
        {when && !Number.isNaN(when.getTime()) ? ` · ${when.toLocaleDateString()}` : ""}
        {batch.expired ? " · expired" : ""}
      </Text>
    </View>
  );
}

function Metric({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, highlight && styles.metricValueHighlight]}>
        {Number(value).toFixed(Number(value) % 1 === 0 ? 0 : 1)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chartCard: {
    padding: 16,
  },
  legend: {
    flexDirection: "row",
    gap: 16,
    marginBottom: 14,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendDot: {
    width: 9,
    height: 9,
    borderRadius: 3,
  },
  legendText: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: fonts.regular,
  },
  chartRow: {
    paddingBottom: 14,
    marginBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  chartRowLast: {
    borderBottomWidth: 0,
    marginBottom: 0,
    paddingBottom: 0,
  },
  chartProduct: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: fonts.semibold,
    color: colors.text,
    marginBottom: 8,
  },
  detailRow: {
    padding: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
    gap: 10,
  },
  detailHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  detailProduct: {
    fontSize: 14,
    fontWeight: "700",
    fontFamily: fonts.bold,
    color: colors.text,
    flexShrink: 1,
  },
  metrics: {
    flexDirection: "row",
    gap: 8,
  },
  metric: {
    flex: 1,
    backgroundColor: colors.tableHeader,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 9,
    gap: 3,
  },
  metricLabel: {
    fontSize: 12,
    color: colors.muted,
    fontFamily: fonts.regular,
  },
  metricValue: {
    fontSize: 15,
    fontWeight: "600",
    fontFamily: fonts.semibold,
    color: colors.text,
  },
  metricValueHighlight: {
    color: colors.primaryDark,
    fontWeight: "700",
    fontFamily: fonts.bold,
  },
  mismatchAlert: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
  },
  mismatchDeficit: {
    backgroundColor: colors.dangerBg,
    borderColor: colors.danger,
  },
  mismatchText: {
    fontSize: 13,
    fontFamily: fonts.medium,
    flex: 1,
    lineHeight: 15,
  },
  mismatchBalanced: {
    backgroundColor: colors.successBg,
    borderColor: colors.success,
  },
  coldStart: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: fonts.regular,
  },
  suggestions: {
    gap: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    paddingTop: 8,
  },
  suggestTitle: {
    fontSize: 13,
    fontWeight: "700",
    fontFamily: fonts.bold,
    color: colors.text,
  },
  suggestRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  suggestText: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: fonts.regular,
    flex: 1,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.primaryLight,
    borderRadius: 14,
    paddingVertical: 4,
    paddingHorizontal: 9,
  },
  chipId: {
    fontSize: 13,
    fontWeight: "700",
    fontFamily: fonts.bold,
    color: colors.primaryDark,
  },
  chipMeta: {
    fontSize: 12,
    color: colors.muted,
    fontFamily: fonts.regular,
  },
});
