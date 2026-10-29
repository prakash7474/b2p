import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Card, EmptyState, SectionTitle } from "@/src/components/cards";
import { Button, SecondaryButton } from "@/src/components/controls";
import { LoadingScreen, Screen } from "@/src/components/layout";
import { AlertBox, StatusPill } from "@/src/components/status";
import { api, parseServerDate, type AvailableBatch, type DemandRequest } from "@/src/lib/api";
import { messageOf, useAuth } from "@/src/lib/auth";
import { colors, fonts } from "@/src/theme";

type Notice = { type: "success" | "error"; text: string } | null;

/** What each request status means from the vendor's side of the handshake. */
const REQUEST_LABELS: Record<string, string> = {
  pending: "Awaiting admin",
  confirmed: "Assigned · awaiting your confirmation",
  synchronized: "Confirmed",
  rejected: "Rejected",
};

function formatDate(value: unknown): string {
  if (!value) return "—";
  const date = parseServerDate(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

const RECENT_REQUESTS = 5;

function requestedBatch(demand: DemandRequest) {
  return (demand.items ?? []).find((item) => item.batch_id);
}

export default function RequestBatchesScreen() {
  const { vendorId } = useAuth();

  const [available, setAvailable] = useState<AvailableBatch[]>([]);
  const [requests, setRequests] = useState<DemandRequest[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    if (!vendorId) return;
    try {
      const [batchData, requestData] = await Promise.all([
        api.getAvailableBatches(),
        api.getDemands(vendorId),
      ]);
      setAvailable(batchData);
      setRequests(
        [...requestData].sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))),
      );
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

  const run = async (id: string, action: () => Promise<{ message?: string }>) => {
    try {
      setBusyId(id);
      setNotice(null);
      const result = await action();
      setNotice({ type: "success", text: result.message ?? "Done." });
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

  const pendingBatchIds = new Set(
    requests
      .filter((demand) => demand.status === "pending")
      .map((demand) => requestedBatch(demand)?.batch_id),
  );

  const refresh = () => {
    setRefreshing(true);
    void load();
  };

  // The newest few by default; an assignment still waiting for your confirmation always shows.
  const listed = showAll
    ? requests
    : requests.filter((demand, index) => index < RECENT_REQUESTS || demand.status === "confirmed");

  return (
    <Screen
      title="Request Batches"
      subtitle="Ask the admin to assign batches to your shop"
      icon="truck-delivery-outline"
      action={
        <SecondaryButton
          label="Forecast"
          compact
          icon={<MaterialCommunityIcons name="arrow-left" size={13} color={colors.text} />}
          onPress={() => router.push("/(vendor)/forecast")}
        />
      }
      refreshing={refreshing}
      onRefresh={refresh}
    >
      {notice ? <AlertBox type={notice.type} message={notice.text} /> : null}

      <View>
        <SectionTitle
          title="Available Batches"
          subtitle="Batches the admin has opened for requests"
        />
        <Card>
          {available.length === 0 ? (
            <EmptyState
              icon={<MaterialCommunityIcons name="package-variant" size={26} color={colors.muted} />}
              title="No batches available"
              text="The admin has not exposed any batches right now. Pull to refresh."
            />
          ) : (
            available.map((batch, index) => {
              const id = String(batch.batch_id ?? "");
              const requested = pendingBatchIds.has(id);
              return (
                <View key={id || index} style={[styles.row, index === available.length - 1 && styles.rowLast]}>
                  <View style={styles.rowMain}>
                    <Text style={styles.rowTitle}>{String(batch.product_name ?? "Batch")}</Text>
                    <Text style={styles.rowMeta}>{Number(batch.remaining_kg ?? 0)} kg</Text>
                    <Text style={styles.rowMeta}>
                      Made {formatDate(batch.manufactured_at ?? batch.mfgTimestamp ?? batch.created_at)}
                    </Text>
                  </View>
                  <Button
                    label={requested ? "Requested" : "Request"}
                    compact
                    disabled={requested}
                    loading={busyId === id}
                    icon={<MaterialCommunityIcons name="send-outline" size={18} color={colors.primary} />}
                    onPress={() => void run(id, () => api.requestBatch(vendorId, id))}
                  />
                </View>
              );
            })
          )}
        </Card>
      </View>

      <View>
        <SectionTitle
          title="My Batch Requests"
          subtitle="Your latest requests. The admin assigns a batch, then you confirm it arrived"
        />
        <Card>
          {requests.length === 0 ? (
            <EmptyState
              icon={<MaterialCommunityIcons name="clipboard-text-outline" size={26} color={colors.muted} />}
              title="No requests yet"
              text="Request a batch above to start."
            />
          ) : (
            listed.map((demand, index) => {
              const status = String(demand.status ?? "pending");
              const item = requestedBatch(demand) ?? demand.items?.[0];
              const batchId = String(item?.batch_id ?? "");
              return (
                <View
                  key={String(demand._id ?? index)}
                  style={[styles.row, index === listed.length - 1 && styles.rowLast]}
                >
                  <View style={styles.rowMain}>
                    <View style={styles.titleRow}>
                      <Text style={styles.rowTitle}>
                        {String(item?.product_name ?? demand.product_name ?? "Request")}
                      </Text>
                      <StatusPill status={status} label={REQUEST_LABELS[status]} />
                    </View>
                    <Text style={styles.rowMeta}>
                      {Number(item?.quantity ?? demand.requested_quantity_kg ?? 0)} kg · requested {formatDate(demand.created_at)}
                    </Text>
                    {demand.admin_notes ? (
                      <Text style={styles.rowMeta}>Admin: {demand.admin_notes}</Text>
                    ) : null}
                  </View>
                  {status === "confirmed" && batchId ? (
                    <Button
                      label="Confirm"
                      compact
                      loading={busyId === batchId}
                      icon={<MaterialCommunityIcons name="check-circle-outline" size={18} color={colors.primary} />}
                      onPress={() => void run(batchId, () => api.receiveBatch(vendorId, batchId))}
                    />
                  ) : null}
                </View>
              );
            })
          )}
        </Card>
        {requests.length > RECENT_REQUESTS ? (
          <View style={styles.toggle}>
            <SecondaryButton
              label={showAll ? "Show recent only" : `Show all ${requests.length} requests`}
              compact
              onPress={() => setShowAll((value) => !value)}
            />
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
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
  toggle: {
    alignItems: "center",
    marginTop: 12,
  },
  rowMain: {
    flex: 1,
    gap: 4,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
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
});
