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

import { colors, fonts, radius, shadow } from "@/src/theme";

type ScreenProps = {
  title: string;
  subtitle?: string;
  /** Small chip icon shown next to the page title (AI pages style). */
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
 * Shared page shell: admin-style topbar (brand + online status),
 * page heading, and scrollable padded content.
 */
export function Screen({
  title,
  subtitle,
  icon,
  iconTone = "primary",
  action,
  refreshing = false,
  onRefresh,
  keyboardShouldPersistTaps,
  children,
}: ScreenProps) {
  return (
    <View style={styles.screen}>
      <View style={styles.topbar}>
        <View style={styles.brandRow}>
          <View style={styles.brandLogo}>
            <Text style={styles.brandLogoText}>B2</Text>
          </View>
          <View>
            <Text style={styles.brandName}>B2POnline</Text>
            <Text style={styles.brandSubtitle}>VENDOR PORTAL</Text>
          </View>
        </View>

        <View style={styles.onlineRow}>
          <View style={styles.onlineDot} />
          <Text style={styles.onlineText}>System Online</Text>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
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
        <View style={styles.headingRow}>
          <View style={styles.headingText}>
            <View style={styles.headingTitleRow}>
              {icon ? (
                <View
                  style={[
                    styles.headingIcon,
                    iconTone === "danger" && styles.headingIconDanger,
                  ]}
                >
                  <MaterialCommunityIcons
                    name={icon}
                    size={20}
                    color={iconTone === "danger" ? colors.danger : colors.primary}
                  />
                </View>
              ) : null}
              <Text style={styles.title}>{title}</Text>
            </View>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>

          {action}
        </View>

        {children}
      </ScrollView>
    </View>
  );
}

/** Full-screen loading state (matches the admin loading screen). */
export function LoadingScreen({ label = "Loading..." }: { label?: string }) {
  return (
    <View style={styles.loadingScreen}>
      <View style={styles.loadingBox}>
        <View style={styles.loadingLogo}>
          <Text style={styles.brandLogoText}>B2</Text>
        </View>
        <Text style={styles.loadingText}>{label}</Text>
      </View>
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topbar: {
    minHeight: 62,
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  brandLogo: {
    width: 36,
    height: 36,
    borderRadius: radius.chip,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  brandLogoText: {
    color: "#fff",
    fontWeight: "700",
    fontFamily: fonts.bold,
    fontSize: 15,
  },
  brandName: {
    fontSize: 15,
    fontWeight: "700",
    fontFamily: fonts.bold,
    color: colors.text,
  },
  brandSubtitle: {
    fontSize: 9,
    letterSpacing: 0.5,
    color: colors.muted,
    marginTop: 2,
    fontFamily: fonts.medium,
  },
  onlineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.online,
  },
  onlineText: {
    fontSize: 10,
    color: colors.muted,
    fontFamily: fonts.regular,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 18,
    paddingBottom: 42,
    gap: 16,
  },
  headingRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  headingText: {
    flex: 1,
  },
  headingTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headingIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.card,
    backgroundColor: colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
  },
  headingIconDanger: {
    backgroundColor: colors.dangerBg,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    fontFamily: fonts.bold,
    color: colors.text,
  },
  subtitle: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 5,
    fontFamily: fonts.regular,
  },
  loadingScreen: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  loadingLogo: {
    width: 38,
    height: 38,
    borderRadius: 9,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    color: colors.muted,
    fontSize: 12,
    fontFamily: fonts.regular,
  },
});

export const cardShadow = shadow;
