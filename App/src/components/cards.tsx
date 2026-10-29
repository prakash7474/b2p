import { type ReactNode } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { colors, fonts, radius, textStyles } from "@/src/theme";

/** White card with the 2px forest outline. */
export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** Heavy uppercase section title + caption. */
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
    primary: { bg: colors.butter, fg: colors.primary },
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
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.card,
    overflow: "hidden",
  },
  section: {
    marginBottom: 12,
    gap: 4,
  },
  sectionCaption: {
    fontSize: 13,
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
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.card,
    padding: 16,
  },
  statIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.chip,
    alignItems: "center",
    justifyContent: "center",
  },
  statLabel: {
    marginTop: 12,
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: colors.primary,
    fontFamily: fonts.medium,
  },
  statValueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 4,
  },
  statValue: {
    fontSize: 30,
    fontFamily: fonts.black,
    color: colors.text,
  },
  statSub: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: fonts.regular,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  infoRowLast: {
    borderBottomWidth: 0,
  },
  infoLabel: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: fonts.regular,
    flexShrink: 1,
  },
  infoValue: {
    fontSize: 15,
    fontFamily: fonts.medium,
    color: colors.text,
    textAlign: "right",
    flexShrink: 1,
  },
  empty: {
    minHeight: 170,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 24,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: fonts.black,
    textTransform: "uppercase",
    color: colors.primary,
    marginTop: 4,
  },
  emptyText: {
    fontSize: 14,
    color: colors.muted,
    textAlign: "center",
    fontFamily: fonts.regular,
  },
});
