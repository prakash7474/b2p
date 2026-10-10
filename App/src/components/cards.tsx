import { type ReactNode } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { colors, fonts, radius, shadow, textStyles, toneColors, type StatusTone } from "@/src/theme";

/** White bordered card used across the admin dashboard. */
export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** Small uppercase section title + caption, like the admin sections. */
export function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.section}>
      <Text style={textStyles.sectionTitle}>{title}</Text>
      {subtitle ? <Text style={styles.sectionCaption}>{subtitle}</Text> : null}
    </View>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <View style={styles.statGrid}>{children}</View>;
}

export function StatCard({
  icon,
  label,
  value,
  sub,
  tone = "primary",
}: {
  /** Render prop so the glyph can be tinted to match the tone. */
  icon: (color: string) => ReactNode;
  label: string;
  value: ReactNode;
  sub?: string;
  tone?: "primary" | "danger" | "warning" | "success";
}) {
  const toneStyle = {
    primary: { bg: colors.primaryLight, fg: colors.primary },
    danger: { bg: colors.dangerBg, fg: colors.danger },
    warning: { bg: colors.warningBg, fg: colors.warning },
    success: { bg: colors.successBg, fg: colors.success },
  }[tone];

  return (
    <View style={styles.statCard}>
      <View style={[styles.statIcon, { backgroundColor: toneStyle.bg }]}>
        {icon(toneStyle.fg)}
      </View>
      <Text style={styles.statLabel}>{label}</Text>
      <View style={styles.statValueRow}>
        <Text style={styles.statValue}>{value}</Text>
        {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
      </View>
    </View>
  );
}

/** Label / value row used in profile + detail cards. */
export function InfoRow({
  label,
  value,
  last = false,
}: {
  label: string;
  value: ReactNode;
  last?: boolean;
}) {
  return (
    <View style={[styles.infoRow, last && styles.infoRowLast]}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

export function StatusChip({
  tone,
  children,
}: {
  tone: StatusTone;
  children: ReactNode;
}) {
  const palette = toneColors[tone];
  return (
    <View style={[styles.chip, { backgroundColor: palette.bg }]}>
      <Text style={[styles.chipText, { color: palette.fg }]}>{children}</Text>
    </View>
  );
}

/** Icon + count row for compact lists (System Snapshot style). */
export function SnapshotRow({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
}) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.snapshotLeft}>
        {icon}
        <Text style={styles.snapshotLabel}>{label}</Text>
      </View>
      <Text style={styles.snapshotValue}>{value}</Text>
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  text,
  children,
}: {
  icon?: ReactNode;
  title: string;
  text?: string;
  children?: ReactNode;
}) {
  return (
    <View style={styles.empty}>
      {icon}
      <Text style={styles.emptyTitle}>{title}</Text>
      {text ? <Text style={styles.emptyText}>{text}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    ...shadow,
    overflow: "hidden",
  },
  section: {
    marginBottom: 12,
    gap: 4,
  },
  sectionCaption: {
    fontSize: 11,
    color: colors.muted,
    fontFamily: fonts.regular,
  },
  statGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  statCard: {
    flexGrow: 1,
    flexBasis: "45%",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: 16,
    ...shadow,
  },
  statIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.chip,
    alignItems: "center",
    justifyContent: "center",
  },
  statIconInner: {
    alignItems: "center",
    justifyContent: "center",
  },
  statLabel: {
    marginTop: 12,
    fontSize: 12,
    color: colors.muted,
    fontFamily: fonts.regular,
  },
  statValueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 4,
  },
  statValue: {
    fontSize: 24,
    fontWeight: "700",
    fontFamily: fonts.bold,
    color: colors.text,
  },
  statSub: {
    fontSize: 11,
    color: colors.muted,
    fontFamily: fonts.regular,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  infoRowLast: {
    borderBottomWidth: 0,
  },
  infoLabel: {
    fontSize: 10,
    color: colors.muted,
    fontFamily: fonts.regular,
    flexShrink: 1,
  },
  infoValue: {
    fontSize: 12,
    fontWeight: "600",
    fontFamily: fonts.semibold,
    color: colors.text,
    textAlign: "right",
    flexShrink: 1,
  },
  chip: {
    alignSelf: "flex-start",
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  chipText: {
    fontSize: 9,
    fontWeight: "700",
    fontFamily: fonts.bold,
  },
  snapshotLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  snapshotLabel: {
    fontSize: 11,
    color: colors.muted,
    fontFamily: fonts.regular,
  },
  snapshotValue: {
    fontSize: 13,
    fontWeight: "700",
    fontFamily: fonts.bold,
    color: colors.text,
  },
  empty: {
    minHeight: 170,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 24,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: "600",
    fontFamily: fonts.semibold,
    color: colors.text,
    marginTop: 4,
  },
  emptyText: {
    fontSize: 11,
    color: colors.muted,
    textAlign: "center",
    fontFamily: fonts.regular,
  },
});
