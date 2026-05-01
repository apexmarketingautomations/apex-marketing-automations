import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import type { SubAccount } from "@shared/schema";

// Account identity config — controls how each account looks and behaves in the UI
export const ACCOUNT_IDENTITY: Record<number, {
  color: string;
  badge: string;
  role: "admin" | "client" | "internal";
  needsSetup?: boolean;
}> = {
  13: { color: "#6366f1", badge: "ADMIN",   role: "admin" },      // Apex Marketing — head account
  21: { color: "#ec4899", badge: "LAYLA",   role: "admin" },      // Officer Layla — influencer + admin
  14: { color: "#f59e0b", badge: "CLIENT",  role: "client" },     // Giovanni — starter, top-ups only
  22: { color: "#10b981", badge: "SETUP",   role: "client", needsSetup: true }, // Roof 2 Roots — paid, not set up
  27: { color: "#3b82f6", badge: "SETUP",   role: "client", needsSetup: true }, // Lauren — paid, just signed in
};

export function getAccountIdentity(id: number | null) {
  if (!id) return { color: "#6366f1", badge: "APEX", role: "admin" as const };
  return ACCOUNT_IDENTITY[id] ?? { color: "#6366f1", badge: "CLIENT", role: "client" as const };
}

interface AccountContextValue {
  activeAccountId: number | null;
  setActiveAccountId: (id: number | null) => void;
}

const AccountContext = createContext<AccountContextValue>({
  activeAccountId: null,
  setActiveAccountId: () => {},
});

export function AccountProvider({ children }: { children: ReactNode }) {
  const [activeAccountId, setActiveAccountIdState] = useState<number | null>(() => {
    const stored = localStorage.getItem("apex_active_account");
    return stored ? parseInt(stored, 10) : null;
  });

  const setActiveAccountId = useCallback((id: number | null) => {
    setActiveAccountIdState(id);
    if (id !== null) {
      localStorage.setItem("apex_active_account", String(id));
    } else {
      localStorage.removeItem("apex_active_account");
    }
  }, []);

  return (
    <AccountContext.Provider value={{ activeAccountId, setActiveAccountId }}>
      {children}
    </AccountContext.Provider>
  );
}

export function useAccount() {
  return useContext(AccountContext);
}
