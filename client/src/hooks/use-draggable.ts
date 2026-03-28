import { useState, useRef, useCallback, type MouseEvent, type TouchEvent } from "react";

interface Position {
  x: number;
  y: number;
}

export function useDraggable() {
  const [offset, setOffset] = useState<Position>({ x: 0, y: 0 });
  const dragging = useRef(false);
  const didDrag = useRef(false);
  const startPos = useRef<Position>({ x: 0, y: 0 });
  const startOffset = useRef<Position>({ x: 0, y: 0 });

  const clamp = (val: number, min: number, max: number) => Math.max(min, Math.min(max, val));

  const onPointerDown = useCallback((e: MouseEvent | TouchEvent) => {
    dragging.current = true;
    didDrag.current = false;
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    startPos.current = { x: clientX, y: clientY };
    startOffset.current = { ...offset };

    const onPointerMove = (ev: globalThis.MouseEvent | globalThis.TouchEvent) => {
      if (!dragging.current) return;
      ev.preventDefault();
      const cx = "touches" in ev ? ev.touches[0].clientX : ev.clientX;
      const cy = "touches" in ev ? ev.touches[0].clientY : ev.clientY;
      const dx = cx - startPos.current.x;
      const dy = cy - startPos.current.y;
      if (!didDrag.current && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      didDrag.current = true;
      const maxX = window.innerWidth * 0.8;
      const maxY = window.innerHeight * 0.8;
      setOffset({
        x: clamp(startOffset.current.x + dx, -maxX, maxX),
        y: clamp(startOffset.current.y + dy, -maxY, maxY),
      });
    };

    const onPointerUp = () => {
      dragging.current = false;
      setTimeout(() => { didDrag.current = false; }, 0);
      window.removeEventListener("mousemove", onPointerMove);
      window.removeEventListener("mouseup", onPointerUp);
      window.removeEventListener("touchmove", onPointerMove);
      window.removeEventListener("touchend", onPointerUp);
    };

    window.addEventListener("mousemove", onPointerMove);
    window.addEventListener("mouseup", onPointerUp);
    window.addEventListener("touchmove", onPointerMove, { passive: false });
    window.addEventListener("touchend", onPointerUp);
  }, [offset]);

  const wasDragged = useCallback(() => didDrag.current, []);
  const resetOffset = useCallback(() => setOffset({ x: 0, y: 0 }), []);

  return { offset, onPointerDown, resetOffset, wasDragged };
}
