import { useCallback, useRef, useState } from "react";

/**
 * Tracks an element's content width via a callback ref, so measurement starts whenever the element
 * mounts (including after loading states), not only on the component's first render.
 */
export function useElementWidth(): [(el: HTMLElement | null) => void, number] {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    setWidth(el.clientWidth);
    observer.current = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w !== undefined) setWidth(Math.floor(w));
    });
    observer.current.observe(el);
  }, []);
  return [ref, width];
}
