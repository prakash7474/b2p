import Constants from "expo-constants";
import { Platform } from "react-native";

/**
 * Backend base URL (backend/main.py runs on port 5000).
 *
 * - EXPO_PUBLIC_API_URL in App/.env wins when set (e.g. a public tunnel address)
 * - A phone running the dev build talks to the laptop it loaded the app from,
 *   so it follows the laptop across networks with no .env edit
 * - Otherwise: Android emulator reaches the host through 10.0.2.2; web uses localhost
 */
const envUrl = (process.env.EXPO_PUBLIC_API_URL ?? "").trim();

// "10.10.49.235:8081" when Metro serves over the LAN; a tunnel gives a domain instead,
// which does not carry the backend, so only a plain IP address is reused.
const devHost = (Constants.expoConfig?.hostUri ?? "").split(":")[0];
const lanHost = /^\d{1,3}(\.\d{1,3}){3}$/.test(devHost) ? devHost : "";

export const API_BASE =
  envUrl.length > 0
    ? envUrl.replace(/\/+$/, "")
    : Platform.OS !== "web" && lanHost
      ? `http://${lanHost}:5000`
      : Platform.OS === "android"
        ? "http://10.0.2.2:5000"
        : "http://localhost:5000";
