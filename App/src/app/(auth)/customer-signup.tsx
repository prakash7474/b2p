import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity } from "react-native";

import { AuthShell } from "@/src/components/auth-shell";
import { Button, FieldInput, FormField, PasswordField } from "@/src/components/controls";
import { AlertBox } from "@/src/components/status";
import { messageOf, useAuth } from "@/src/lib/auth";
import { reverseGeocode, useLiveLocation } from "@/src/lib/use-live-location";
import { colors, fonts } from "@/src/theme";

export default function CustomerSignUpScreen() {
  const { signUpCustomer } = useAuth();
  const { location, error: locationError, capturing, capture } = useLiveLocation();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const captureLocation = async () => {
    setError("");
    const captured = await capture();
    if (captured && !address.trim()) {
      const pretty = await reverseGeocode(captured.latitude, captured.longitude);
      if (pretty) setAddress(pretty);
    }
  };

  const submit = async () => {
    if (!name.trim() || !email.trim() || !password) {
      setError("Name, email and password are required.");
      return;
    }
    if (!email.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }

    try {
      setLoading(true);
      setError("");
      await signUpCustomer({
        name,
        email,
        password,
        phone,
        address,
        latitude: location?.latitude,
        longitude: location?.longitude,
      });
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
      active="signup"
      title="Create Customer Account"
      subtitle="Buy fresh batter from shops near you"
    >
      {error ? <AlertBox type="error" message={error} /> : null}
      {!error && locationError ? <AlertBox type="error" message={locationError} /> : null}

      <FormField label="Name *">
        <FieldInput value={name} onChangeText={setName} placeholder="Your name" />
      </FormField>

      <FormField label="Email *">
        <FieldInput
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
        />
      </FormField>

      <FormField label="Password *">
        <PasswordField value={password} onChangeText={setPassword} />
      </FormField>

      <FormField label="Phone">
        <FieldInput value={phone} onChangeText={setPhone} placeholder="Phone number" keyboardType="phone-pad" />
      </FormField>

      <FormField label="Address" hint="Optional. Capture your location to see nearby shops.">
        <FieldInput value={address} onChangeText={setAddress} placeholder="Street, area, city" />
      </FormField>

      <FormField label="Your Location">
        <Button
          label={location ? "Location captured" : "Use my location"}
          tone="secondary"
          icon={<MaterialCommunityIcons name="crosshairs-gps" size={14} color={colors.text} />}
          onPress={() => void captureLocation()}
          loading={capturing}
          full
        />
      </FormField>

      <Button
        label="Create Customer Account"
        icon={<MaterialCommunityIcons name="account-plus-outline" size={14} color="#fff" />}
        onPress={submit}
        loading={loading}
        full
      />

      <TouchableOpacity
        accessibilityRole="link"
        activeOpacity={0.7}
        style={styles.footer}
        onPress={() => router.replace("/(auth)/customer-login")}
      >
        <Text style={styles.footerText}>
          Already registered? <Text style={styles.footerLink}>Login</Text>
        </Text>
      </TouchableOpacity>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
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
