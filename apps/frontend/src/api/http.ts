class HttpError extends Error {
  constructor(
    public status: number,
    public errorCode: string,
    message: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

const getToken = (): string | null => localStorage.getItem("casfa_jwt");

async function request<T>(url: string, options: RequestInit & { token?: string } = {}): Promise<T> {
  const token = options.token ?? getToken();
  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string>) ?? {}),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  // Only set Content-Type for JSON if not already set and body is not FormData/Blob
  if (options.body && typeof options.body === "string" && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, { ...options, headers });

  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => ({ error: "UNKNOWN", message: response.statusText }));
    throw new HttpError(
      response.status,
      body.error ?? "UNKNOWN",
      body.message ?? response.statusText
    );
  }

  // Handle empty responses
  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get("Content-Type");
  if (contentType?.includes("application/json")) {
    return response.json();
  }
  // Return response itself for binary/stream data
  return response as unknown as T;
}

export const http = {
  get: <T>(url: string, opts?: { headers?: Record<string, string>; token?: string }) =>
    request<T>(url, { method: "GET", ...opts }),

  post: <T>(
    url: string,
    body?: unknown,
    opts?: { headers?: Record<string, string>; token?: string }
  ) =>
    request<T>(url, {
      method: "POST",
      body: body != null ? JSON.stringify(body) : undefined,
      ...opts,
    }),

  put: <T>(
    url: string,
    body?: BodyInit,
    opts?: { headers?: Record<string, string>; token?: string }
  ) => request<T>(url, { method: "PUT", body, ...opts }),

  patch: <T>(
    url: string,
    body?: unknown,
    opts?: { headers?: Record<string, string>; token?: string }
  ) =>
    request<T>(url, {
      method: "PATCH",
      body: body != null ? JSON.stringify(body) : undefined,
      ...opts,
    }),

  delete: <T>(url: string, opts?: { headers?: Record<string, string>; token?: string }) =>
    request<T>(url, { method: "DELETE", ...opts }),
};

export { HttpError };
