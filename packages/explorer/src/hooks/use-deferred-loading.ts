/**
 * useDeferredLoading — delays showing a loading indicator to avoid flicker.
 *
 * Returns `true` only after `loading` has been continuously `true` for at
 * least `delayMs` milliseconds. This prevents brief skeleton / spinner
 * flashes for fast operations.
 */

import { useEffect, useState } from "react";

const DEFAULT_DELAY_MS = 300;

export function useDeferredLoading(loading: boolean, delayMs = DEFAULT_DELAY_MS): boolean {
  const [showLoading, setShowLoading] = useState(false);

  useEffect(() => {
    if (!loading) {
      setShowLoading(false);
      return;
    }
    const timer = setTimeout(() => setShowLoading(true), delayMs);
    return () => clearTimeout(timer);
  }, [loading, delayMs]);

  return showLoading;
}
