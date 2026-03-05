import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { getStoredToken, handleGlobal401 } from "@/lib/auth";

function getAuthHeaders(): Record<string, string> {
  const token = getStoredToken();
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }
  return {};
}

async function handleResponse(res: Response): Promise<void> {
  if (res.status === 401) {
    handleGlobal401();
    throw new Error("Session expired — please log in again");
  }
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
  const headers: Record<string, string> = {
    ...getAuthHeaders(),
  };
  if (data) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await handleResponse(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      headers: getAuthHeaders(),
      credentials: "include",
    });

    if (res.status === 401) {
      if (unauthorizedBehavior === "returnNull") {
        return null;
      }
      handleGlobal401();
      throw new Error("Session expired — please log in again");
    }

    if (!res.ok) {
      const text = (await res.text()) || res.statusText;
      throw new Error(`${res.status}: ${text}`);
    }

    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 300000,
      gcTime: 600000,
      retry: (failureCount, error) => {
        if (error instanceof Error && error.message.includes("Session expired")) {
          return false;
        }
        return failureCount < 2;
      },
    },
    mutations: {
      retry: false,
    },
  },
});
