import { useEffect, useState } from "react";

export function usePageVisibility(): boolean {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === "visible");
    onChange();
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  return visible;
}

