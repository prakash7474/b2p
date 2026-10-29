import { MaterialCommunityIcons } from "@expo/vector-icons";
import { type ReactNode } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ScrollViewProps,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { OnDark } from "@/src/components/controls";
import { colors, fonts } from "@/src/theme";

type ScreenProps = {
  title: string;
  subtitle?: string;
  /** Portal label shown above the title (defaults to the vendor portal). */
  portal?: "VENDOR PORTAL" | "CUSTOMER PORTAL";
  /** Glyph shown in the round stamp beside the title. */
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  iconTone?: "primary" | "danger";
  /** Right-hand action, usually a refresh button. */
  action?: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  keyboardShouldPersistTaps?: ScrollViewProps["keyboardShouldPersistTaps"];
  children: ReactNode;
};

/**
 * Shared page shell: forest-green header with the page title as a big
 * billboard word, then scrollable padded content on white.
 */
export function Screen({
  title,
  subtitle,
  portal = "VENDOR PORTAL",
  icon,
  iconTone = "primary",
  action,
  refreshing = false,
  onRefresh,
  keyboardShouldPersistTaps,
  children,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const stampColor = iconTone === "danger" ? colors.teal : colors.butter;

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps ?? "handled"}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          ) : undefined
        }
      >
        <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
          <View style={styles.brandRow}>
            <View style={styles.brandText}>
              <Text style={styles.portal}>{portal}</Text>
              <Text style={styles.brandName}>Batter to Platter</Text>
            </View>
            <OnDark.Provider value>{action}</OnDark.Provider>
          </View>

          <View style={styles.titleRow}>
            <Text
              style={styles.title}
              numberOfLines={2}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
              accessibilityRole="header"
            >
              {title}
            </Text>
            {icon ? (
              <View style={[styles.stamp, { borderColor: stampColor }]}>
                <MaterialCommunityIcons name={icon} size={26} color={stampColor} />
              </View>
            ) : null}
          </View>

          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>

        <View style={styles.content}>{children}</View>
      </ScrollView>
    </View>
  );
}

/** Full-screen loading state on the brand green. */
export function LoadingScreen({ label = "Loading..." }: { label?: string }) {
  return (
    <View style={styles.loadingScreen}>
      <Text style={styles.loadingWord}>B2P</Text>
      <Text style={styles.loadingText}>{label}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    // Clears the bottom tab bar + safe area so the last card is never covered.
    paddingBottom: 110,
  },
  header: {
    backgroundColor: colors.primary,
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 16,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  brandText: {
    flex: 1,
    gap: 2,
  },
  portal: {
    fontSize: 12,
    letterSpacing: 1.4,
    color: colors.butter,
    fontFamily: fonts.medium,
  },
  brandName: {
    fontSize: 18,
    color: "#fff",
    fontFamily: fonts.medium,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  title: {
    flex: 1,
    fontSize: 52,
    lineHeight: 50,
    color: colors.butter,
    fontFamily: fonts.black,
    textTransform: "uppercase",
    letterSpacing: -1,
  },
  stamp: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ rotate: "-12deg" }],
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 21,
    color: "#fff",
    fontFamily: fonts.regular,
  },
  content: {
    padding: 20,
    gap: 18,
  },
  loadingScreen: {
    flex: 1,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  loadingWord: {
    fontSize: 72,
    color: colors.butter,
    fontFamily: fonts.black,
  },
  loadingText: {
    color: "#fff",
    fontSize: 14,
    fontFamily: fonts.regular,
  },
});
