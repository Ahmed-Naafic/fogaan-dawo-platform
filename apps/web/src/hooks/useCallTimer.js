import { useEffect, useState } from 'react';
import { formatClock } from '@/lib/format';

/** Ticking mm:ss call clock that starts from `start` seconds. */
export default function useCallTimer(start) {
  const [secs, setSecs] = useState(start);
  useEffect(() => {
    const id = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return formatClock(secs);
}
