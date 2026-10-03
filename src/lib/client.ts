export async function api<T = Record<string, unknown>>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The request failed.');
  return data as T;
}
export const mutate = <T = Record<string, unknown>>(url: string, data: unknown, method = 'POST') =>
  api<T>(url, { method, body: JSON.stringify(data) });
export function dayAge(at: string | null) {
  return at ? Math.max(0, Math.floor((Date.now() - new Date(at).getTime()) / 86400000)) : null;
}
export function dateLabel(at: string, locale = 'en', timezone = 'Asia/Dubai') {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  }).format(new Date(at));
}
