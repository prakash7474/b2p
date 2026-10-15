import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Card, EmptyState, SectionTitle, StatCard, StatGrid } from "@/src/components/cards";
import { SecondaryButton } from "@/src/components/controls";
import { LoadingScreen, Screen } from "@/src/components/layout";
import { AlertBox, BarMeter, StatusPill } from "@/src/components/status";
import { api, type RiskReport } from "@/src/lib/api";
import { messageOf, useAuth } from "@/src/lib/auth";
import { colors, fonts, radius, riskColor } from "@/src/theme";

export default function RiskScreen() {
  const { vendorId } = useAuth();

  const [report, setReport] = useState<RiskReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!vendorId) return;

    try {
      setError("");
      setReport(await api.getRisk(vendorId));
    } catch (caught) {
      setError(messageOf(caught));
      setReport(null);
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
    return <LoadingScreen label="Evaluating spoilage risk..." />;
  }

  const items = report?.evaluations ?? [];
  const count = (label: string) => items.filter((item) => item.risk_label === label).length;
  const aggregate = report?.aggregateScore;

  return (
    <Screen
      title="Spoilage Risk"
      subtitle="Model risk score for every batch you hold"
      icon="shield-alert-outline"
      iconTone="danger"
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

      {items.length === 0 && !error ? (
        <Card>
          <EmptyState
            icon={<MaterialCommunityIcons name="shield-alert-outline" size={26} color={colors.muted} />}
            title="No batches assigned"
            text={report?.message ?? "Risk appears once batches are assigned to your shop."}
          />
        </Card>
      ) : (
        <>
          <Card style={[styles.aggregate, { borderColor: riskColor(report?.aggregateLabel) }]}>
            <Text style={styles.aggregateLabel}>Shop Aggregate Risk</Text>
            <Text style={[styles.aggregateValue, { color: riskColor(report?.aggregateLabel) }]}>
              {aggregate == null ? "—" : `${aggregate.toFixed(1)}%`}
            </Text>
            <Text style={[styles.aggregateBand, { color: riskColor(report?.aggregateLabel) }]}>
              {report?.aggregateLabel ?? "—"} risk · weighted by kg in each batch
            </Text>
            <BarMeter percent={aggregate ?? 0} color={riskColor(report?.aggregateLabel)} />
          </Card>

          <StatGrid>
            <StatCard
              icon={(color) => <MaterialCommunityIcons name="shield-alert-outline" size={18} color={color} />}
              label="High (>70%)"
              value={count("High")}
              sub="batches"
              tone={count("High") > 0 ? "danger" : "success"}
            />
            <StatCard
              icon={(color) => <MaterialCommunityIcons name="thermometer" size={18} color={color} />}
              label="Medium (30-70%)"
              value={count("Medium")}
              sub="batches"
              tone={count("Medium") > 0 ? "warning" : "success"}
            />
            <StatCard
              icon={(color) => <MaterialCommunityIcons name="check-circle-outline" size={18} color={color} />}
              label="Low (≤30%)"
              value={count("Low")}
              sub="batches"
              tone="success"
            />
            <StatCard
              icon={(color) => <MaterialCommunityIcons name="cube-outline" size={18} color={color} />}
              label="Total Batches"
              value={items.length}
              sub="evaluated"
            />
          </StatGrid>

          <View>
            <SectionTitle
              title="Batch Risk Evaluation"
              subtitle="Score = P(High)×100 + P(Medium)×50"
            />
            <Card>
              {items.map((item, index) => {
                const label = String(item.risk_label ?? "Low");
                const score = Number(item.risk_score ?? 0);

                return (
                  <View
                    key={String(item.batch_id ?? index)}
                    style={[styles.batchRow, index === items.length - 1 && styles.batchRowLast]}
                  >
                    <View style={styles.batchHeader}>
                      <View style={styles.batchHeaderText}>
                        <Text style={styles.batchProduct}>{String(item.product_name ?? "Product")}</Text>
                        <Text style={styles.batchId}>
                          Batch {String(item.batch_id ?? "unknown")} · {Number(item.remaining_kg ?? 0)} kg
                        </Text>
                      </View>
                      <StatusPill status={label === "Low" ? "active" : label.toLowerCase()} label={`${label} Risk`} />
                    </View>
                    <BarMeter
                      label="Risk score"
                      value={`${score.toFixed(1)}%`}
                      percent={score}
                      color={riskColor(label)}
                    />
                    <Text style={[styles.action, { color: riskColor(label) }]}>{String(item.action ?? "")}</Text>
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

const styles = StyleSheet.create({
  aggregate: {
    padding: 16,
    borderWidth: 2,
    gap: 4,
  },
  aggregateLabel: {
    fontSize: 11,
    color: colors.muted,
    fontFamily: fonts.regular,
  },
  aggregateValue: {
    fontSize: 32,
    fontWeight: "700",
    fontFamily: fonts.bold,
  },
  aggregateBand: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: fonts.semibold,
    marginBottom: 6,
  },
  batchRow: {
    padding: 15,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 6,
  },
  batchRowLast: {
    borderBottomWidth: 0,
  },
  batchHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  batchHeaderText: {
    flex: 1,
    gap: 3,
  },
  batchProduct: {
    fontSize: 12,
    fontWeight: "700",
    fontFamily: fonts.bold,
    color: colors.text,
  },
  batchId: {
    fontSize: 10,
    color: colors.muted,
    fontFamily: fonts.regular,
  },
  action: {
    fontSize: 10,
    fontFamily: fonts.medium,
    borderRadius: radius.control,
  },
});
