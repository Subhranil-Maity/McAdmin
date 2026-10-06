import { cn } from "@/lib/utils";

interface SparklineProps {
  /** Values oldest first; the newest point is drawn at the right edge. */
  values: number[];
  max: number;
  /** Number of x-axis slots (e.g. 60 for 60 one-second samples). */
  slots?: number;
  /** Tailwind text color class; the line and fill use currentColor. */
  className?: string;
}

const WIDTH = 100;
const HEIGHT = 40;

/** Minimal dependency-free SVG line + area chart. */
export function Sparkline({ values, max, slots = 60, className }: SparklineProps) {
  const points = values.slice(-slots);
  const step = WIDTH / Math.max(slots - 1, 1);
  const offset = slots - points.length;
  const safeMax = max > 0 ? max : 1;

  const coords = points.map((v, i) => {
    const x = (offset + i) * step;
    const y = HEIGHT - (Math.min(Math.max(v, 0), safeMax) / safeMax) * HEIGHT;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      className={cn("w-full h-12", className)}
      role="img"
      aria-label="Usage over the last minute"
    >
      <line x1="0" y1={HEIGHT} x2={WIDTH} y2={HEIGHT} className="stroke-zinc-800" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      {coords.length > 1 && (
        <>
          <polygon
            points={`${coords[0].split(",")[0]},${HEIGHT} ${coords.join(" ")} ${WIDTH},${HEIGHT}`}
            fill="currentColor"
            fillOpacity={0.15}
          />
          <polyline
            points={coords.join(" ")}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </>
      )}
    </svg>
  );
}
