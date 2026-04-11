import { useEffect } from "react";

export default function RoomOS() {
  useEffect(() => {
    window.location.replace("/roomos-billboard.html");
  }, []);

  return null;
}
