import { useEffect, useRef, useState } from "react";

const START_MS = 2000;
const MAX_MS = 15000;

/**
 * Polling interval for a running job: starts at 2 s, backs off x1.5 up to 15 s
 * while nothing changes, resets to 2 s when progress advances, and returns
 * `false` (stop polling) when idle.
 *
 * `progressKey` must change when progress changes; `tick` must change on every
 * fetch (use the query's `dataUpdatedAt`) so back-off advances per poll.
 */
export function usePollingInterval(active: boolean, progressKey: string, tick: number): number | false {
  const [ms, setMs] = useState(START_MS);
  const last = useRef(progressKey);

  useEffect(() => {
    if (!active) {
      last.current = progressKey;
      setMs(START_MS);
      return;
    }
    if (progressKey !== last.current) {
      last.current = progressKey;
      setMs(START_MS);
    } else {
      setMs((v) => Math.min(Math.round(v * 1.5), MAX_MS));
    }
  }, [tick, active, progressKey]);

  return active ? ms : false;
}
