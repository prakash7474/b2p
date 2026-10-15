import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Card, EmptyState, SectionTitle, StatCard, StatGrid } from "@/src/components/cards";
import { Button, SecondaryButton } from "@/src/components/controls";
import { LoadingScreen, Screen } from "@/src/components/layout";
import { AlertBox, BarMeter, StatusPill } from "@/src/components/status";
import { api, type BatchChip, type ForecastItem } from "@/src/lib/api";
import { messageOf, useAuth } from "@/src/lib/auth";
import { colors, fonts } from "@/src/theme";

export default function ForecastScreen() {
  const { vendorId } = useAuth();

  const [forecast, setForecast] = useState<ForecastItem[] | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!vendorId) return;

    try {
      setError("");
      const result = await api.getForecast(vendorId);
      setForecast(result.forecast);
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

  if (loading) {
    return <LoadingScreen label="Running demand forecast..." />;
  }

  const items = forecast ?? [];
  const totals = items.reduce(
    (acc, item) => {
      acc.predicted += Number(item.predicted_demand ?? 0);
      acc.recStock += Number(item.recommended_stock ?? 0);
      acc.current += Number(item.current_stock ?? 0);
      if (item.restock_needed) acc.restock += 1;
      return acc;
    },
    { predicted: 0, recStock: 0, current: 0, restock: 0 },
  );

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
      subtitle="Predicted demand for the products you hold, and what to refill"
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
        icon={<MaterialCommunityIcons name="truck-delivery-outline" size={15} color="#fff" />}
        onPress={() => router.push("/(vendor)/request-batches")}
      />

      <StatGrid>
        <StatCard
          icon={(color) => <MaterialCommunityIcons name="trending-up" size={18} color={color} />}
          label="Predicted Demand"
          value={totals.predicted.toFixed(1)}
          sub="units"
        />
        <StatCard
          icon={(color) => <MaterialCommunityIcons name="shield-check-outline" size={18} color={color} />}
          label="Rec. Stock to Hold"
          value={totals.recStock.toFixed(1)}
          sub="demand + safety"
        />
        <StatCard
          icon={(color) => <MaterialCommunityIcons name="package-variant-closed" size={18} color={color} />}
          label="Current Stock"
          value={totals.current.toFixed(1)}
          sub="kg in batches"
        />
        <StatCard
          icon={(color) => <MaterialCommunityIcons name="alert-circle-outline" size={18} color={color} />}
          label="Restock Needed"
          value={totals.restock}
          sub="products"
          tone={totals.restock > 0 ? "danger" : "success"}
        />
      </StatGrid>

      {items.length === 0 && !error ? (
        <Card>
          <EmptyState
            icon={<MaterialCommunityIcons name="chart-timeline-variant" size={26} color={colors.muted} />}
            title="No batches yet"
            text="Forecasts appear for the products you hold. Request a batch to get started."
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
              subtitle="Refill only when stock is below demand: deficit + safety stock"
            />
            <Card>
              {items.map((item, index) => {
                const demand = Number(item.predicted_demand ?? 0);
                const safety = Number(item.safety_stock ?? 0);
                const current = Number(item.current_stock ?? 0);
                const deficit = Number(item.deficit ?? 0);
                const refill = Number(item.refill_quantity ?? 0);
                const restock = Boolean(item.restock_needed);

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
                      <StatusPill
                        status={restock ? "high" : "active"}
                        label={restock ? "Restock Needed" : "No Restock Needed"}
                      />
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
                          ? `Deficit ${deficit} kg (demand ${demand} > stock ${current}). Refill ${refill} kg = deficit + ${safety} kg safety stock.`
                          : `Stock ${current} kg covers demand ${demand} kg. No refill needed.`}
                      </Text>
                    </View>

                    {item.has_sales_history === false ? (
                      <Text style={styles.coldStart}>No sales history yet: cold-start estimate.</Text>
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
  const when = batch.received_at ? new Date(String(batch.received_at)) : null;
  return (
    <View style={styles.chip}>
      <Text style={styles.chipId}>{String(batch.batch_id ?? "batch")}</Text>
      <Text style={styles.chipMeta}>
        {Number(batch.remaining_kg ?? 0)} kg
        {when && !Number.isNaN(when.getTime()) ? ` · ${when.toLocaleDateString()}` : ""}
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
    fontSize: 10,
    color: colors.muted,
    fontFamily: fonts.regular,
  },
  chartRow: {
    paddingBottom: 14,
    marginBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  chartRowLast: {
    borderBottomWidth: 0,
    marginBottom: 0,
    paddingBottom: 0,
  },
  chartProduct: {
    fontSize: 12,
    fontWeight: "600",
    fontFamily: fonts.semibold,
    color: colors.text,
    marginBottom: 8,
  },
  detailRow: {
    padding: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 10,
  },
  detailHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  detailProduct: {
    fontSize: 12,
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
    backgroundColor: "#faf8f5",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 9,
    gap: 3,
  },
  metricLabel: {
    fontSize: 9,
    color: colors.muted,
    fontFamily: fonts.regular,
  },
  metricValue: {
    fontSize: 13,
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
    backgroundColor: "#fff5f5",
    borderColor: "#fed7d7",
  },
  mismatchText: {
    fontSize: 11,
    fontFamily: fonts.medium,
    flex: 1,
    lineHeight: 15,
  },
  mismatchBalanced: {
    backgroundColor: "#f0fff4",
    borderColor: "#c6f6d5",
  },
  coldStart: {
    fontSize: 10,
    color: colors.muted,
    fontFamily: fonts.regular,
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
    fontSize: 10,
    fontWeight: "700",
    fontFamily: fonts.bold,
    color: colors.primaryDark,
  },
  chipMeta: {
    fontSize: 9,
    color: colors.muted,
    fontFamily: fonts.regular,
  },
});
