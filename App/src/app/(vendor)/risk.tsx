import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Card, EmptyState, SectionTitle, StatCard, StatGrid } from "@/src/components/cards";
import { SecondaryButton } from "@/src/components/controls";
import { LoadingScreen, Screen } from "@/src/components/layout";
import { AlertBox, BarMeter, RiskBadge } from "@/src/components/status";
import { api, madeLabel, type RiskReport } from "@/src/lib/api";
import { messageOf, useAuth } from "@/src/lib/auth";
import { colors, fonts, riskColor } from "@/src/theme";

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
          <Card style={styles.aggregate}>
            <Text style={styles.aggregateLabel}>Shop risk</Text>
            <View style={styles.aggregateRow}>
              <Text style={[styles.aggregateValue, { color: riskColor(report?.aggregateLabel) }]}>
                {aggregate == null ? "—" : `${aggregate.toFixed(1)}%`}
              </Text>
              {report?.aggregateLabel ? <RiskBadge label={report.aggregateLabel} /> : null}
            </View>
            <BarMeter percent={aggregate ?? 0} color={riskColor(report?.aggregateLabel)} />
            <Text style={styles.aggregateNote}>Weighted by the kg left in each batch</Text>
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
                        <Text style={styles.batchMeta}>
                          {[`${Number(item.remaining_kg ?? 0)} kg`, madeLabel(item.manufactured_at)].filter(Boolean).join(" · ")}
                        </Text>
                      </View>
                      <RiskBadge label={item.expired ? "Expired" : label} />
                    </View>
                    <BarMeter
                      label="Risk score"
                      value={`${score.toFixed(1)}%`}
                      percent={score}
                      color={riskColor(label)}
                    />
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
    gap: 10,
  },
  aggregateLabel: {
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: colors.primary,
    fontFamily: fonts.medium,
  },
  aggregateRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  aggregateValue: {
    fontSize: 40,
    fontFamily: fonts.black,
  },
  aggregateNote: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: fonts.regular,
  },
  batchRow: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    gap: 10,
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
    fontSize: 17,
    fontFamily: fonts.bold,
    color: colors.text,
  },
  batchMeta: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: fonts.regular,
  },
});
