import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  api,
  setAuthToken,
  type CustomerLocation,
  type CustomerProfile,
  type NearbyVendor,
  type VendorProfile,
} from "./api";
import { LoadingScreen } from "@/src/components/layout";

import { loadSavedSession, saveSession } from "./storage";

export type Session = {
  userId: string;
  email: string;
  login: string;
  role: string;
  /** Bearer token from /login or /customers/login. */
  token: string;
};

/** What is kept on the device between launches. */
type SavedSession = { session: Session; customer?: CustomerProfile | null };

export type SignUpInput = {
  vendorId: string;
  shopName: string;
  email: string;
  password: string;
  phone: string;
  address: string;
  latitude: number;
  longitude: number;
};

export type CustomerSignUpInput = {
  name: string;
  email: string;
  password: string;
  phone: string;
  address?: string;
  latitude?: number;
  longitude?: number;
};

type AuthContextValue = {
  session: Session | null;
  vendor: VendorProfile | null;
  /** Signed-in customer profile (customer sessions only). */
  customer: CustomerProfile | null;
  /** Vendors with stock near the customer's last known location. */
  nearbyVendors: NearbyVendor[];
  /** Location used for the last nearby-vendors search. */
  customerLocation: CustomerLocation | null;
  /** Stable id used for every vendor-scoped backend route. */
  vendorId: string;
  signIn: (login: string, password: string) => Promise<void>;
  signUp: (input: SignUpInput) => Promise<void>;
  signInCustomer: (login: string, password: string, location?: CustomerLocation) => Promise<void>;
  signUpCustomer: (input: CustomerSignUpInput) => Promise<void>;
  /** Re-runs the geo search at the given coordinates (defaults to 5 km). */
  loadNearby: (latitude: number, longitude: number, radiusMeters?: number) => Promise<void>;
  signOut: () => void;
  refreshVendor: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Seed vendors store camelCase / flat fields (verificationStatus, localityTier,
 * top-level latitude/address, GeoJSON `location`); app-created vendors store
 * status, locality_tier and location.{latitude,longitude,address}.
 */
function normalizeVendor(vendor: VendorProfile): VendorProfile {
  const loc = (vendor.location ?? {}) as VendorProfile["location"] & { coordinates?: number[] };
  return {
    ...vendor,
    status: vendor.status ?? (vendor.verificationStatus as string | undefined),
    locality_tier: vendor.locality_tier ?? (vendor.localityTier as string | undefined),
    location: {
      latitude: loc.latitude ?? (vendor.latitude as number | undefined) ?? loc.coordinates?.[1] ?? null,
      longitude: loc.longitude ?? (vendor.longitude as number | undefined) ?? loc.coordinates?.[0] ?? null,
      address: loc.address ?? (vendor.address as string | undefined) ?? "",
    },
  };
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  // Some platform errors are plain objects that still carry a message.
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" && message ? message : "Something went wrong. Please try again.";
}

/** Extracts a usable {latitude, longitude} from a customer profile, if any. */
function profileLocation(profile: CustomerProfile | null): CustomerLocation | null {
  const loc = profile?.location;
  if (typeof loc?.latitude === "number" && typeof loc?.longitude === "number") {
    return { latitude: loc.latitude, longitude: loc.longitude, address: loc.address ?? "" };
  }
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [vendor, setVendor] = useState<VendorProfile | null>(null);
  const [customer, setCustomer] = useState<CustomerProfile | null>(null);
  const [nearbyVendors, setNearbyVendors] = useState<NearbyVendor[]>([]);
  const [customerLocation, setCustomerLocation] = useState<CustomerLocation | null>(null);

  const signOut = useCallback(() => {
    setAuthToken("");
    void saveSession(null);
    setSession(null);
    setVendor(null);
    setCustomer(null);
    setNearbyVendors([]);
    setCustomerLocation(null);
  }, []);

  /** Start sending the token and remember the session for the next launch. */
  const keep = useCallback(
    (next: Session, profile: CustomerProfile | null = null) => {
      setAuthToken(next.token, signOut);
      void saveSession(JSON.stringify({ session: next, customer: profile } satisfies SavedSession));
      setSession(next);
    },
    [signOut],
  );

  const loadProfile = useCallback(async (userId: string): Promise<VendorProfile | null> => {
    // GET /vendors/{id} resolves by vendor_id or Mongo _id; GET /users/{id}
    // is the fallback for accounts whose user_id points elsewhere.
    const profile = (await api.getVendor(userId)) ?? (await api.getUser(userId));
    return profile && normalizeVendor(profile);
  }, []);

  const signIn = useCallback(
    async (login: string, password: string) => {
      const data = await api.login(login.trim(), password);

      if (data.role !== "vendor") {
        throw new Error("This account is not a vendor account. Use a vendor login instead.");
      }

      setAuthToken(data.token, signOut);
      const profile = await loadProfile(data.user_id);

      if (!profile) {
        setAuthToken("");
        throw new Error("Signed in, but no vendor profile was found for this account.");
      }

      keep({
        userId: data.user_id,
        email: data.email ?? String(profile.email ?? login.trim()),
        login: login.trim(),
        role: data.role,
        token: data.token,
      });
      setVendor(profile);
    },
    [keep, loadProfile, signOut],
  );

  const signUp = useCallback(
    async (input: SignUpInput) => {
      const email = input.email.trim();

      const result = await api.createVendor({
        vendor_id: input.vendorId,
        shop_name: input.shopName.trim(),
        email,
        password: input.password,
        phone: input.phone.trim(),
        location: {
          latitude: input.latitude,
          longitude: input.longitude,
          address: input.address.trim(),
        },
      });

      if (!result?.vendor) {
        throw new Error("Vendor account could not be created.");
      }

      // main.py creates the matching `users` document with is_verified=true,
      // so the standard login flow can be used right away.
      await signIn(email, input.password);
    },
    [signIn],
  );

  const signInCustomer = useCallback(
    async (login: string, password: string, location?: CustomerLocation) => {
      const data = await api.customerLogin(login.trim(), password, location);
      const profile = data.customer ?? null;

      if (!profile) {
        throw new Error("Signed in, but no customer profile was found for this account.");
      }

      keep(
        {
          userId: String(profile._id ?? profile.customer_id ?? login.trim()),
          email: String(profile.email ?? login.trim()),
          login: login.trim(),
          role: "customer",
          token: data.token,
        },
        profile,
      );
      setCustomer(profile);
      setNearbyVendors(data.nearby_vendors ?? []);
      setCustomerLocation(location ?? profileLocation(profile));
    },
    [keep],
  );

  const signUpCustomer = useCallback(
    async (input: CustomerSignUpInput) => {
      const email = input.email.trim();

      const result = await api.customerRegister({
        name: input.name.trim(),
        email,
        password: input.password,
        phone: input.phone.trim(),
        location:
          typeof input.latitude === "number" && typeof input.longitude === "number"
            ? {
                latitude: input.latitude,
                longitude: input.longitude,
                address: input.address?.trim() ?? "",
              }
            : undefined,
      });

      if (!result?.customer) {
        throw new Error("Customer account could not be created.");
      }

      // /customers/register only stores the profile; sign in through the
      // customer login so the session and nearby vendors are loaded too.
      await signInCustomer(
        email,
        input.password,
        typeof input.latitude === "number" && typeof input.longitude === "number"
          ? { latitude: input.latitude, longitude: input.longitude, address: input.address?.trim() ?? "" }
          : undefined,
      );
    },
    [signInCustomer],
  );

  const loadNearby = useCallback(
    async (latitude: number, longitude: number, radiusMeters = 5000) => {
      const vendors = await api.getNearbyVendors(latitude, longitude, radiusMeters);
      setNearbyVendors(vendors);
      setCustomerLocation((previous) => ({
        latitude,
        longitude,
        address: previous?.address ?? "",
      }));
    },
    [],
  );

  // Restore the saved session once on launch; an expired token signs out via the 401 handler.
  useEffect(() => {
    void (async () => {
      try {
        const raw = await loadSavedSession();
        const saved = raw ? (JSON.parse(raw) as SavedSession) : null;
        if (saved?.session?.token) {
          setAuthToken(saved.session.token, signOut);
          if (saved.session.role === "customer") {
            setCustomer(saved.customer ?? null);
            setCustomerLocation(profileLocation(saved.customer ?? null));
            setSession(saved.session);
          } else {
            const profile = await loadProfile(saved.session.userId);
            if (profile) {
              setVendor(profile);
              setSession(saved.session);
            }
          }
        }
      } catch {
        // Unreadable saved session: start signed out.
      } finally {
        setReady(true);
      }
    })();
  }, [loadProfile, signOut]);

  const refreshVendor = useCallback(async () => {
    if (!session) return;
    const profile = await loadProfile(session.userId);
    if (profile) setVendor(profile);
  }, [loadProfile, session]);

  const value = useMemo<AuthContextValue>(() => {
    const vendorId =
      (vendor?.vendor_id && String(vendor.vendor_id)) ||
      (vendor?._id && String(vendor._id)) ||
      (session?.userId ?? "");

    return {
      session,
      vendor,
      customer,
      nearbyVendors,
      customerLocation,
      vendorId,
      signIn,
      signUp,
      signInCustomer,
      signUpCustomer,
      loadNearby,
      signOut,
      refreshVendor,
    };
  }, [
    session,
    vendor,
    customer,
    nearbyVendors,
    customerLocation,
    signIn,
    signUp,
    signInCustomer,
    signUpCustomer,
    loadNearby,
    signOut,
    refreshVendor,
  ]);

  // Route guards only run once the saved session has been checked, so a reload
  // does not bounce a signed-in user to the login screen.
  return (
    <AuthContext.Provider value={value}>
      {ready ? children : <LoadingScreen label="Loading..." />}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside an AuthProvider");
  }
  return context;
}

export { messageOf };
