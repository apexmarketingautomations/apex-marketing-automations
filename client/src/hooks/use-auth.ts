import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { User } from "@shared/models/auth";
import { firebaseSignOut } from "@/lib/firebase";

async function fetchUser(): Promise<(User & { role?: string; authProvider?: string }) | null> {
  const response = await fetch("/api/auth/user", {
    credentials: "include",
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`${response.status}: ${response.statusText}`);
  }

  return response.json();
}

export function useAuth() {
  const queryClient = useQueryClient();
  const { data: user, isLoading } = useQuery<(User & { role?: string; authProvider?: string }) | null>({
    queryKey: ["/api/auth/user"],
    queryFn: fetchUser,
    retry: false,
    staleTime: 1000 * 60 * 5,
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      if (user?.authProvider === "email" || user?.authProvider === "google") {
        await fetch("/api/auth/apex-logout", { method: "POST", credentials: "include" });
        queryClient.setQueryData(["/api/auth/user"], null);
        window.location.href = "/login";
      } else if (user?.authProvider === "firebase") {
        await firebaseSignOut();
        await fetch("/api/auth/apex-logout", { method: "POST", credentials: "include" });
        queryClient.setQueryData(["/api/auth/user"], null);
        window.location.href = "/login";
      } else {
        window.location.href = "/api/logout";
      }
    },
    onSuccess: () => {
      queryClient.setQueryData(["/api/auth/user"], null);
      // ELU Analytics: clear the identified user so the next session starts anonymous
      if (typeof window !== "undefined" && (window as any).elu) {
        (window as any).elu.reset();
      }
    },
  });

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    logout: logoutMutation.mutate,
    isLoggingOut: logoutMutation.isPending,
  };
}
