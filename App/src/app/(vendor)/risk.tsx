import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Card, EmptyState, SectionTitle, StatCard, StatGrid } from "@/src/components/cards";
import { SecondaryButton } from "@/src/components/controls";
import { LoadingScreen, Screen } from "@/src/components/layout";
import { AlertBox, BarMeter, StatusPill } from "@/src/components/status";
import { api, type RiskEvaluation } from "@/src/lib/api";
import { messageOf, useAuth } from "@/src/lib/auth";
import { colors, fonts, radius } from "@/src/theme";

function formatProbability(value: unknown): string {
  return `${(Number(value ?? 0) * 100).toFixed(1)}%`;
}

const riskBarColor: Record<string, string> = {
  High: colors.danger,
  Medium: colors.warning,
  Normal: colors.success,
};

export default function RiskScreen() {
  const { vendorId } = useAuth();

  const [evaluations, setEvaluations] = useState<RiskEvaluation[] | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!vendorId) return;

    try {
      setError("");
      const result = await api.getRisk(vendorId);
      setEvaluations(result.evaluations);
      setNote(result.message ?? "");
    } catch (caught) {
      setError(messageOf(caught));
      setEvaluations([]);
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

  const items = evaluations ?? [];
  const counts = items.reduce<{ high: number; medium: number; normal: number }>(
    (acc, item) => {
      const risk = String(item.risk_label ?? "").toLowerCase();
      if (risk === "high") acc.high += 1;
      else if (risk === "medium") acc.medium += 1;
      else acc.normal += 1;
      return acc;
    },
    { high: 0, medium: 0, normal: 0 },
  );

  return (
    <Screen
      title="Spoilage Risk"
      subtitle="AI-based batch risk evaluation and recommended actions"
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
      {!error && note ? <AlertBox type="warning" message={note} /> : null}

      <StatGrid>
        <StatCard
          icon={(color) => <MaterialCommunityIcons name="shield-alert-outline" size={18} color={color} />}
          label="High Risk"
          value={counts.high}
          sub="batches"
          tone={counts.high > 0 ? "danger" : "success"}
        />
        <StatCard
          icon={(color) => <MaterialCommunityIcons name="thermometer" size={18} color={color} />}
          label="Medium Risk"
          value={counts.medium}
          sub="batches"
          tone={counts.medium > 0 ? "warning" : "success"}
        />
        <StatCard
          icon={(color) => <MaterialCommunityIcons name="check-circle-outline" size={18} color={color} />}
          label="Normal"
          value={counts.normal}
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

      {items.length === 0 && !error ? (
        <Card>
          <EmptyState
            icon={<MaterialCommunityIcons name="shield-alert-outline" size={26} color={colors.muted} />}
            title="No active batches"
            text="Batch risk evaluations appear here once your shop has active stock."
          />
        </Card>
      ) : (
        <View>
          <SectionTitle
            title="Batch Risk Evaluation"
            subtitle="Risk probabilities and recommended action"
          />
          <Card>
            {items.map((item, index) => {
              const risk = String(item.risk_label ?? "Normal");
              const probabilities = item.probabilities ?? {};
              const tone =
                risk.toLowerCase() === "high"
                  ? "danger"
                  : risk.toLowerCase() === "medium"
                    ? "warning"
                    : "success";

              return (
                <View
                  key={String(item.batch_id ?? index)}
                  style={[
                    styles.batchRow,
                    index === items.length - 1 && styles.batchRowLast,
                  ]}
                >
                  <View style={styles.batchHeader}>
                    <View style={styles.batchHeaderText}>
                      <Text style={styles.batchProduct}>
                        {String(item.product_name ?? "Product")}
                      </Text>
                      <Text style={styles.batchId}>
                        Batch {String(item.batch_id ?? "unknown")}
                      </Text>
                    </View>
                    <StatusPill status={risk.toLowerCase()} label={risk} />
                  </View>

                  <View style={styles.probabilities}>
                    {(["High", "Medium", "Normal"] as const).map((level) => (
                      <BarMeter
                        key={level}
                        label={level}
                        value={formatProbability(probabilities[level])}
                        percent={Number(probabilities[level] ?? 0) * 100}
                        color={riskBarColor[level]}
                      />
                    ))}
                  </View>

                  <View
                    style={[
                      styles.action,
                      tone === "danger" && styles.actionDanger,
                      tone === "warning" && styles.actionWarning,
                      tone === "success" && styles.actionSuccess,
                    ]}
                  >
                    <MaterialCommunityIcons
                      name={
                        tone === "success"
                          ? "check-circle-outline"
                          : "alert-circle-outline"
                      }
                      size={14}
                      color={
                        tone === "danger"
                          ? colors.danger
                          : tone === "warning"
                            ? colors.warning
                            : colors.success
                      }
                    />
                    <Text
                      style={[
                        styles.actionText,
                        tone === "danger" && { color: colors.danger },
                        tone === "warning" && { color: colors.warning },
                        tone === "success" && { color: colors.success },
                      ]}
                    >
                      {String(item.action ?? "No action specified")}
                    </Text>
                  </View>
                </View>
              );
            })}
          </Card>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  batchRow: {
    padding: 15,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 12,
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
  probabilities: {
    backgroundColor: "#faf8f5",
    borderRadius: radius.control,
    padding: 11,
    gap: 0,
  },
  action: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
    padding: 10,
    borderRadius: radius.control,
    backgroundColor: colors.neutralBg,
  },
  actionDanger: {
    backgroundColor: colors.dangerBg,
  },
  actionWarning: {
    backgroundColor: colors.warningBg,
  },
  actionSuccess: {
    backgroundColor: colors.successBg,
  },
  actionText: {
    flex: 1,
    fontSize: 10,
    lineHeight: 15,
    color: colors.neutral,
    fontFamily: fonts.regular,
  },
});
