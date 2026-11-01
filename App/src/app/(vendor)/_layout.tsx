import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";
import { useEffect, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { colors, fonts } from "@/src/theme";

export default function VendorLayout() {
  const { session, vendorId } = useAuth();
  const insets = useSafeAreaInsets();
  const [problems, setProblems] = useState(0);

  // Count of stock problems for the Batches tab badge, checked every two minutes.
  useEffect(() => {
    if (!vendorId) return;
    const check = () =>
      api
        .getAlerts(vendorId)
        .then((alerts) => setProblems(alerts.filter((alert) => alert.level !== "info").length))
        .catch(() => setProblems(0));
    void check();
    const timer = setInterval(check, 120_000);
    return () => clearInterval(timer);
  }, [vendorId]);

  if (!session) {
    return <Redirect href="/(auth)/login" />;
  }

  // Customer sessions belong in the customer portal.
  if (session.role === "customer") {
    return <Redirect href="/(customer)" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.text,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.primary,
          borderTopWidth: 2,
          height: 64 + insets.bottom,
          paddingBottom: insets.bottom,
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontSize: 13,
          fontFamily: fonts.medium,
        },
        tabBarItemStyle: {
          paddingHorizontal: 2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color }) => (
            <MaterialCommunityIcons name="view-dashboard-outline" size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="inventory"
        options={{
          title: "Batches",
          tabBarBadge: problems > 0 ? problems : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.danger, color: "#fff", fontFamily: fonts.bold },
          tabBarIcon: ({ color }) => (
            <MaterialCommunityIcons name="package-variant" size={22} color={color} />
          ),
        }}
      />
      {/* Opened from the Forecast screen, not a tab. */}
      <Tabs.Screen name="request-batches" options={{ href: null }} />
      <Tabs.Screen
        name="forecast"
        options={{
          title: "Forecast",
          tabBarIcon: ({ color }) => (
            <MaterialCommunityIcons name="chart-timeline-variant" size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="risk"
        options={{
          title: "Risk",
          tabBarIcon: ({ color }) => (
            <MaterialCommunityIcons name="shield-alert-outline" size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color }) => (
            <MaterialCommunityIcons name="account-circle-outline" size={22} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
