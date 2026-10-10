import { Redirect } from "expo-router";

import { useAuth } from "@/src/lib/auth";

export default function Index() {
  const { session } = useAuth();

  return <Redirect href={session ? "/(vendor)" : "/(auth)/login"} />;
}
