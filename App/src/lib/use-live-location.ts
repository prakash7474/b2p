import * as Location from "expo-location";
import { useCallback, useEffect, useRef, useState } from "react";

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

      // A single fix right after the GPS wakes up can be off by tens of metres,
      // so take fixes for a short window and keep the most accurate one.
      const best = await captureBestFix();
      const captured =
        best ??
        toCaptured(
          await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.BestForNavigation,
          }),
        );

      setLocation(captured);
      return captured;
    } catch (caught) {
      setError(positionErrorMessage(caught) ?? messageOf(caught));
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

export type TrackingOptions = {
  /** Minimum movement, in metres, before a new fix is reported. */
  distanceFilter?: number;
  /** Minimum milliseconds between fixes (Android only — iOS ignores it). */
  timeInterval?: number;
  /** Called for every fix received while tracking. */
  onFix?: (fix: CapturedLocation) => void;
};

/**
 * Continuous high-accuracy tracking — the watchPosition() equivalent for Expo.
 *
 * Uses the configuration production ride-hailing apps rely on: GPS/Wi-Fi rather
 * than cell towers (Accuracy.High), a fix only after 5 m of movement, and at most
 * one update every 2 s on Android. The subscription is removed when the component
 * unmounts, so tracking never outlives the screen that started it.
 */
export function useLiveTracking(options: TrackingOptions = {}) {
  const { distanceFilter = 5, timeInterval = 2000, onFix } = options;

  const [position, setPosition] = useState<CapturedLocation | null>(null);
  const [error, setError] = useState("");
  const [tracking, setTracking] = useState(false);

  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const onFixRef = useRef(onFix);

  useEffect(() => {
    onFixRef.current = onFix;
  }, [onFix]);

  const start = useCallback(async (): Promise<boolean> => {
    if (subscriptionRef.current) return true;
    setError("");

    try {
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled) {
        setError(
          "Location services are turned off on this device. Enable them in system settings, then try again.",
        );
        return false;
      }

      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setError(
          permission.canAskAgain
            ? "Location permission was denied. Allow location access to keep tracking your position."
            : "Location permission is blocked. Enable it for this app in system settings, then try again.",
        );
        return false;
      }

      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          distanceInterval: distanceFilter,
          timeInterval,
        },
        (update) => {
          const fix = toCaptured(update);
          setPosition(fix);
          onFixRef.current?.(fix);
        },
      );

      subscriptionRef.current = subscription;
      setTracking(true);
      return true;
    } catch (caught) {
      setError(positionErrorMessage(caught) ?? messageOf(caught));
      return false;
    }
  }, [distanceFilter, timeInterval]);

  const stop = useCallback(() => {
    subscriptionRef.current?.remove();
    subscriptionRef.current = null;
    setTracking(false);
  }, []);

  // Drop the subscription on unmount so the watcher never leaks.
  useEffect(() => {
    return () => {
      subscriptionRef.current?.remove();
      subscriptionRef.current = null;
    };
  }, []);

  return { position, tracking, error, start, stop };
}

/** How long to keep taking fixes, and how good a fix has to be to stop early. */
const BEST_FIX_WINDOW_MS = 4000;
const BEST_FIX_TARGET_METRES = 10;

/**
 * Watches at full GPS accuracy for up to `BEST_FIX_WINDOW_MS` and resolves with
 * the most accurate fix seen, returning as soon as one is accurate enough for
 * shop registration. Resolves with null if the watcher never delivers a fix —
 * callers fall back to a single `getCurrentPositionAsync` request.
 */
function captureBestFix(): Promise<CapturedLocation | null> {
  return new Promise<CapturedLocation | null>((resolve) => {
    let best: CapturedLocation | null = null;
    let bestAccuracy = Number.POSITIVE_INFINITY;
    let settled = false;
    let subscription: Location.LocationSubscription | null = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      subscription?.remove();
      subscription = null;
      resolve(best);
    };

    const timeout = setTimeout(finish, BEST_FIX_WINDOW_MS);

    Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        distanceInterval: 1,
        timeInterval: 500,
      },
      (update) => {
        if (settled) return;

        const fix = toCaptured(update);
        const accuracy = fix.accuracy ?? Number.POSITIVE_INFINITY;
        if (accuracy >= bestAccuracy) return;

        best = fix;
        bestAccuracy = accuracy;
        if (bestAccuracy <= BEST_FIX_TARGET_METRES) finish();
      },
    )
      .then((watch) => {
        // The window may already be closed by the time the watcher starts.
        if (settled) {
          watch.remove();
          return;
        }
        subscription = watch;
      })
      .catch(() => finish());
  });
}

function toCaptured(update: Location.LocationObject): CapturedLocation {
  return {
    latitude: update.coords.latitude,
    longitude: update.coords.longitude,
    accuracy: update.coords.accuracy ?? null,
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Browsers reject with a GeolocationPositionError ({ code, message }), which is not
 * an Error instance, so without this the user only sees a generic failure.
 */
function positionErrorMessage(caught: unknown): string | null {
  const code = (caught as { code?: unknown } | null)?.code;
  if (code === 1) {
    return "Location access is blocked for this site. Allow it from the icon left of the address bar, then reload.";
  }
  if (code === 2) {
    return "This device could not work out its position (common on desktop Linux browsers). Set a location in Chrome DevTools → Sensors, or use the app on your phone.";
  }
  if (code === 3) {
    return "Finding your location took too long. Move somewhere with better signal and try again.";
  }
  return null;
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
