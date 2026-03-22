import { QueryClient, QueryFunction } from "@tanstack/react-query";

export function getCsrfToken(): string | undefined {
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : undefined;
}

const originalFetch = window.fetch.bind(window);
window.fetch = function csrfFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const isApiPath = url.startsWith("/api") || (url.startsWith(window.location.origin) && new URL(url).pathname.startsWith("/api"));
    if (isApiPath) {
      const csrfToken = getCsrfToken();
      if (csrfToken) {
        const headers = new Headers(init?.headers);
        if (!headers.has("x-csrf-token")) {
          headers.set("x-csrf-token", csrfToken);
        }
        init = { ...init, headers };
      }
    }
  }
  return originalFetch(input, init);
};

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (data) headers["Content-Type"] = "application/json";
  const csrfToken = getCsrfToken();
  if (csrfToken && method !== "GET" && method !== "HEAD") {
    headers["x-csrf-token"] = csrfToken;
  }
  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
