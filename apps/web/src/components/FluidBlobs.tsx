import { useEffect, useRef } from "react";

interface Props {
  bass: number;
  mid: number;
}

export default function FluidBlobs({ bass, mid }: Props) {
  const primaryRef = useRef<HTMLDivElement>(null);
  const secondaryRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number>(0);
  const bassRef = useRef(bass);
  const midRef = useRef(mid);

  bassRef.current = bass;
  midRef.current = mid;

  useEffect(() => {
    const animate = () => {
      const t = performance.now();
      const b = bassRef.current;
      const m = midRef.current;

      if (primaryRef.current) {
        const drift = 5 + b * 8;
        const bx = Math.sin(t * 0.0003) * drift;
        const by = Math.cos(t * 0.0004) * drift;
        const scale = 1 + 0.05 * Math.sin(t * 0.0008) + b * 1.2;
        const op = 0.6 + 0.1 * Math.sin(t * 0.0006) + b * 0.35;
        primaryRef.current.style.transform = `translate(${bx}vmin, ${by}vmin) scale(${scale})`;
        primaryRef.current.style.opacity = String(op);
      }

      if (secondaryRef.current) {
        const energy = b * 0.4 + m * 0.6;
        const drift = 5 + energy * 8;
        const sx = Math.cos(t * 0.00025) * drift;
        const sy = Math.sin(t * 0.0003) * drift;
        const scale = 1 + 0.04 * Math.cos(t * 0.0007) + energy * 1.0;
        const op = 0.55 + 0.1 * Math.cos(t * 0.0005) + energy * 0.4;
        secondaryRef.current.style.transform = `translate(${sx}vmin, ${sy}vmin) scale(${scale})`;
        secondaryRef.current.style.opacity = String(op);
      }

      frameRef.current = requestAnimationFrame(animate);
    };

    frameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameRef.current);
  }, []);

  return (
    <div className="fluid-blob-container">
      <div ref={primaryRef} className="fluid-blob primary" />
      <div ref={secondaryRef} className="fluid-blob secondary" />
    </div>
  );
}
