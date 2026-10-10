import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";

import { AuthShell } from "@/src/components/auth-shell";
import { Button, FieldInput, FormField, PasswordField } from "@/src/components/controls";
import { AlertBox } from "@/src/components/status";
import { messageOf, useAuth } from "@/src/lib/auth";
import { reverseGeocode, useLiveLocation } from "@/src/lib/use-live-location";
import { colors, fonts, radius } from "@/src/theme";

function generateVendorId(): string {
  return `VND-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export default function SignUpScreen() {
  const { signUp } = useAuth();
  const { location, error: locationError, capturing, capture } = useLiveLocation();

  const [shopName, setShopName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [atShop, setAtShop] = useState(false);

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
    if (!shopName.trim() || !email.trim() || !password) {
      setError("Shop name, email and password are required.");
      return;
    }
    if (!email.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    if (!location) {
      setError("Capture your live shop location before creating the account.");
      return;
    }
    if (!atShop) {
      setError("Confirm that you are currently standing at your shop's location.");
      return;
    }

    try {
      setLoading(true);
      setError("");
      await signUp({
        vendorId: generateVendorId(),
        shopName,
        email,
        password,
        phone,
        address,
        latitude: location.latitude,
        longitude: location.longitude,
      });
      router.replace("/(vendor)");
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = Boolean(shopName.trim() && email.trim() && password && location && atShop);

  return (
    <AuthShell
      active="signup"
      title="Create Vendor Account"
      subtitle="Register your shop with its live location"
    >
      {/* Required warning: the person must be at their shop's location. */}
      <View style={styles.warningBox}>
        <MaterialCommunityIcons name="alert" size={16} color={colors.warning} />
        <Text style={styles.warningText}>
          <Text style={styles.warningTitle}>You must be at your shop’s location.{" "}</Text>
          Only capture your location while standing at the place where your shop
          operates — these live coordinates will be saved as your shop’s location.
        </Text>
      </View>

      {error ? <AlertBox type="error" message={error} /> : null}
      {!error && locationError ? (
        <AlertBox type="error" message={locationError} />
      ) : null}

      <FormField label="Shop Name *">
        <FieldInput
          value={shopName}
          onChangeText={setShopName}
          placeholder="e.g. Sunrise Fresh Store"
        />
      </FormField>

      <FormField label="Email *">
        <FieldInput
          value={email}
          onChangeText={setEmail}
          placeholder="vendor@example.com"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
        />
      </FormField>

      <FormField label="Password *">
        <PasswordField value={password} onChangeText={setPassword} />
      </FormField>

      <FormField label="Phone">
        <FieldInput
          value={phone}
          onChangeText={setPhone}
          placeholder="Phone number"
          keyboardType="phone-pad"
        />
      </FormField>

      <FormField label="Shop Address" hint="Prefilled from your captured location — editable.">
        <FieldInput
          value={address}
          onChangeText={setAddress}
          placeholder="Street, area, city"
        />
      </FormField>

      {/* Live location capture */}
      <View style={styles.locationBox}>
        <View style={styles.locationHeader}>
          <MaterialCommunityIcons name="map-marker-outline" size={16} color={colors.primary} />
          <Text style={styles.locationTitle}>Shop Location *</Text>
          <View
            style={[
              styles.locationState,
              { backgroundColor: location ? colors.successBg : colors.neutralBg },
            ]}
          >
            <Text
              style={[
                styles.locationStateText,
                { color: location ? colors.success : colors.neutral },
              ]}
            >
              {location ? "Captured" : "Required"}
            </Text>
          </View>
        </View>

        <Text style={styles.locationHint}>
          Stand at your shop’s location, then capture your live GPS position.
        </Text>

        {location ? (
          <View style={styles.coordinates}>
            <View style={styles.coordinateRow}>
              <Text style={styles.coordinateLabel}>Latitude</Text>
              <Text style={styles.coordinateValue}>
                {location.latitude.toFixed(6)}
              </Text>
            </View>
            <View style={styles.coordinateRow}>
              <Text style={styles.coordinateLabel}>Longitude</Text>
              <Text style={styles.coordinateValue}>
                {location.longitude.toFixed(6)}
              </Text>
            </View>
            <View style={styles.coordinateRow}>
              <Text style={styles.coordinateLabel}>Accuracy</Text>
              <Text style={styles.coordinateValue}>
                {location.accuracy !== null
                  ? `± ${Math.round(location.accuracy)} m`
                  : "—"}
              </Text>
            </View>
            <View style={styles.coordinateRow}>
              <Text style={styles.coordinateLabel}>Captured</Text>
              <Text style={styles.coordinateValue}>
                {new Date(location.capturedAt).toLocaleTimeString()}
              </Text>
            </View>
          </View>
        ) : null}

        <Button
          label={location ? "Re-capture location" : "Capture my location"}
          icon={
            <MaterialCommunityIcons
              name="crosshairs-gps"
              size={14}
              color={location ? colors.text : "#fff"}
            />
          }
          tone={location ? "secondary" : "primary"}
          onPress={captureLocation}
          loading={capturing}
          full
        />
      </View>

      {/* Confirmation that the person is at the shop spot */}
      <View style={styles.confirmRow}>
        <View style={styles.confirmText}>
          <Text style={styles.confirmTitle}>I am at my shop’s location right now</Text>
          <Text style={styles.confirmCaption}>
            Confirm only if you are physically standing where your shop operates.
          </Text>
        </View>
        <Switch
          value={atShop}
          onValueChange={setAtShop}
          disabled={!location}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor="#fff"
        />
      </View>

      <Button
        label="Create Vendor Account"
        icon={<MaterialCommunityIcons name="account-plus-outline" size={14} color="#fff" />}
        onPress={submit}
        loading={loading}
        disabled={!canSubmit}
        full
      />

      <TouchableOpacity
        accessibilityRole="link"
        activeOpacity={0.7}
        style={styles.footer}
        onPress={() => router.replace("/(auth)/login")}
      >
        <Text style={styles.footerText}>
          Already registered? <Text style={styles.footerLink}>Login</Text>
        </Text>
      </TouchableOpacity>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  warningBox: {
    flexDirection: "row",
    gap: 9,
    alignItems: "flex-start",
    backgroundColor: colors.warningBg,
    borderRadius: radius.control,
    padding: 12,
    marginBottom: 16,
  },
  warningText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
    color: colors.warning,
    fontFamily: fonts.regular,
  },
  warningTitle: {
    fontWeight: "700",
    fontFamily: fonts.bold,
  },
  locationBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.control,
    backgroundColor: "#faf8f5",
    padding: 14,
    gap: 10,
    marginBottom: 16,
  },
  locationHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  locationTitle: {
    fontSize: 12,
    fontWeight: "700",
    fontFamily: fonts.bold,
    color: colors.text,
    flex: 1,
  },
  locationState: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  locationStateText: {
    fontSize: 9,
    fontWeight: "700",
    fontFamily: fonts.bold,
  },
  locationHint: {
    fontSize: 10,
    color: colors.muted,
    lineHeight: 15,
    fontFamily: fonts.regular,
  },
  coordinates: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.control,
    paddingHorizontal: 12,
  },
  coordinateRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  coordinateLabel: {
    fontSize: 10,
    color: colors.muted,
    fontFamily: fonts.regular,
  },
  coordinateValue: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: fonts.semibold,
    color: colors.text,
  },
  confirmRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.control,
    padding: 13,
    marginBottom: 16,
    backgroundColor: colors.surface,
  },
  confirmText: {
    flex: 1,
    gap: 3,
  },
  confirmTitle: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: fonts.semibold,
    color: colors.text,
  },
  confirmCaption: {
    fontSize: 9,
    color: colors.muted,
    lineHeight: 14,
    fontFamily: fonts.regular,
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
