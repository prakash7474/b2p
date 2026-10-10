import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type TextInputProps,
} from "react-native";

import { colors, fonts, radius } from "@/src/theme";

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

type ButtonTone = "primary" | "secondary" | "danger";

export function Button({
  label,
  onPress,
  icon,
  tone = "primary",
  disabled = false,
  loading = false,
  full = false,
  compact = false,
}: {
  label: string;
  onPress: () => void;
  icon?: ReactNode;
  tone?: ButtonTone;
  disabled?: boolean;
  loading?: boolean;
  full?: boolean;
  compact?: boolean;
}) {
  const isDisabled = disabled || loading;
  const labelColor =
    tone === "primary" ? "#fff" : tone === "danger" ? colors.danger : colors.text;

  return (
    <TouchableOpacity
      accessibilityRole="button"
      activeOpacity={0.85}
      onPress={onPress}
      disabled={isDisabled}
      style={[
        styles.button,
        tone === "primary" && styles.buttonPrimary,
        tone === "secondary" && styles.buttonSecondary,
        tone === "danger" && styles.buttonDanger,
        compact && styles.buttonCompact,
        full && styles.buttonFull,
        isDisabled && styles.buttonDisabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={labelColor} />
      ) : (
        icon
      )}
      <Text style={[styles.buttonLabel, { color: labelColor }]}>
        {loading ? `${label}...` : label}
      </Text>
    </TouchableOpacity>
  );
}

export const PrimaryButton = (props: Omit<Parameters<typeof Button>[0], "tone">) => (
  <Button {...props} tone="primary" />
);

export const SecondaryButton = (props: Omit<Parameters<typeof Button>[0], "tone">) => (
  <Button {...props} tone="secondary" />
);

/* ------------------------------------------------------------------ */
/* Fields                                                              */
/* ------------------------------------------------------------------ */

export function FormField({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

export function FieldInput({ style, ...props }: TextInputProps) {
  const [focused, setFocused] = useState(false);

  return (
    <TextInput
      {...props}
      onFocus={(event) => {
        setFocused(true);
        props.onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        props.onBlur?.(event);
      }}
      placeholderTextColor={colors.muted}
      style={[styles.input, focused && styles.inputFocused, style]}
    />
  );
}

export function PasswordField({
  value,
  onChangeText,
  placeholder = "Password",
  autoCapitalize = "none",
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  autoCapitalize?: TextInputProps["autoCapitalize"];
}) {
  const [visible, setVisible] = useState(false);

  return (
    <View style={styles.passwordWrap}>
      <FieldInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        autoCapitalize={autoCapitalize}
        secureTextEntry={!visible}
        style={styles.passwordInput}
      />
      <TouchableOpacity
        accessibilityRole="button"
        onPress={() => setVisible((prev) => !prev)}
        style={styles.passwordToggle}
        hitSlop={8}
      >
        <MaterialCommunityIcons
          name={visible ? "eye-off-outline" : "eye-outline"}
          size={16}
          color={colors.muted}
        />
      </TouchableOpacity>
    </View>
  );
}

export function SearchField({
  value,
  onChangeText,
  placeholder = "Search...",
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
}) {
  return (
    <View style={styles.search}>
      <MaterialCommunityIcons
        name="magnify"
        size={16}
        color={colors.muted}
        style={styles.searchIcon}
      />
      <FieldInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        autoCapitalize="none"
        style={styles.searchInput}
      />
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Selection                                                           */
/* ------------------------------------------------------------------ */

/**
 * Lightweight select built on a Modal so no extra native dependency is
 * needed (works inside Expo Go).
 */
export function SelectField({
  label,
  value,
  onValueChange,
  options,
  placeholder = "Select an option",
}: {
  label?: string;
  value: string;
  onValueChange: (value: string) => void;
  options: { label: string; value: string }[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <View style={styles.field}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}

      <TouchableOpacity
        accessibilityRole="button"
        activeOpacity={0.85}
        style={styles.selectControl}
        onPress={() => setOpen(true)}
      >
        <Text
          numberOfLines={1}
          style={[styles.selectText, !selected && styles.selectPlaceholder]}
        >
          {selected?.label ?? placeholder}
        </Text>
        <MaterialCommunityIcons name="chevron-down" size={16} color={colors.muted} />
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <TouchableOpacity
          activeOpacity={1}
          style={styles.modalBackdrop}
          onPress={() => setOpen(false)}
        >
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>{label ?? placeholder}</Text>

            <ScrollView style={styles.modalList}>
              {options.map((option) => {
                const active = option.value === value;
                return (
                  <TouchableOpacity
                    key={option.value}
                    activeOpacity={0.8}
                    style={[styles.modalOption, active && styles.modalOptionActive]}
                    onPress={() => {
                      onValueChange(option.value);
                      setOpen(false);
                    }}
                  >
                    <Text
                      style={[styles.modalOptionText, active && styles.modalOptionTextActive]}
                      numberOfLines={1}
                    >
                      {option.label}
                    </Text>
                    {active ? (
                      <MaterialCommunityIcons
                        name="check"
                        size={15}
                        color={colors.primary}
                      />
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: radius.control,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  buttonPrimary: {
    backgroundColor: colors.primary,
  },
  buttonSecondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  buttonDanger: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: "#f0d1d1",
  },
  buttonCompact: {
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  buttonFull: {
    width: "100%",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonLabel: {
    fontSize: 11,
    fontWeight: "600",
    fontFamily: fonts.semibold,
  },
  field: {
    gap: 6,
    marginBottom: 14,
  },
  fieldLabel: {
    fontSize: 10,
    fontWeight: "600",
    color: colors.muted,
    fontFamily: fonts.semibold,
  },
  fieldHint: {
    fontSize: 9,
    color: colors.muted,
    fontFamily: fonts.regular,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.control,
    backgroundColor: colors.surface,
    paddingHorizontal: 11,
    paddingVertical: 10,
    fontSize: 12,
    color: colors.text,
    fontFamily: fonts.regular,
  },
  inputFocused: {
    borderColor: colors.primary,
  },
  passwordWrap: {
    position: "relative",
  },
  passwordInput: {
    paddingRight: 38,
  },
  passwordToggle: {
    position: "absolute",
    right: 8,
    top: "50%",
    transform: [{ translateY: -12 }],
  },
  search: {
    position: "relative",
    width: "100%",
  },
  searchIcon: {
    position: "absolute",
    left: 9,
    top: "50%",
    transform: [{ translateY: -12 }],
    zIndex: 1,
  },
  searchInput: {
    paddingLeft: 31,
  },
  selectControl: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.control,
    backgroundColor: colors.surface,
    paddingHorizontal: 11,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  selectText: {
    fontSize: 12,
    color: colors.text,
    fontFamily: fonts.regular,
    flexShrink: 1,
  },
  selectPlaceholder: {
    color: colors.muted,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.35)",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 12,
    paddingHorizontal: 6,
    maxHeight: 360,
  },
  modalTitle: {
    fontSize: 11,
    fontWeight: "700",
    fontFamily: fonts.bold,
    color: colors.text,
    paddingHorizontal: 10,
    paddingBottom: 8,
  },
  modalList: {
    flexGrow: 0,
  },
  modalOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 11,
    borderRadius: radius.control,
  },
  modalOptionActive: {
    backgroundColor: colors.primaryLight,
  },
  modalOptionText: {
    fontSize: 12,
    color: colors.text,
    fontFamily: fonts.regular,
    flexShrink: 1,
  },
  modalOptionTextActive: {
    color: colors.primaryDark,
    fontWeight: "600",
    fontFamily: fonts.semibold,
  },
});
