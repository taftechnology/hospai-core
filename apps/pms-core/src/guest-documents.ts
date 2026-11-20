import { SCAN_CONTENT_TYPES, type ScanContentType } from '@hospai/contracts';

/** Prefix for one document's scans. The object key appends a fresh nonce and carries no PII. */
export function guestDocObjectKey(orgId: string, documentId: string): string {
  return `guest-docs/${orgId}/${documentId}`;
}

export function isScanContentType(value: string): value is ScanContentType {
  return (SCAN_CONTENT_TYPES as readonly string[]).includes(value);
}

/** Magic bytes must match the declared Content-Type. */
export function scanMagicMatches(contentType: string, bytes: Uint8Array): boolean {
  if (contentType === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (contentType === 'image/png') {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return bytes.length >= sig.length && sig.every((b, i) => bytes[i] === b);
  }
  if (contentType === 'application/pdf') {
    return bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  }
  return false;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function scanFilename(documentId: string, contentType: string): string {
  const ext =
    contentType === 'image/jpeg' ? 'jpg' : contentType === 'image/png' ? 'png' : contentType === 'application/pdf' ? 'pdf' : 'bin';
  return `document-${documentId}.${ext}`;
}
