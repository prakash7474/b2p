import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { AuthShell } from "@/src/components/auth-shell";
import { Button, FieldInput, FormField, PasswordField } from "@/src/components/controls";
import { AlertBox } from "@/src/components/status";
import { messageOf, useAuth } from "@/src/lib/auth";
import { useLiveLocation } from "@/src/lib/use-live-location";
import { colors, fonts } from "@/src/theme";

export default function CustomerLoginScreen() {
  const { signInCustomer } = useAuth();
  const { location, error: locationError, capturing, capture } = useLiveLocation();

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
      // With a location the backend also returns shops near the customer.
      await signInCustomer(
        loginId,
        password,
        location ? { latitude: location.latitude, longitude: location.longitude } : undefined,
      );
      router.replace("/(customer)");
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      role="customer"
      active="login"
      title="Welcome back"
      subtitle="Sign in to find fresh batter at shops near you"
    >
      {error ? <AlertBox type="error" message={error} /> : null}
      {!error && locationError ? <AlertBox type="error" message={locationError} /> : null}

      <View style={styles.form}>
        <FormField label="Email or Phone *">
          <FieldInput
            value={loginId}
            onChangeText={setLoginId}
            placeholder="you@example.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
          />
        </FormField>

        <FormField label="Password *">
          <PasswordField value={password} onChangeText={setPassword} />
        </FormField>

        <FormField
          label="Your Location"
          hint={location ? "Captured: nearby shops load after sign-in." : "Optional: lets us show shops near you."}
        >
          <Button
            label={location ? "Location captured" : "Use my location"}
            tone="secondary"
            icon={<MaterialCommunityIcons name="crosshairs-gps" size={14} color={colors.text} />}
            onPress={() => void capture()}
            loading={capturing}
            full
          />
        </FormField>

        <Button
          label="Login"
          icon={<MaterialCommunityIcons name="login" size={18} color={colors.primary} />}
          onPress={submit}
          loading={loading}
          full
        />
      </View>

      <TouchableOpacity
        accessibilityRole="link"
        activeOpacity={0.7}
        style={styles.footer}
        onPress={() => router.replace("/(auth)/login")}
      >
        <Text style={styles.footerText}>
          Run a shop? <Text style={styles.footerLink}>Vendor sign in</Text>
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
    fontSize: 13,
    color: colors.muted,
    fontFamily: fonts.regular,
  },
  footerLink: {
    color: colors.primary,
    fontWeight: "600",
    fontFamily: fonts.semibold,
  },
});
