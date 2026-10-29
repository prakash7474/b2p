import { MaterialCommunityIcons } from "@expo/vector-icons";
import { type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { colors, fonts, radius, toneColors, formatStatus, statusTone, type StatusTone } from "@/src/theme";

/** Outlined pill badge in the status tone. */
export function StatusPill({ status, label }: { status: unknown; label?: string }) {
  const tone = statusTone(status);
  const palette = toneColors[tone];

  return (
    <View style={[styles.pill, { borderColor: palette.fg }]}>
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
      <MaterialCommunityIcons name={icon} size={18} color={palette.fg} />
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
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 2,
  },
  pillText: {
    fontSize: 12,
    fontFamily: fonts.medium,
  },
  alert: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 14,
    borderRadius: radius.card,
  },
  alertText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
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
    fontSize: 13,
    color: colors.muted,
    fontFamily: fonts.regular,
    flexShrink: 1,
  },
  meterValue: {
    fontSize: 13,
    fontFamily: fonts.medium,
    color: colors.text,
  },
  meterTrack: {
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.neutralBg,
    overflow: "hidden",
  },
  meterFill: {
    height: "100%",
    borderRadius: 6,
  },
});
