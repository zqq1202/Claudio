import { useEffect, useRef } from "react";

/**
 * Subtle radial glow that follows the mouse cursor.
 * Uses CSS custom property --color-primary from album art for a cohesive look.
 */
export default function CursorGlow() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let mx = -999;
    let my = -999;
    let cx = -999;
    let cy = -999;
    let frame = 0;

    const onMove = (e: MouseEvent) => {
      mx = e.clientX;
      my = e.clientY;
    };

    const onLeave = () => {
      mx = -999;
      my = -999;
    };

    const animate = () => {
      // Smooth follow with lerp
      cx += (mx - cx) * 0.12;
      cy += (my - cy) * 0.12;

      if (mx < 0) {
        el.style.opacity = "0";
      } else {
        el.style.opacity = "1";
        el.style.transform = `translate(${cx - 150}px, ${cy - 150}px)`;
      }

      frame = requestAnimationFrame(animate);
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("mouseleave", onLeave);
    frame = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      ref={ref}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: 300,
        height: 300,
        borderRadius: "50%",
        pointerEvents: "none",
        zIndex: 9999,
        opacity: 0,
        transition: "opacity 0.4s ease",
        background: "radial-gradient(circle, var(--color-primary, rgba(94,232,197,0.12)) 0%, transparent 70%)",
        filter: "blur(40px)",
        mixBlendMode: "screen",
      }}
    />
  );
}
