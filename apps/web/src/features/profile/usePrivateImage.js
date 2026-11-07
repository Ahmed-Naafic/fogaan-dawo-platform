import { useEffect, useState } from 'react';
import { apiRequest } from '@/lib/apiClient';

/**
 * Object URL for a private, authorised image path from the API (e.g. the assigned doctor's patient photo
 * "/v1/doctors/me/patients/<id>/photo?appointmentId=…&v=…"). Fetched with the in-memory access token —
 * an <img src> could not send it — and shared between components showing the same path. Paths are
 * versioned, so a cached entry never goes stale; the cache is bounded and revokes the oldest URLs.
 */
const MAX_ENTRIES = 120;
const cache = new Map(); // path -> Promise<string | null>

function load(path) {
  if (cache.has(path)) return cache.get(path);
  const promise = apiRequest(path, { responseType: 'blob' })
    .then((blob) => URL.createObjectURL(blob))
    .catch(() => {
      cache.delete(path); // retry on a later render (e.g. after a refresh)
      return null;
    });
  cache.set(path, promise);
  if (cache.size > MAX_ENTRIES) {
    const [oldest, old] = cache.entries().next().value;
    cache.delete(oldest);
    old.then((url) => url && URL.revokeObjectURL(url));
  }
  return promise;
}

export default function usePrivateImage(path) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!path) {
      setUrl(null);
      return undefined;
    }
    let live = true;
    load(path).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [path]);
  return url;
}
