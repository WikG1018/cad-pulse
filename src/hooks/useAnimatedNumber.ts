import { useEffect, useRef, useState } from "react";

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Smoothly animates toward `target` (CountUp.js-style easeOutCubic).
 * A new target mid-flight resumes from the current interpolated value,
 * so 1 Hz data ticks never snap or jump.
 */
export function useAnimatedNumber(target: number, duration = 350): number {
  const [display, setDisplay] = useState(target);
  const currentRef = useRef(target);
  const rafRef = useRef(0);

  useEffect(() => {
    if (prefersReducedMotion()) {
      currentRef.current = target;
      setDisplay(target);
      return;
    }
    const from = currentRef.current;
    if (from === target) return;
    const start = performance.now();
    cancelAnimationFrame(rafRef.current);
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      currentRef.current = from + (target - from) * eased;
      setDisplay(currentRef.current);
      if (t < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return display;
}
