import { useEffect, useState } from "react";

export function useNarrowLayout(breakpoint = 768): boolean {
  const [narrow, setNarrow] = useState(() => window.innerWidth <= breakpoint);

  useEffect(() => {
    const update = () => setNarrow(window.innerWidth <= breakpoint);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [breakpoint]);

  return narrow;
}