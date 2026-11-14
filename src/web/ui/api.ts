export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

type ErrorPayload = {
  error?: string;
  detail?: string;
  message?: string;
};

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('content-type')) headers.set('content-type', 'application/json');

  const response = await fetch(path, { ...init, headers });
  const payload = await response.json().catch(() => null) as T | ErrorPayload | null;
  if (!response.ok) {
    const error = payload as ErrorPayload | null;
    throw new ApiError(
      response.status,
      typeof error?.error === 'string' ? error.error : null,
      error?.detail ?? error?.message ?? `Request failed (${response.status})`,
    );
  }
  return payload as T;
}
