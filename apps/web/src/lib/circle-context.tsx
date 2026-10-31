import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useCircles } from './queries';

/** The circle currently in focus across Overview / Map. null = all circles. */
const Ctx = createContext<{ circleId: string | null; setCircleId: (id: string | null) => void }>({ circleId: null, setCircleId: () => {} });
export const useActiveCircle = () => useContext(Ctx);

const KEY = 'nodara.circle';
export function ActiveCircleProvider({ children }: { children: ReactNode }) {
  const { data: circles } = useCircles();
  const [circleId, setState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(KEY) || null;
    } catch {
      return null;
    }
  });
  const setCircleId = (id: string | null) => {
    setState(id);
    try {
      if (id) localStorage.setItem(KEY, id);
      else localStorage.removeItem(KEY);
    } catch {}
  };
  // Drop a stale selection (left or deleted circle).
  useEffect(() => {
    if (circles && circleId && !circles.some((c) => c.id === circleId)) setCircleId(null);
  }, [circles, circleId]);
  return <Ctx.Provider value={{ circleId, setCircleId }}>{children}</Ctx.Provider>;
}
