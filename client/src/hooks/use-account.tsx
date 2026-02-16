import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import type { SubAccount } from "@shared/schema";

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
