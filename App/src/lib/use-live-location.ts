import * as Location from "expo-location";
import { useCallback, useState } from "react";

import { messageOf } from "./auth";

export type CapturedLocation = {
  latitude: number;
  longitude: number;
  /** Horizontal accuracy in metres (null on platforms that omit it). */
  accuracy: number | null;
  capturedAt: string;
};

/**
 * Captures the device's live GPS position. Used during vendor sign-up so
 * the shop's latitude/longitude come from where the person actually is.
 */
export function useLiveLocation() {
  const [location, setLocation] = useState<CapturedLocation | null>(null);
  const [error, setError] = useState("");
  const [capturing, setCapturing] = useState(false);

  const capture = useCallback(async (): Promise<CapturedLocation | null> => {
    setCapturing(true);
    setError("");

    try {
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled) {
        setError(
          "Location services are turned off on this device. Enable them in system settings, then try again.",
        );
        return null;
      }

      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setError(
          permission.canAskAgain
            ? "Location permission was denied. Allow location access so we can verify your shop's position."
            : "Location permission is blocked. Enable it for this app in system settings, then try again.",
        );
        return null;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const captured: CapturedLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy ?? null,
        capturedAt: new Date().toISOString(),
      };

      setLocation(captured);
      return captured;
    } catch (caught) {
      setError(messageOf(caught));
      return null;
    } finally {
      setCapturing(false);
    }
  }, []);

  const reset = useCallback(() => {
    setLocation(null);
    setError("");
  }, []);

  return { location, error, capturing, capture, reset };
}

/** Best-effort reverse geocoding so the address field can be prefilled. */
export async function reverseGeocode(
  latitude: number,
  longitude: number,
): Promise<string> {
  try {
    const results = await Location.reverseGeocodeAsync({ latitude, longitude });
    const place = results[0];
    if (!place) return "";

    if ("formattedAddress" in place && place.formattedAddress) {
      return place.formattedAddress;
    }

    return [
      place.name,
      place.street,
      place.district ?? place.city,
      place.region,
      place.postalCode,
      place.country,
    ]
      .filter(Boolean)
      .join(", ");
  } catch {
    return "";
  }
}
