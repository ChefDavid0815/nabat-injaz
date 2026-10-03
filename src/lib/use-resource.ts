'use client';
import { useEffect, useState } from 'react';
import { api } from './client';
export function useResource<T>(url: string) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState<string | null>(null),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    api<T>(url, { signal: controller.signal })
      .then((value) => {
        setData(value);
        setError(null);
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setError(e.message);
      });
    return () => controller.abort();
  }, [url, revision]);
  return { data, error, reload: () => setRevision((v) => v + 1) };
}
