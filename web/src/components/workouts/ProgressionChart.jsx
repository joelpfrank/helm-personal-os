import React, { useMemo } from 'react';

// Hand-rolled SVG dual-line chart: top working-set weight + e1RM over
// the visible sessions. No external deps. ~80 lines.

const W = 480, H = 160;
const PAD = { l: 32, r: 8, t: 16, b: 22 };

function tsOf(s) { return new Date(s.date + 'T00:00:00').getTime(); }

export default function ProgressionChart({ sessions, color }) {
  const data = useMemo(() => {
    const pts = (sessions || [])
      .filter((s) => s.top_weight > 0 || s.top_e1rm > 0)
      .map((s) => ({ ts: tsOf(s), weight: s.top_weight || 0, e1rm: s.top_e1rm || 0 }));
    pts.sort((a, b) => a.ts - b.ts);
    return pts;
  }, [sessions]);

  if (data.length < 1) {
    return <p className="muted small">not enough data for a chart yet — log some sessions.</p>;
  }

  const minTs = data[0].ts;
  const maxTs = data[data.length - 1].ts || minTs + 1;
  const tsRange = Math.max(1, maxTs - minTs);
  const allY = data.flatMap((p) => [p.weight, p.e1rm].filter((v) => v > 0));
  const yMin = Math.max(0, Math.min(...allY) * 0.92);
  const yMax = Math.max(...allY) * 1.06 || 1;
  const xFor = (ts) => PAD.l + (data.length === 1 ? (W - PAD.l - PAD.r) / 2 : ((ts - minTs) / tsRange) * (W - PAD.l - PAD.r));
  const yFor = (v) => H - PAD.b - ((v - yMin) / Math.max(0.001, yMax - yMin)) * (H - PAD.t - PAD.b);

  const stroke = color || 'var(--accent)';
  const weightLine = data.filter((p) => p.weight > 0).map((p) => `${xFor(p.ts).toFixed(1)},${yFor(p.weight).toFixed(1)}`).join(' ');
  const e1rmLine = data.filter((p) => p.e1rm > 0).map((p) => `${xFor(p.ts).toFixed(1)},${yFor(p.e1rm).toFixed(1)}`).join(' ');

  // 3 horizontal gridlines
  const ticks = [yMin, (yMin + yMax) / 2, yMax].map((v) => ({
    v: Math.round(v),
    y: yFor(v),
  }));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="progression-chart" preserveAspectRatio="none">
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={PAD.l} y1={t.y} x2={W - PAD.r} y2={t.y} className="chart-grid" />
          <text x={4} y={t.y + 3} className="chart-axis">{t.v}</text>
        </g>
      ))}

      {/* e1RM line (lighter) */}
      <polyline points={e1rmLine} fill="none" stroke={stroke} strokeOpacity="0.4" strokeWidth="1.5" />
      {/* top weight line (solid) */}
      <polyline points={weightLine} fill="none" stroke={stroke} strokeWidth="2" />

      {data.map((p, i) => (
        <g key={i}>
          {p.weight > 0 && <circle cx={xFor(p.ts)} cy={yFor(p.weight)} r="3" fill={stroke} />}
          {p.e1rm > 0 && <circle cx={xFor(p.ts)} cy={yFor(p.e1rm)} r="2" fill={stroke} fillOpacity="0.4" />}
        </g>
      ))}

      <text x={PAD.l} y={H - 6} className="chart-axis">{new Date(minTs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</text>
      <text x={W - PAD.r} y={H - 6} className="chart-axis" textAnchor="end">{new Date(maxTs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</text>
    </svg>
  );
}
