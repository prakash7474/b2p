import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { type ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { colors, fonts, radius, shadow } from "@/src/theme";

/**
 * Shared shell for the authentication screens: brand header, page title,
 * and a card with the Login / Sign Up tabs (same tab style as the admin
 * dashboard's customer page).
 */
export function AuthShell({
  active,
  title,
  subtitle,
  children,
}: {
  active: "login" | "signup";
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <View style={styles.brandLogo}>
            <Text style={styles.brandLogoText}>B2</Text>
          </View>
          <View>
            <Text style={styles.brandName}>B2POnline</Text>
            <Text style={styles.brandSubtitle}>VENDOR PORTAL</Text>
          </View>
        </View>

        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>

        <View style={styles.card}>
          <View style={styles.tabs}>
            <TouchableOpacity
              accessibilityRole="tab"
              activeOpacity={0.8}
              style={[styles.tab, active === "login" && styles.tabActive]}
              onPress={() => router.replace("/(auth)/login")}
            >
              <MaterialCommunityIcons
                name="login"
                size={14}
                color={active === "login" ? colors.primary : colors.muted}
              />
              <Text style={[styles.tabText, active === "login" && styles.tabTextActive]}>
                Login
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              accessibilityRole="tab"
              activeOpacity={0.8}
              style={[styles.tab, active === "signup" && styles.tabActive]}
              onPress={() => router.replace("/(auth)/signup")}
            >
              <MaterialCommunityIcons
                name="account-plus-outline"
                size={14}
                color={active === "signup" ? colors.primary : colors.muted}
              />
              <Text style={[styles.tabText, active === "signup" && styles.tabTextActive]}>
                Sign Up
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.cardBody}>{children}</View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 22,
    paddingTop: 56,
    paddingBottom: 48,
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    marginBottom: 30,
  },
  brandLogo: {
    width: 42,
    height: 42,
    borderRadius: radius.chip,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  brandLogoText: {
    color: "#fff",
    fontWeight: "700",
    fontFamily: fonts.bold,
    fontSize: 17,
  },
  brandName: {
    fontSize: 17,
    fontWeight: "700",
    fontFamily: fonts.bold,
    color: colors.text,
  },
  brandSubtitle: {
    fontSize: 10,
    letterSpacing: 0.5,
    color: colors.muted,
    marginTop: 3,
    fontFamily: fonts.medium,
  },
  title: {
    fontSize: 25,
    fontWeight: "700",
    fontFamily: fonts.bold,
    color: colors.text,
  },
  subtitle: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 6,
    marginBottom: 20,
    fontFamily: fonts.regular,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    ...shadow,
    overflow: "hidden",
  },
  tabs: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: 8,
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
    marginBottom: -1,
  },
  tabActive: {
    borderBottomColor: colors.primary,
  },
  tabText: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: fonts.semibold,
    color: colors.muted,
  },
  tabTextActive: {
    color: colors.primary,
  },
  cardBody: {
    padding: 20,
  },
});
