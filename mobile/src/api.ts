export const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8000').replace(
  /\/$/,
  '',
);

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function request<T>(
  path: string,
  token?: string | null,
  body?: unknown,
  method = 'GET',
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${API_URL}/api${path}`, {
      method,
      signal: controller.signal,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (response.status === 204) return undefined as T;
    const data = await response.json();
    if (!response.ok) {
      const detail = Array.isArray(data.detail)
        ? data.detail.map((item: { msg: string }) => item.msg).join('\n')
        : data.detail;
      throw new ApiError(
        response.status,
        typeof detail === 'string' ? detail : 'Something went wrong. Please try again.',
      );
    }
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new Error('Cannot reach Hishob. Check your connection and the API server address.');
  } finally {
    clearTimeout(timeout);
  }
}
