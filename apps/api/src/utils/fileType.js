/**
 * Server-side file validation. The browser's filename and Content-Type are never trusted:
 * the type is detected from the file's own leading bytes ("magic numbers").
 */
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024; // 5 MB

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Returns { mime, ext } for PDF, JPEG or PNG content, or null for anything else. */
export function detectDocumentType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return null;
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return { mime: 'image/png', ext: 'png' };
  return null;
}

/**
 * A display-only file name: no path parts, no control or reserved characters, bounded length, and the
 * extension forced to match the detected type. It is never used to build a storage path.
 */
export function safeDisplayName(rawName, ext) {
  let name = '';
  try {
    name = decodeURIComponent(String(rawName ?? ''));
  } catch {
    name = String(rawName ?? '');
  }
  name = name.split(/[\\/]/).pop() ?? '';
  name = name
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.[A-Za-z0-9]{1,8}$/, '');
  if (!name || /^\.+$/.test(name)) name = 'document';
  return `${name.slice(0, 100)}.${ext}`;
}
