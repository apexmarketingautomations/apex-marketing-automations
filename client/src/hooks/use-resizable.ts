import { useState, useRef, useCallback, type MouseEvent, type TouchEvent } from "react";

interface Size {
  width: number;
  height: number;
}

export function useResizable(defaultWidth: number, defaultHeight: number, minWidth = 320, minHeight = 400) {
  const [size, setSize] = useState<Size>({ width: defaultWidth, height: defaultHeight });
  const resizing = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });
  const startSize = useRef<Size>({ width: defaultWidth, height: defaultHeight });

  const onResizeStart = useCallback((e: MouseEvent | TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = true;
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    startPos.current = { x: clientX, y: clientY };
    startSize.current = { ...size };

    const onMove = (ev: globalThis.MouseEvent | globalThis.TouchEvent) => {
      if (!resizing.current) return;
      ev.preventDefault();
      const cx = "touches" in ev ? ev.touches[0].clientX : ev.clientX;
      const cy = "touches" in ev ? ev.touches[0].clientY : ev.clientY;
      const dx = cx - startPos.current.x;
      const dy = cy - startPos.current.y;
      const maxW = Math.min(window.innerWidth * 0.9, 800);
      const maxH = Math.min(window.innerHeight * 0.85, 900);
      setSize({
        width: Math.max(minWidth, Math.min(maxW, startSize.current.width + dx)),
        height: Math.max(minHeight, Math.min(maxH, startSize.current.height + dy)),
      });
    };

    const onUp = () => {
      resizing.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onUp);
  }, [size, minWidth, minHeight]);

  const resetSize = useCallback(() => setSize({ width: defaultWidth, height: defaultHeight }), [defaultWidth, defaultHeight]);

  return { size, onResizeStart, resetSize };
}
