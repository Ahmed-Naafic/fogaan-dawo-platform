import { useEffect, useState } from 'react';
import { useAuth } from '@/features/auth/AuthProvider';
import { getMyPhoto } from './services/profileApi';

/**
 * Object URL of the signed-in user's own (private) photo, or null. The photo version comes from the
 * session user (`photoUpdatedAt`); one shared fetch per version, revoked when the version changes.
 */
const cache = { version: null, promise: null, url: null };

function load(version) {
  if (cache.version === version && cache.promise) return cache.promise;
  if (cache.url) URL.revokeObjectURL(cache.url);
  cache.version = version;
  cache.url = null;
  cache.promise = getMyPhoto()
    .then((blob) => {
      if (cache.version !== version) return null;
      cache.url = URL.createObjectURL(blob);
      return cache.url;
    })
    .catch(() => null);
  return cache.promise;
}

export default function useOwnPhoto() {
  const { session } = useAuth();
  const version = session?.user?.photoUpdatedAt ?? null;
  const [url, setUrl] = useState(() => (version && cache.version === version ? cache.url : null));

  useEffect(() => {
    let live = true;
    if (!version) {
      setUrl(null);
      return undefined;
    }
    load(version).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [version]);

  return url;
}
