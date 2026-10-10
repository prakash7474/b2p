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
      acc.predicted += Number(item.predicted_demand ?? 0);
      acc.order += Number(item.recommended_order ?? 0);
      if (Number(item.recommended_order ?? 0) > 0) acc.restock += 1;
      return acc;
    },
    { predicted: 0, order: 0, restock: 0 },
  );

  const chartMax = Math.max(
    1,
    ...items.flatMap((item) => [
      Number(item.predicted_demand ?? 0),
      Number(item.current_stock ?? 0),
    ]),
  );

  return (
    <Screen
      title="Demand Forecast"
      subtitle="AI-predicted demand and recommended ordering"
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
          icon={(color) => <MaterialCommunityIcons name="cart-outline" size={18} color={color} />}
          label="Recommended Order"
          value={totals.order}
          sub="units"
        />
        <StatCard
          icon={(color) => <MaterialCommunityIcons name="chart-bar" size={18} color={color} />}
          label="Products Analyzed"
          value={items.length}
          sub="products"
        />
        <StatCard
          icon={(color) => <MaterialCommunityIcons name="alert-outline" size={18} color={color} />}
          label="Need Restocking"
          value={totals.restock}
          sub="products"
          tone={totals.restock > 0 ? "warning" : "success"}
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
              title="Predicted Demand vs Current Stock"
              subtitle="Product-level forecast comparison"
            />
            <Card style={styles.chartCard}>
              <View style={styles.legend}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: colors.primary }]} />
                  <Text style={styles.legendText}>Predicted Demand</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: colors.sidebar }]} />
                  <Text style={styles.legendText}>Current Stock</Text>
                </View>
              </View>

              {items.map((item, index) => (
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
                    label="Predicted"
                    value={Number(item.predicted_demand ?? 0).toFixed(1)}
                    percent={(Number(item.predicted_demand ?? 0) / chartMax) * 100}
                    color={colors.primary}
                  />
                  <BarMeter
                    label="Current stock"
                    value={Number(item.current_stock ?? 0).toFixed(1)}
                    percent={(Number(item.current_stock ?? 0) / chartMax) * 100}
                    color={colors.sidebar}
                  />
                </View>
              ))}
            </Card>
          </View>

          <View>
            <SectionTitle title="Forecast Details" subtitle="Recommended action for each product" />
            <Card>
              {items.map((item, index) => {
                const order = Number(item.recommended_order ?? 0);
                const needsRestock = order > 0;

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
                        status={needsRestock ? "pending" : "active"}
                        label={needsRestock ? "Restock Needed" : "Stock Healthy"}
                      />
                    </View>

                    <View style={styles.metrics}>
                      <Metric label="Predicted" value={item.predicted_demand ?? 0} />
                      <Metric label="In Stock" value={item.current_stock ?? 0} />
                      <Metric label="Safety" value={item.safety_stock ?? 0} />
                      <Metric label="Order" value={order} highlight={needsRestock} />
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
});
