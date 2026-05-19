import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import type { SubAccount } from "@shared/schema";

// Account identity config — controls how each account looks and behaves in the UI.
// primary: true marks the default account to activate when no stored preference exists.
export const ACCOUNT_IDENTITY: Record<number, {
  color: string;
  badge: string;
  role: "admin" | "client" | "internal";
  primary?: boolean;
  needsSetup?: boolean;
}> = {
  1:  { color: "#ec4899", badge: "LAYLA",  role: "internal" },                    // Officer Layla — persona account
  2:  { color: "#10b981", badge: "SETUP",  role: "client", needsSetup: true },    // Roof 2 Roots — client
  3:  { color: "#6366f1", badge: "ADMIN",  role: "admin", primary: true },        // APEX MARKETING — primary platform account
  4:  { color: "#f59e0b", badge: "CLIENT", role: "client" },                      // Crash Connect — Giovanni
};

export function getAccountIdentity(id: number | null) {
  if (!id) return { color: "#6366f1", badge: "APEX", role: "admin" as const };
  return ACCOUNT_IDENTITY[id] ?? { color: "#6366f1", badge: "CLIENT", role: "client" as const };
}

/** Returns the account ID to activate by default (primary flag → lowest ID fallback). */
export function getPrimaryAccountId(accounts: { id: number }[]): number | null {
  if (accounts.length === 0) return null;
  const primary = accounts.find(a => ACCOUNT_IDENTITY[a.id]?.primary);
  return (primary ?? accounts[0]).id;
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
    if (stored) return parseInt(stored, 10);
    return import.meta.env.DEV ? 3 : null;
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
