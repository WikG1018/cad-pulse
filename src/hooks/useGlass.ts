import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

/**
 * True when the Rust side applied native acrylic to THIS window.
 * While true the roots drop their own background opacity so the
 * DWM blur shines through; false keeps the solid fallback look.
 */
export function useGlass() {
  const [glass, setGlass] = useState(false);
  useEffect(() => {
    invoke<boolean>("glass_enabled", { label: getCurrentWebviewWindow().label })
      .then(setGlass)
      .catch(() => setGlass(false));
  }, []);
  return glass;
}
