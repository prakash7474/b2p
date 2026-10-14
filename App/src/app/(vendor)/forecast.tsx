import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Card, EmptyState, SectionTitle, StatCard, StatGrid } from "@/src/components/cards";
import { SecondaryButton } from "@/src/components/controls";
import { LoadingScreen, Screen } from "@/src/components/layout";
import { AlertBox, BarMeter, StatusPill } from "@/src/components/status";
import { api, type ForecastItem } from "@/src/lib/api";
import { messageOf, useAuth } from "@/src/lib/auth";
import { colors, fonts } from "@/src/theme";

export default function ForecastScreen() {
  const { vendorId } = useAuth();

  const [forecast, setForecast] = useState<ForecastItem[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!vendorId) return;

    try {
      setError("");
      setForecast(await api.getForecast(vendorId));
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
      const demand = Number(item.predicted_demand ?? 0);
      const safety = Number(item.safety_stock ?? 0);
      const recStock = Number(item.recommended_stock ?? demand + safety);
      const stock = Number(item.current_stock ?? 0);
      acc.predicted += demand;
      acc.recStock += recStock;
      acc.current += stock;
      if (Math.abs(stock - recStock) >= 0.1) acc.mismatches += 1;
      return acc;
    },
    { predicted: 0, recStock: 0, current: 0, mismatches: 0 },
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
      subtitle="Vendor demand, recommended stock to hold, and inventory mismatch"
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
          label="Current Inventory"
          value={totals.current.toFixed(1)}
          sub="in store"
        />
        <StatCard
          icon={(color) => <MaterialCommunityIcons name="scale-unbalanced" size={18} color={color} />}
          label="Stock Mismatches"
          value={totals.mismatches}
          sub="products"
          tone={totals.mismatches > 0 ? "warning" : "success"}
        />
      </StatGrid>

      {items.length === 0 && !error ? (
        <Card>
          <EmptyState
            icon={<MaterialCommunityIcons name="chart-timeline-variant" size={26} color={colors.muted} />}
            title="No forecast data"
            text="The backend did not return forecast records for your shop yet."
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
                  <Text style={styles.legendText}>Current Inventory</Text>
                </View>
              </View>

              {items.map((item, index) => {
                const demand = Number(item.predicted_demand ?? 0);
                const recStock = Number(item.recommended_stock ?? demand + Number(item.safety_stock ?? 0));
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
                      label="Current Inventory"
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
              title="Vendor Demand & Stock Balance"
              subtitle="Recommended stock to be held and inventory mismatch"
            />
            <Card>
              {items.map((item, index) => {
                const demand = Number(item.predicted_demand ?? 0);
                const safety = Number(item.safety_stock ?? 0);
                const recStock = Number(item.recommended_stock ?? demand + safety);
                const current = Number(item.current_stock ?? 0);
                const mismatch = Number((current - recStock).toFixed(1));
                const hasMismatch = Math.abs(mismatch) >= 0.1;
                const isShortage = mismatch < -0.1;

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
                        status={!hasMismatch ? "active" : isShortage ? "pending" : "synced"}
                        label={
                          !hasMismatch
                            ? "Matched"
                            : isShortage
                              ? `Mismatch: -${Math.abs(mismatch)} Deficit`
                              : `Mismatch: +${mismatch} Surplus`
                        }
                      />
                    </View>

                    <View style={styles.metrics}>
                      <Metric label="Demand" value={demand} />
                      <Metric label="Safety Buffer" value={safety} />
                      <Metric label="Rec. Stock to Hold" value={recStock} highlight />
                      <Metric label="Current Inventory" value={current} />
                    </View>

                    {hasMismatch ? (
                      <View
                        style={[
                          styles.mismatchAlert,
                          isShortage ? styles.mismatchDeficit : styles.mismatchSurplus,
                        ]}
                      >
                        <MaterialCommunityIcons
                          name={isShortage ? "alert-circle-outline" : "information-outline"}
                          size={15}
                          color={isShortage ? colors.danger : colors.primaryDark}
                        />
                        <Text
                          style={[
                            styles.mismatchText,
                            isShortage ? { color: colors.danger } : { color: colors.primaryDark },
                          ]}
                        >
                          {isShortage
                            ? `Mismatch Shortage: Current inventory (${current}) is below recommended stock (${recStock}). Restock ${Math.abs(mismatch)} units recommended.`
                            : `Mismatch Surplus: Current inventory (${current}) exceeds recommended stock (${recStock}) by ${mismatch} units.`}
                        </Text>
                      </View>
                    ) : (
                      <View style={styles.mismatchBalanced}>
                        <MaterialCommunityIcons
                          name="check-circle-outline"
                          size={15}
                          color={colors.success}
                        />
                        <Text style={styles.mismatchBalancedText}>
                          Inventory matches recommended stock perfectly ({current} units).
                        </Text>
                      </View>
                    )}
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
  mismatchSurplus: {
    backgroundColor: "#f7fafc",
    borderColor: "#e2e8f0",
  },
  mismatchText: {
    fontSize: 11,
    fontFamily: fonts.medium,
    flex: 1,
    lineHeight: 15,
  },
  mismatchBalanced: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#f0fff4",
    borderColor: "#c6f6d5",
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  mismatchBalancedText: {
    fontSize: 11,
    fontFamily: fonts.medium,
    color: colors.success,
    flex: 1,
  },
});
