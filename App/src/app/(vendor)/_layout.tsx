import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/lib/auth";
import { colors, fonts } from "@/src/theme";

export default function VendorLayout() {
  const { session } = useAuth();
  const insets = useSafeAreaInsets();

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
