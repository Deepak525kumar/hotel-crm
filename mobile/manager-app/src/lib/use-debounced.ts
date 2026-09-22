import { useEffect, useState } from 'react';

/**
 * Delays a fast-changing value so a search box does not fire one request per
 * keystroke.
 *
 * A manager typing a six-letter hotel name on a hotel's wifi would otherwise
 * make six round trips and render the results of whichever returned last --
 * which is not necessarily the one matching what is on screen.
 */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}
