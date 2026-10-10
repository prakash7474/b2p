import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { api, type VendorProfile } from "./api";

export type Session = {
  userId: string;
  email: string;
  login: string;
  role: string;
};

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

type AuthContextValue = {
  session: Session | null;
  vendor: VendorProfile | null;
  /** Stable id used for every vendor-scoped backend route. */
  vendorId: string;
  signIn: (login: string, password: string) => Promise<void>;
  signUp: (input: SignUpInput) => Promise<void>;
  signOut: () => void;
  refreshVendor: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [vendor, setVendor] = useState<VendorProfile | null>(null);

  const loadProfile = useCallback(async (userId: string): Promise<VendorProfile | null> => {
    // GET /vendors/{id} resolves by vendor_id or Mongo _id; GET /users/{id}
    // is the fallback for accounts whose user_id points elsewhere.
    const profile = (await api.getVendor(userId)) ?? (await api.getUser(userId));
    return profile;
  }, []);

  const signIn = useCallback(
    async (login: string, password: string) => {
      const data = await api.login(login.trim(), password);

      if (data.role !== "vendor") {
        throw new Error("This account is not a vendor account. Use a vendor login instead.");
      }

      const profile = await loadProfile(data.user_id);

      if (!profile) {
        throw new Error("Signed in, but no vendor profile was found for this account.");
      }

      setSession({
        userId: data.user_id,
        email: data.email ?? String(profile.email ?? login.trim()),
        login: login.trim(),
        role: data.role,
      });
      setVendor(profile);
    },
    [loadProfile],
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

  const signOut = useCallback(() => {
    setSession(null);
    setVendor(null);
  }, []);

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
      vendorId,
      signIn,
      signUp,
      signOut,
      refreshVendor,
    };
  }, [session, vendor, signIn, signUp, signOut, refreshVendor]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside an AuthProvider");
  }
  return context;
}

export { messageOf };
