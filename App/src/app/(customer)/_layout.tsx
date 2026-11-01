import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/lib/auth";
import { CartProvider } from "@/src/lib/cart";
import { colors, fonts } from "@/src/theme";

export default function CustomerLayout() {
  const { session } = useAuth();
  const insets = useSafeAreaInsets();

  if (!session) {
    return <Redirect href="/(auth)/customer-login" />;
  }

  // Vendor sessions belong in the vendor portal.
  if (session.role !== "customer") {
    return <Redirect href="/(vendor)" />;
  }

  // Shop, review and done are steps of one order: full screen, no tab bar.
  const step = { href: null, tabBarStyle: { display: "none" as const } };

  return (
    <CartProvider>
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
          tabBarLabelStyle: { fontSize: 11, fontFamily: fonts.medium },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: "Home",
            tabBarIcon: ({ color }) => <MaterialCommunityIcons name="home-outline" size={22} color={color} />,
          }}
        />
        <Tabs.Screen
          name="orders"
          options={{
            title: "Orders",
            tabBarIcon: ({ color }) => <MaterialCommunityIcons name="shopping-outline" size={22} color={color} />,
          }}
        />
        <Tabs.Screen
          name="me"
          options={{
            title: "Me",
            tabBarIcon: ({ color }) => <MaterialCommunityIcons name="account-circle-outline" size={22} color={color} />,
          }}
        />
        <Tabs.Screen name="shop" options={step} />
        <Tabs.Screen name="review" options={step} />
        <Tabs.Screen name="done" options={step} />
      </Tabs>
    </CartProvider>
  );
}
