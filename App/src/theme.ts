import { Platform, type TextStyle, type ViewStyle } from "react-native";

/**
 * Design tokens mirrored from the admin dashboard stylesheet
 * (admin-web/src/App.css) so the mobile app shares the same look.
 */
export const colors = {
  primary: "#e86a33",
  primaryDark: "#c94f20",
  primaryLight: "#fff0e8",

  sidebar: "#242321",
  sidebarHover: "#33312e",
  tabInactive: "#bdb9b3",

  text: "#252525",
  muted: "#77736e",
  background: "#faf9f7",
  surface: "#ffffff",
  border: "#e8e4df",

  success: "#2f855a",
  successBg: "#f0f8f3",
  warning: "#c47a18",
  warningBg: "#fff8e8",
  danger: "#c94c4c",
  dangerBg: "#fff1f1",
  neutral: "#66615b",
  neutralBg: "#f1efec",

  online: "#43a66d",
  tableHeader: "#faf8f5",
};

export const fonts = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
};

export const radius = {
  card: 12,
  control: 8,
  chip: 10,
  pill: 20,
};

export const shadow: ViewStyle = Platform.select<ViewStyle>({
  ios: {
    shadowColor: "#28231e",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 18,
  },
  android: { elevation: 2 },
  default: {},
});

export type StatusTone = "success" | "warning" | "danger" | "neutral";

/** Same mapping as statusClass() in the admin dashboard. */
export function statusTone(status: unknown): StatusTone {
  const value = String(status ?? "").toLowerCase();

  if (
    ["active", "approved", "confirmed", "synchronized", "success", "completed"].includes(value)
  ) {
    return "success";
  }
  if (["pending", "requested", "processing", "normal"].includes(value)) {
    return "warning";
  }
  if (["rejected", "cancelled", "failed", "inactive", "high"].includes(value)) {
    return "danger";
  }
  if (value === "medium") {
    return "warning";
  }
  return "neutral";
}

export const toneColors: Record<StatusTone, { fg: string; bg: string }> = {
  success: { fg: colors.success, bg: colors.successBg },
  warning: { fg: colors.warning, bg: colors.warningBg },
  danger: { fg: colors.danger, bg: colors.dangerBg },
  neutral: { fg: colors.neutral, bg: colors.neutralBg },
};

/** Same formatting as formatStatus() in the admin dashboard. */
export function formatStatus(status: unknown): string {
  return String(status ?? "unknown")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Reads the first present key from a loosely typed API object. */
export function pick(
  obj: Record<string, unknown> | null | undefined,
  keys: string[],
  fallback: string | number = "",
): string | number {
  if (!obj) return fallback;
  for (const key of keys) {
    const value = obj[key];
    if (value !== undefined && value !== null && value !== "") return value as string | number;
  }
  return fallback;
}

export const textStyles = {
  title: {
    fontSize: 25,
    fontWeight: "700",
    color: colors.text,
    fontFamily: fonts.bold,
  } satisfies TextStyle,
  subtitle: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 6,
    fontFamily: fonts.regular,
  } satisfies TextStyle,
  sectionTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.text,
    fontFamily: fonts.bold,
  } satisfies TextStyle,
  cardTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
    fontFamily: fonts.bold,
  } satisfies TextStyle,
  caption: {
    fontSize: 10,
    color: colors.muted,
    fontFamily: fonts.regular,
  } satisfies TextStyle,
};
