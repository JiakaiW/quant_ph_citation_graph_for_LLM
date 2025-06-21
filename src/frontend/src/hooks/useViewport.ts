import { useState, useEffect } from "react";
import { CameraState } from "sigma/types";
import { Sigma } from "sigma";

export function useViewport(sigma: Sigma | null) {
  const [view, setView] = useState<CameraState | null>(null);

  useEffect(() => {
    if (!sigma) return;

    const camera = sigma.getCamera();
    const handler = () => setView(camera.getState());
    
    // Initial state
    setView(camera.getState());
    
    // Listen to camera updates
    camera.on("updated", handler);
    
    return () => {
      camera.removeListener("updated", handler);
    };
  }, [sigma]);

  return view;
} 