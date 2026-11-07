import { useId, useMemo, useState } from 'react';
import { cn } from '@/lib/cn';

/** Smooth path through points (Catmull-Rom converted to cubic Béziers). */
function smoothPath(pts) {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const t = 0.18;
    d += ` C${p1[0] + (p2[0] - p0[0]) * t},${p1[1] + (p2[1] - p0[1]) * t} ${p2[0] - (p3[0] - p1[0]) * t},${p2[1] - (p3[1] - p1[1]) * t} ${p2[0]},${p2[1]}`;
  }
  return d;
}

/**
 * Area/line chart matching the "Appointments Overview" reference.
 * data: [{ label, value }]
 */
export function AreaChart({ data, max, ticks = [0, 200, 400, 600, 800, 1000], width = 560, height = 190, showAxis = true, className, formatValue = (v) => v }) {
  const gid = useId().replace(/:/g, '');
  const [hover, setHover] = useState(null);
  const W = width;
  const H = height;
  const padL = showAxis ? 40 : 6;
  const padR = 10;
  const padT = 10;
  const padB = showAxis ? 26 : 8;
  const top = max ?? Math.max(...ticks);

  const pts = useMemo(
    () =>
      data.map((d, i) => [
        padL + (i * (W - padL - padR)) / Math.max(1, data.length - 1),
        padT + (1 - d.value / top) * (H - padT - padB),
      ]),
    [data, top, W, H, padL, padB],
  );
  const line = smoothPath(pts);
  const area = `${line} L${pts.at(-1)[0]},${H - padB} L${pts[0][0]},${H - padB} Z`;

  return (
    <div className={cn('relative w-full', className)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full overflow-visible" role="img" aria-label="Chart">
        <defs>
          <linearGradient id={`area-${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--primary))" stopOpacity="0.32" />
            <stop offset="100%" stopColor="rgb(var(--primary))" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {showAxis &&
          ticks.map((tk) => {
            const y = padT + (1 - tk / top) * (H - padT - padB);
            return (
              <g key={tk}>
                <line x1={padL} x2={W - padR} y1={y} y2={y} stroke="rgb(var(--line))" strokeWidth="1" />
                <text x={padL - 8} y={y + 3.5} textAnchor="end" className="fill-muted text-[10px] font-medium">
                  {tk.toLocaleString()}
                </text>
              </g>
            );
          })}
        <path d={area} fill={`url(#area-${gid})`} />
        <path d={line} fill="none" stroke="rgb(var(--primary))" strokeWidth="2.75" strokeLinecap="round" />
        {pts.map(([x, y], i) => (
          <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <circle cx={x} cy={y} r="14" fill="transparent" />
            <circle cx={x} cy={y} r={hover === i ? 5.5 : 4} fill="rgb(var(--primary))" stroke="rgb(var(--surface))" strokeWidth="2" />
          </g>
        ))}
        {showAxis &&
          data.map((d, i) => (
            <text key={d.label} x={pts[i][0]} y={H - 6} textAnchor="middle" className="fill-muted text-[10.5px] font-semibold">
              {d.label}
            </text>
          ))}
      </svg>
      {hover != null && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-lg bg-brand-navy px-2.5 py-1 text-2xs font-bold text-white shadow-float"
          style={{ left: `${(pts[hover][0] / W) * 100}%`, top: `${(pts[hover][1] / H) * 100 - 4}%` }}
        >
          {data[hover].label}: {formatValue(data[hover].value)}
        </div>
      )}
    </div>
  );
}

/** Rounded bar chart used by Reports & Analytics (mobile reference). */
export function BarChart({ data, ticks = [0, 5000, 10000, 15000, 20000], height = 170, className, formatTick = (v) => v }) {
  const gid = useId().replace(/:/g, '');
  const W = 320;
  const H = height;
  const padL = 34;
  const padB = 22;
  const padT = 8;
  const top = Math.max(...ticks);
  const slot = (W - padL - 8) / data.length;
  const bw = Math.min(26, slot * 0.5);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cn('h-auto w-full', className)} role="img" aria-label="Bar chart">
      <defs>
        <linearGradient id={`bar-${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(var(--primary))" />
          <stop offset="100%" stopColor="rgb(var(--primary))" stopOpacity="0.55" />
        </linearGradient>
      </defs>
      {ticks.map((tk) => {
        const y = padT + (1 - tk / top) * (H - padT - padB);
        return (
          <text key={tk} x={padL - 8} y={y + 3} textAnchor="end" className="fill-muted text-[9.5px] font-semibold">
            {formatTick(tk)}
          </text>
        );
      })}
      {data.map((d, i) => {
        const h = (d.value / top) * (H - padT - padB);
        const x = padL + slot * i + (slot - bw) / 2;
        return (
          <g key={d.label}>
            <rect x={x} y={H - padB - h} width={bw} height={h} rx="4" fill={`url(#bar-${gid})`} />
            <text x={x + bw / 2} y={H - 6} textAnchor="middle" className="fill-muted text-[10px] font-semibold">
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
