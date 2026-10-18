import { Redirect, Stack } from "expo-router";

import { useAuth } from "@/src/lib/auth";
import { colors } from "@/src/theme";

export default function CustomerLayout() {
  const { session } = useAuth();

  if (!session) {
    return <Redirect href="/(auth)/customer-login" />;
  }

  // Vendor sessions belong in the vendor portal.
  if (session.role !== "customer") {
    return <Redirect href="/(vendor)" />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
}
