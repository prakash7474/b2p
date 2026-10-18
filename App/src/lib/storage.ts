import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const KEY = "b2p.session";

/**
 * The signed-in session (token + ids), kept so a reload stays signed in.
 * SecureStore has no web build, so the web app uses localStorage instead.
 * Failures read as "signed out" rather than crashing the app.
 */
export async function loadSavedSession(): Promise<string | null> {
  try {
    if (Platform.OS === "web") return globalThis.localStorage?.getItem(KEY) ?? null;
    return await SecureStore.getItemAsync(KEY);
  } catch {
    return null;
  }
}

export async function saveSession(value: string | null): Promise<void> {
  try {
    if (Platform.OS === "web") {
      if (value === null) globalThis.localStorage?.removeItem(KEY);
      else globalThis.localStorage?.setItem(KEY, value);
    } else if (value === null) {
      await SecureStore.deleteItemAsync(KEY);
    } else {
      await SecureStore.setItemAsync(KEY, value);
    }
  } catch {
    // Not saved: the user simply signs in again next launch.
  }
}
