import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Card, EmptyState, SectionTitle, StatCard, StatGrid } from "@/src/components/cards";
import { Button, SecondaryButton } from "@/src/components/controls";
import { LoadingScreen, Screen } from "@/src/components/layout";
import { AlertBox, StatusPill } from "@/src/components/status";
import { api, type ForecastItem, type ForecastSummary } from "@/src/lib/api";
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
      setNote(result.message ?? "Batch requested.");
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
  const kg = (value: unknown) => `${Number(Number(value ?? 0).toFixed(1))} kg`;

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
        <View>
          <SectionTitle
            title="By Product"
            subtitle="Restock = demand + safety stock − your stock − already requested"
          />
          <Card>
            {items.map((item, index) => {
              const refill = Number(item.refill_quantity ?? 0);
              const restock = Boolean(item.restock_needed);
              const requested = Number(item.requested_kg ?? 0);
              const suggested = item.suggested_batches ?? [];
              const uncovered = Number(item.uncovered_kg ?? 0);

              return (
                <View
                  key={String(item.product_name ?? index)}
                  style={[styles.row, index === items.length - 1 && styles.rowLast]}
                >
                  <View style={styles.rowHeader}>
                    <Text style={styles.product}>{String(item.product_name ?? "Product")}</Text>
                    <StatusPill status={restock ? "high" : "active"} label={String(item.status ?? "")} />
                  </View>

                  {/* One line of numbers per product: what sells, the buffer, what you hold, what to order. */}
                  <View style={styles.stats}>
                    <Stat label="Demand" value={kg(item.predicted_demand)} />
                    <Stat label="Safety stock" value={kg(item.safety_stock)} />
                    <Stat label={requested ? "Stock + requested" : "Your stock"}
                      value={kg(Number(item.current_stock ?? 0) + requested)} />
                    <Stat label="Restock" value={kg(refill)} tone={restock ? "danger" : "success"} />
                  </View>

                  {suggested.map((batch) => (
                    <View key={String(batch.batch_id)} style={styles.suggestRow}>
                      <Text style={styles.suggestText}>
                        Available: {kg(batch.remaining_kg)}
                        {batch.hours_to_expiry !== undefined
                          ? `, ${Math.round(Number(batch.hours_to_expiry))} h shelf life left`
                          : ""}
                      </Text>
                      <SecondaryButton
                        label="Request"
                        compact
                        loading={busyBatch === batch.batch_id}
                        onPress={() => void requestSuggested(String(batch.batch_id))}
                      />
                    </View>
                  ))}
                  {restock && uncovered > 0 ? (
                    <Text style={styles.note}>
                      {kg(uncovered)} has no batch available yet; the manufacturer will make more.
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </Card>
        </View>
      )}
    </Screen>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "danger" | "success" }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, tone && { color: tone === "danger" ? colors.danger : colors.success }]}>
        {value}
      </Text>
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
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  product: {
    flex: 1,
    fontSize: 17,
    fontFamily: fonts.bold,
    color: colors.text,
  },
  stats: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 10,
  },
  stat: {
    flexBasis: "50%",
    gap: 2,
  },
  statLabel: {
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: colors.muted,
    fontFamily: fonts.medium,
  },
  statValue: {
    fontSize: 17,
    color: colors.text,
    fontFamily: fonts.bold,
  },
  suggestRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  suggestText: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
    fontFamily: fonts.regular,
  },
  note: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: fonts.regular,
  },
});
