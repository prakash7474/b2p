import { Platform } from "react-native";

/**
 * Backend base URL (backend/main.py runs on port 5000).
 *
 * - Android emulator reaches the host machine through 10.0.2.2
 * - iOS simulator / web / desktop use localhost
 * - Override for physical devices with an .env entry:
 *   EXPO_PUBLIC_API_URL=http://192.168.1.10:5000
 */
const envUrl = (process.env.EXPO_PUBLIC_API_URL ?? "").trim();

export const API_BASE =
  envUrl.length > 0
    ? envUrl.replace(/\/+$/, "")
    : Platform.OS === "android"
      ? "http://10.0.2.2:5000"
      : "http://localhost:5000";
