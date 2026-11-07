/**
 * Sends a private document. Always as an attachment with a sandboxing CSP, so even a crafted file can
 * never run as a page on the API origin; the web client fetches it with the bearer token and shows it
 * from a blob URL. Responses are never cached (global Cache-Control: no-store).
 */
export function sendPrivateDocument(res, { buffer, fileName, mimeType }) {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Length', String(buffer.length));
  res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.status(200).end(buffer);
}
