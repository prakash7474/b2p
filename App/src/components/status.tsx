import { MaterialCommunityIcons } from "@expo/vector-icons";
import { type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { colors, fonts, radius, toneColors, formatStatus, statusTone, type StatusTone } from "@/src/theme";

/** Small pill badge, same palette as the admin status badges. */
export function StatusPill({ status, label }: { status: unknown; label?: string }) {
  const tone = statusTone(status);
  const palette = toneColors[tone];

  return (
    <View style={[styles.pill, { backgroundColor: palette.bg }]}>
      <Text style={[styles.pillText, { color: palette.fg }]}>
        {label ?? formatStatus(status)}
      </Text>
    </View>
  );
}

export function AlertBox({
  type = "warning",
  message,
  children,
}: {
  type?: "success" | "error" | "warning";
  message?: string;
  children?: ReactNode;
}) {
  const tone: StatusTone =
    type === "success" ? "success" : type === "error" ? "danger" : "warning";
  const palette = toneColors[tone];
  const icon =
    type === "success"
      ? "check-circle-outline"
      : type === "error"
        ? "alert-circle-outline"
        : "alert";

  return (
    <View style={[styles.alert, { backgroundColor: palette.bg }]}>
      <MaterialCommunityIcons name={icon} size={15} color={palette.fg} />
      <Text style={[styles.alertText, { color: palette.fg }]}>
        {message ?? children}
      </Text>
    </View>
  );
}

/** Horizontal meter used for forecast bars and risk probabilities. */
export function BarMeter({
  label,
  value,
  percent,
  color = colors.primary,
  suffix,
}: {
  label?: string;
  value?: ReactNode;
  percent: number;
  color?: string;
  suffix?: string;
}) {
  const width = `${Math.max(0, Math.min(100, percent))}%` as const;

  return (
    <View style={styles.meterBlock}>
      {label || value !== undefined ? (
        <View style={styles.meterHeader}>
          {label ? <Text style={styles.meterLabel}>{label}</Text> : <View />}
          {value !== undefined ? (
            <Text style={styles.meterValue}>
              {value}
              {suffix ? ` ${suffix}` : ""}
            </Text>
          ) : null}
        </View>
      ) : null}
      <View style={styles.meterTrack}>
        <View style={[styles.meterFill, { width, backgroundColor: color }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: "flex-start",
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  pillText: {
    fontSize: 9,
    fontWeight: "700",
    fontFamily: fonts.bold,
  },
  alert: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: radius.control,
  },
  alertText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
    fontFamily: fonts.regular,
  },
  meterBlock: {
    gap: 5,
    marginBottom: 10,
  },
  meterHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  meterLabel: {
    fontSize: 10,
    color: colors.muted,
    fontFamily: fonts.regular,
    flexShrink: 1,
  },
  meterValue: {
    fontSize: 10,
    fontWeight: "600",
    fontFamily: fonts.semibold,
    color: colors.text,
  },
  meterTrack: {
    height: 7,
    borderRadius: 4,
    backgroundColor: "#f1efec",
    overflow: "hidden",
  },
  meterFill: {
    height: "100%",
    borderRadius: 4,
  },
});
