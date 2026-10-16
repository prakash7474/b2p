import { Redirect } from "expo-router";

import { useAuth } from "@/src/lib/auth";

export default function Index() {
  const { session } = useAuth();

  const href = !session
    ? "/(auth)/login"
    : session.role === "customer"
      ? "/(customer)"
      : "/(vendor)";

  return <Redirect href={href} />;
}
