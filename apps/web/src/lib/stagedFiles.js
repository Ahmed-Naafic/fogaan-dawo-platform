import { ApiRequestError, apiUrl } from '@/lib/apiClient';

/**
 * Large-file transfer that works within Vercel's request/response limits:
 *
 *   upload:   ask the API for an upload slot (authorised) → PUT the file straight to storage (staging)
 *             → ask the API to finalise (it validates the real bytes before anything is recorded)
 *   download: ask the API for a short-lived signed URL (authorised + audited) → fetch the bytes from it
 *
 * The browser never holds storage credentials; a signed URL names exactly one object and expires quickly.
 * URLs are absolute (Supabase) or relative to the API base (local development driver).
 */
const resolve = (url) => (/^https?:\/\//i.test(url) ? url : apiUrl(url));

const EXT_TYPES = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
export const declaredType = (file) => (['application/pdf', 'image/jpeg', 'image/png'].includes(file.type) ? file.type : EXT_TYPES[String(file.name).split('.').pop()?.toLowerCase()] ?? file.type ?? '');

/**
 * @param initiate  (declared) => Promise<{ uploadToken, upload: { url, method, headers } }>
 * @param finalize  (uploadToken) => Promise<record>
 */
export async function uploadViaStaging(file, { initiate, finalize }) {
  const contentType = declaredType(file);
  const intent = await initiate({ fileName: file.name, size: file.size, contentType });
  let response;
  try {
    response = await fetch(resolve(intent.upload.url), {
      method: intent.upload.method || 'PUT',
      headers: { ...(intent.upload.headers ?? {}), 'Content-Type': contentType || 'application/octet-stream' },
      body: file,
    });
  } catch {
    throw new ApiRequestError(0, 'NETWORK_ERROR', 'Network error');
  }
  if (!response.ok) throw new ApiRequestError(response.status, response.status === 413 ? 'PAYLOAD_TOO_LARGE' : 'UPLOAD_FAILED', 'The upload did not complete');
  return finalize(intent.uploadToken);
}

/** Fetches the bytes behind a signed URL issued by `getSignedUrl()` (returns a Blob). */
export async function fetchSignedBlob(getSignedUrl) {
  const { url } = await getSignedUrl();
  let response;
  try {
    response = await fetch(resolve(url), { credentials: 'omit' });
  } catch {
    throw new ApiRequestError(0, 'NETWORK_ERROR', 'Network error');
  }
  if (!response.ok) throw new ApiRequestError(response.status, response.status === 403 ? 'DOWNLOAD_LINK_INVALID' : 'DOWNLOAD_FAILED', 'The download did not complete');
  return response.blob();
}
