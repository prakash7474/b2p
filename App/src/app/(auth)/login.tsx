import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { AuthShell } from "@/src/components/auth-shell";
import { AlertBox } from "@/src/components/status";
import { Button, FieldInput, FormField, PasswordField } from "@/src/components/controls";
import { messageOf, useAuth } from "@/src/lib/auth";
import { colors, fonts } from "@/src/theme";

export default function LoginScreen() {
  const { signIn } = useAuth();

  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!loginId.trim() || !password) {
      setError("Email or phone and password are required.");
      return;
    }

    try {
      setLoading(true);
      setError("");
      await signIn(loginId, password);
      router.replace("/(vendor)");
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      active="login"
      title="Welcome back"
      subtitle="Sign in to manage your shop's stock, demands and forecasts"
    >
      {error ? <AlertBox type="error" message={error} /> : null}

      <View style={styles.form}>
        <FormField label="Email or Phone *">
          <FieldInput
            value={loginId}
            onChangeText={setLoginId}
            placeholder="vendor@example.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
          />
        </FormField>

        <FormField label="Password *">
          <PasswordField value={password} onChangeText={setPassword} />
        </FormField>

        <Button
          label="Login"
          icon={<MaterialCommunityIcons name="login" size={14} color="#fff" />}
          onPress={submit}
          loading={loading}
          full
        />
      </View>

      <TouchableOpacity
        accessibilityRole="link"
        activeOpacity={0.7}
        style={styles.footer}
        onPress={() => router.replace("/(auth)/signup")}
      >
        <Text style={styles.footerText}>
          New vendor? <Text style={styles.footerLink}>Create a shop account</Text>
        </Text>
      </TouchableOpacity>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  form: {
    marginTop: 16,
  },
  footer: {
    marginTop: 16,
    alignItems: "center",
  },
  footerText: {
    fontSize: 11,
    color: colors.muted,
    fontFamily: fonts.regular,
  },
  footerLink: {
    color: colors.primary,
    fontWeight: "600",
    fontFamily: fonts.semibold,
  },
});
