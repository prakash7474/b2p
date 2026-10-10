import { Redirect, Stack } from "expo-router";

import { useAuth } from "@/src/lib/auth";
import { colors } from "@/src/theme";

export default function AuthLayout() {
  const { session } = useAuth();

  if (session) {
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
