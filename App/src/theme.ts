import { type TextStyle } from "react-native";

/**
 * Design tokens for the shop and customer apps: forest green, charcoal and
 * white with butter-yellow / teal billboard accents, outlined controls, no shadows.
 */
export const colors = {
  primary: "#035542",
  primaryDark: "#023b2e",
  primaryLight: "#f9e9a9",
  butter: "#f9e9a9",
  teal: "#56dddb",

  sidebar: "#333333",

  text: "#333333",
  muted: "#5c5c5c",
  background: "#ffffff",
  surface: "#ffffff",
  border: "#035542",
  line: "#cfdcd8",

  success: "#035542",
  successBg: "#e6f2ee",
  warning: "#8a5a00",
  warningBg: "#fbf3d0",
  danger: "#b3261e",
  dangerBg: "#fbeceb",
  neutral: "#333333",
  neutralBg: "#f2f2f2",

  tableHeader: "#fbf6dd",
};

export const fonts = {
  regular: "WorkSans_400Regular",
  medium: "WorkSans_500Medium",
  semibold: "WorkSans_600SemiBold",
  bold: "WorkSans_700Bold",
  black: "WorkSans_900Black",
};

export const radius = {
  card: 20,
  control: 14,
  chip: 100,
  pill: 100,
};

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

/** Spoilage score bands match the backend: <=30 Low, 30-70 Medium, >70 High. */
export function riskColor(label: unknown): string {
  return label === "High" ? colors.danger : label === "Medium" ? colors.warning : colors.success;
}

/** Same formatting as formatStatus() in the admin dashboard. */
export function formatStatus(status: unknown): string {
  return String(status ?? "unknown")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export const textStyles = {
  sectionTitle: {
    fontSize: 20,
    color: colors.primary,
    fontFamily: fonts.black,
    textTransform: "uppercase",
  } satisfies TextStyle,
};
