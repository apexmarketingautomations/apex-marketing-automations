import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { User } from "@shared/models/auth";
import { API } from "@/lib/api";

async function fetchUser(): Promise<User | null> {
  const response = await fetch(API.AUTH.USER, {
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

async function logout(): Promise<void> {
  await fetch(API.AUTH.LOGOUT, { method: "POST" });
  window.location.reload();
}

export function useAuth() {
  const queryClient = useQueryClient();

  const { data: user, isLoading } = useQuery<User | null>({
    queryKey: [API.AUTH.USER],
    queryFn: fetchUser,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.setQueryData([API.AUTH.USER], null);
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
