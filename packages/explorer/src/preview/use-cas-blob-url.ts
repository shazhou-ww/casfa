/**
 * useCasBlobUrl — Fetch from a CAS URL with auth and return a blob: URL.
 *
 * Browser elements like <img>, <video>, <audio> cannot set Authorization
 * headers on their src requests. This hook does the fetch manually with
 * the client's access token, then creates an object URL for the element.
 *
 * When a Service Worker is active, it intercepts the fetch and applies
 * cache-first + auth injection automatically.  When no SW is available
 * (e.g. dev mode), the hook's own Authorization header ensures the
 * request succeeds.
 *
 * Falls back to creating an object URL from the provided blob prop
 * if casUrl is not available or the fetch fails.
 */

import { useEffect, useRef, useState } from "react";
import { useExplorerStore } from "../hooks/use-explorer-context.ts";

/**
 * Fetch content from a CAS URL (with auth) and return a usable blob: URL.
 *
 * @param casUrl  - The CAS content URL, e.g. `/cas/nod_XXX`
 * @param fallbackBlob - Optional blob to use if casUrl is unavailable or fetch fails
 * @returns A blob: URL string, or "" while loading
 */
export function useCasBlobUrl(
  casUrl: string | null | undefined,
  fallbackBlob?: Blob,
): string {
  const client = useExplorerStore((s) => s.client);
  const [url, setUrl] = useState("");
  const prevUrlRef = useRef("");

  useEffect(() => {
    let cancelled = false;

    // Revoke the previous URL before creating a new one
    if (prevUrlRef.current) {
      URL.revokeObjectURL(prevUrlRef.current);
      prevUrlRef.current = "";
    }

    (async () => {
      // Try fetching from CAS URL with auth
      if (casUrl) {
        try {
          const token = await client.getAccessToken();
          const headers: HeadersInit = {};
          if (token) {
            headers.Authorization = `Bearer ${token.tokenBase64}`;
          }

          const res = await fetch(casUrl, { headers });
          if (cancelled) return;

          if (res.ok) {
            const blob = await res.blob();
            if (cancelled) return;
            const objectUrl = URL.createObjectURL(blob);
            prevUrlRef.current = objectUrl;
            setUrl(objectUrl);
            return;
          }
        } catch {
          if (cancelled) return;
        }
      }

      // Fallback to blob prop
      if (fallbackBlob) {
        const objectUrl = URL.createObjectURL(fallbackBlob);
        prevUrlRef.current = objectUrl;
        if (!cancelled) setUrl(objectUrl);
      } else {
        if (!cancelled) setUrl("");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [casUrl, fallbackBlob, client]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (prevUrlRef.current) {
        URL.revokeObjectURL(prevUrlRef.current);
        prevUrlRef.current = "";
      }
    };
  }, []);

  return url;
}
