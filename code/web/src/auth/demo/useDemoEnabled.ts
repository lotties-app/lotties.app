import { useEffect, useState } from 'react';
import { fetchDemoInfo, type DemoInfo } from './startDemo';

/** The server's demo offer (`null` while unknown, or when it is off or unreachable): the landing button shows only for an enabled one. */
export function useDemoEnabled(): DemoInfo | null {
  const [info, setInfo] = useState<DemoInfo | null>(null);
  useEffect(() => {
    let active = true;
    void fetchDemoInfo().then((value) => {
      if (active) setInfo(value?.enabled ? value : null);
    });
    return () => {
      active = false;
    };
  }, []);
  return info;
}
