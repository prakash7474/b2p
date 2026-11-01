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
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, fonts, radius } from "@/src/theme";

/**
 * Shared shell for the authentication screens: green billboard header,
 * page title, Login / Sign Up switch, then the form. `role` switches
 * between the vendor portal and the customer portal (tab targets + words).
 */
export function AuthShell({
  active,
  title,
  subtitle,
  role = "vendor",
  children,
}: {
  active: "login" | "signup";
  title: string;
  subtitle: string;
  role?: "vendor" | "customer";
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const isCustomer = role === "customer";
  const loginHref = isCustomer ? "/(auth)/customer-login" : "/(auth)/login";
  const signupHref = isCustomer ? "/(auth)/customer-signup" : "/(auth)/signup";
  const [wordA, wordB] = isCustomer ? ["EAT", "FRESH"] : ["IDLI", "DOSA"];

  const tab = (key: "login" | "signup", label: string, href: typeof loginHref | typeof signupHref) => (
    <TouchableOpacity
      accessibilityRole="tab"
      accessibilityState={{ selected: active === key }}
      activeOpacity={0.8}
      style={[styles.tab, active === key && styles.tabActive]}
      onPress={() => router.replace(href)}
    >
      <Text style={styles.tabText}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={[styles.header, { paddingTop: insets.top + 20 }]}>
          <View>
            <Text style={styles.portal}>{isCustomer ? "CUSTOMER PORTAL" : "VENDOR PORTAL"}</Text>
            <Text style={styles.brandName}>Batter to Platter</Text>
          </View>

          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Text style={[styles.billboard, { color: colors.butter }]}>{wordA}</Text>
            <Text style={[styles.billboard, { color: colors.teal }]}>{wordB}</Text>
            <View style={styles.stamp}>
              <Text style={styles.stampSmall}>MADE</Text>
              <Text style={styles.stampBig}>FRESH</Text>
              <Text style={styles.stampSmall}>TODAY</Text>
            </View>
          </View>

          <View style={styles.headingBlock}>
            <Text style={styles.title} accessibilityRole="header">
              {title}
            </Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
          </View>
        </View>

        <View style={styles.body}>
          <View style={styles.tabs} accessibilityRole="tablist">
            {tab("login", "Login", loginHref)}
            {tab("signup", "Sign Up", signupHref)}
          </View>
          {children}
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
  scroll: {
    paddingBottom: 48,
  },
  header: {
    backgroundColor: colors.primary,
    paddingHorizontal: 22,
    paddingBottom: 26,
    gap: 22,
  },
  portal: {
    fontSize: 12,
    letterSpacing: 1.4,
    color: colors.butter,
    fontFamily: fonts.medium,
  },
  brandName: {
    fontSize: 20,
    color: "#fff",
    fontFamily: fonts.medium,
    marginTop: 2,
  },
  billboard: {
    fontSize: 104,
    lineHeight: 88,
    fontFamily: fonts.black,
    letterSpacing: -2,
  },
  stamp: {
    position: "absolute",
    right: 0,
    top: -6,
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 2,
    borderColor: colors.butter,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ rotate: "-12deg" }],
  },
  stampSmall: {
    fontSize: 10,
    letterSpacing: 1.4,
    color: colors.butter,
    fontFamily: fonts.medium,
  },
  stampBig: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.butter,
    fontFamily: fonts.black,
  },
  headingBlock: {
    gap: 6,
  },
  title: {
    fontSize: 26,
    color: "#fff",
    fontFamily: fonts.bold,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 21,
    color: "#fff",
    fontFamily: fonts.regular,
  },
  body: {
    padding: 22,
    gap: 20,
  },
  tabs: {
    flexDirection: "row",
    gap: 10,
  },
  tab: {
    flex: 1,
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  tabActive: {
    backgroundColor: colors.butter,
  },
  tabText: {
    fontSize: 15,
    fontFamily: fonts.medium,
    color: colors.primary,
  },
});
