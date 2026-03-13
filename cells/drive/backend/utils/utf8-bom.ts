/**
 * UTF-8 BOM bytes. Prepend to text/* content so browsers/editors recognize encoding.
 */
export const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf]);

/**
 * If contentType is text/*, prepend UTF-8 BOM to bytes; otherwise return bytes as-is.
 */
export function prependUtf8BomIfText(contentType: string, bytes: Uint8Array): Uint8Array {
  if (!contentType.startsWith("text/")) return bytes;
  const out = new Uint8Array(UTF8_BOM.length + bytes.length);
  out.set(UTF8_BOM);
  out.set(bytes, UTF8_BOM.length);
  return out;
}
