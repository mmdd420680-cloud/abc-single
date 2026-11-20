import React, { useState } from 'react';

/* ---------- 1. KPI Micro Sparkline SVG ---------- */
export const KpiSparkline: React.FC<{
  data: number[];
  stroke: string;
  fill: string;
  id: string;
}> = ({ data, stroke, fill, id }) => {
  const safe = data.length >= 2 ? data : [0, 0, 0, 0, 0];
  const min = Math.min(...safe);
  const max = Math.max(...safe);
  const range = max - min || 1;
  const w = 92;
  const h = 34;

  const pts = safe.map((v, idx) => {
    const x = (idx / (safe.length - 1)) * w;
    const y = h - 4 - ((v - min) / range) * (h - 10);
    return { x, y };
  });

  const linePath = pts.reduce((acc, p, idx) => {
    if (idx === 0) return `M ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    const prev = pts[idx - 1];
    const cx = ((prev.x + p.x) / 2).toFixed(1);
    return `${acc} C ${cx} ${prev.y.toFixed(1)}, ${cx} ${p.y.toFixed(1)}, ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  }, '');

  const areaPath = `${linePath} L ${w} ${h} L 0 ${h} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-[86px] h-[34px] overflow-visible shrink-0" aria-hidden="true">
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fill} stopOpacity="0.35" />
          <stop offset="100%" stopColor={fill} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#spark-${id})`} />
      <path d={linePath} fill="none" stroke={stroke} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

/* ---------- 2. Sales Overview Smooth Area Chart ---------- */
export const SalesOverviewChart: React.FC<{
  series: Array<{ date: string; label: string; revenue: number; orders: number }>;
}> = ({ series }) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const data = series.length > 0 ? series : [{ date: '', label: 'Today', revenue: 0, orders: 0 }];
  const maxVal = Math.max(1000, ...data.map((d) => d.revenue));
  const niceMax = Math.ceil(maxVal / 1000) * 1000;

  const w = 520;
  const h = 210;
  const padLeft = 46;
  const padRight = 14;
  const padTop = 18;
  const padBottom = 28;
  const plotW = w - padLeft - padRight;
  const plotH = h - padTop - padBottom;

  const pts = data.map((d, i) => {
    const x = padLeft + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
    const y = padTop + plotH - (d.revenue / niceMax) * plotH;
    return { x, y, ...d };
  });

  const linePath = pts.reduce((acc, p, idx) => {
    if (idx === 0) return `M ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    const prev = pts[idx - 1];
    const cx = ((prev.x + p.x) / 2).toFixed(1);
    return `${acc} C ${cx} ${prev.y.toFixed(1)}, ${cx} ${p.y.toFixed(1)}, ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  }, '');

  const areaPath =
    pts.length > 0
      ? `${linePath} L ${pts[pts.length - 1].x.toFixed(1)} ${padTop + plotH} L ${pts[0].x.toFixed(1)} ${padTop + plotH} Z`
      : '';

  const activeIndex = hoverIdx !== null ? hoverIdx : Math.max(0, pts.length - 2);
  const activePt = pts[activeIndex];

  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  const formatCompact = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}K` : `${n}`);

  const labelStep = Math.max(1, Math.floor(pts.length / 5));

  return (
    <div className="relative w-full overflow-hidden">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[210px]">
        <defs>
          <linearGradient id="salesAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#145CFF" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#145CFF" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Horizontal dashed gridlines */}
        {yTicks.map((t) => {
          const y = padTop + plotH * (1 - t);
          return (
            <g key={t}>
              <line
                x1={padLeft}
                y1={y}
                x2={w - padRight}
                y2={y}
                stroke="currentColor"
                className="text-slate-200 dark:text-slate-800"
                strokeDasharray="3 3"
              />
              <text
                x={padLeft - 8}
                y={y + 4}
                textAnchor="end"
                className="fill-slate-400 dark:fill-slate-500 text-[10px] font-mono-tabular"
              >
                {formatCompact(niceMax * t)}
              </text>
            </g>
          );
        })}

        {/* Area & Line */}
        {areaPath && <path d={areaPath} fill="url(#salesAreaGrad)" />}
        {linePath && (
          <path d={linePath} fill="none" stroke="#145CFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        )}

        {/* Active Vertical Marker + Tooltip */}
        {activePt && (
          <g>
            <line
              x1={activePt.x}
              y1={padTop}
              x2={activePt.x}
              y2={padTop + plotH}
              stroke="#145CFF"
              strokeOpacity="0.35"
              strokeDasharray="3 3"
            />
            <circle cx={activePt.x} cy={activePt.y} r="5" fill="#145CFF" stroke="#FFFFFF" strokeWidth="2.5" />
            <g
              transform={`translate(${Math.min(w - 115, Math.max(padLeft + 4, activePt.x - 52))}, ${Math.max(4, activePt.y - 48)})`}
            >
              <rect width="108" height="38" rx="9" fill="#0B1F42" />
              <text x="54" y="16" textAnchor="middle" className="fill-white text-[11px] font-bold font-mono-tabular">
                ৳{activePt.revenue.toLocaleString()}
              </text>
              <text x="54" y="30" textAnchor="middle" className="fill-blue-200 text-[9px]">
                {activePt.label} · {activePt.orders} ord
              </text>
            </g>
          </g>
        )}

        {/* Interactive Hover Hit Targets */}
        {pts.map((p, idx) => (
          <rect
            key={p.date || idx}
            x={p.x - plotW / Math.max(2, pts.length * 2)}
            y={padTop}
            width={plotW / Math.max(1, pts.length)}
            height={plotH}
            fill="transparent"
            className="cursor-pointer"
            onMouseEnter={() => setHoverIdx(idx)}
            onMouseLeave={() => setHoverIdx(null)}
          />
        ))}

        {/* X Axis Labels */}
        {pts.map((p, idx) => {
          if (idx % labelStep !== 0 && idx !== pts.length - 1) return null;
          return (
            <text
              key={`lbl-${idx}`}
              x={p.x}
              y={h - 6}
              textAnchor="middle"
              className="fill-slate-400 dark:fill-slate-500 text-[10px]"
            >
              {p.label}
            </text>
          );
        })}
      </svg>
    </div>
  );
};

/* ---------- 3. Order Status Donut Chart ---------- */
export const OrderStatusDonutChart: React.FC<{
  totalOrders: number;
  centerLabel?: string;
  segments: Array<{ key: string; label: string; count: number; percent: number; color: string }>;
}> = ({ totalOrders, centerLabel = 'Total Orders', segments }) => {
  const size = 148;
  const strokeW = 19;
  const r = (size - strokeW) / 2;
  const circ = 2 * Math.PI * r;
  const nonZero = segments.filter((s) => s.count > 0);
  let cumulative = 0;

  return (
    <div className="flex flex-col xl:flex-row items-center gap-5">
      <div className="relative w-[148px] h-[148px] shrink-0">
        <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full -rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="currentColor"
            className="text-slate-100 dark:text-slate-800"
            strokeWidth={strokeW}
          />
          {nonZero.map((seg) => {
            const frac = totalOrders > 0 ? seg.percent / 100 : 0;
            const dashLen = Math.max(0, frac * circ - 2);
            const dashOffset = -cumulative * circ;
            cumulative += frac;
            return (
              <circle
                key={seg.key}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={seg.color}
                strokeWidth={strokeW}
                strokeDasharray={`${dashLen} ${circ}`}
                strokeDashoffset={dashOffset}
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
          <span className="font-display font-bold text-xl text-[#101B35] dark:text-white font-mono-tabular">
            {totalOrders.toLocaleString()}
          </span>
          <span className="text-[11px] text-[#64748B] dark:text-slate-400">{centerLabel}</span>
        </div>
      </div>

      <div className="flex-1 w-full min-w-0 space-y-2.5">
        {segments.map((seg) => (
          <div key={seg.key} className="flex items-center justify-between gap-2 text-[13px] min-w-0">
            <span className="flex min-w-0 items-center gap-2 text-[#101B35] dark:text-slate-200 font-medium">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
              <span className="truncate">{seg.label}</span>
            </span>
            <span className="shrink-0 font-bold text-[#101B35] dark:text-white font-mono-tabular">
              {seg.percent.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ---------- 3b. Daily Registration Trend by Provider Stacked Bar Chart ---------- */
export const ProviderRegistrationTrendChart: React.FC<{
  series: Array<{ date: string; label: string; local: number; google: number; facebook: number; total: number }>;
}> = ({ series }) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const data = series.length > 0 ? series : [{ date: '', label: 'Today', local: 0, google: 0, facebook: 0, total: 0 }];
  const maxVal = Math.max(4, ...data.map((d) => d.total));
  const niceMax = Math.ceil(maxVal / 4) * 4;

  const w = 540;
  const h = 210;
  const padLeft = 36;
  const padRight = 14;
  const padTop = 20;
  const padBottom = 30;
  const plotW = w - padLeft - padRight;
  const plotH = h - padTop - padBottom;
  const slotW = plotW / data.length;
  const barW = Math.max(5, Math.min(20, slotW * 0.64));
  const labelStep = Math.max(1, Math.floor(data.length / 6));
  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  const hovered = hoverIdx !== null ? data[hoverIdx] : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <div className="flex flex-wrap items-center gap-4">
          <span className="inline-flex items-center gap-1.5 font-semibold text-[#101B35] dark:text-slate-200">
            <span className="h-2.5 w-2.5 rounded-xs bg-[#145CFF]" /> Email / Password
          </span>
          <span className="inline-flex items-center gap-1.5 font-semibold text-[#101B35] dark:text-slate-200">
            <span className="h-2.5 w-2.5 rounded-xs bg-[#10B981]" /> Google
          </span>
          <span className="inline-flex items-center gap-1.5 font-semibold text-[#101B35] dark:text-slate-200">
            <span className="h-2.5 w-2.5 rounded-xs bg-[#1877F2]" /> Facebook
          </span>
        </div>
        {hovered ? (
          <span className="font-mono-tabular text-[#64748B] dark:text-slate-300">
            {hovered.label}: <strong>{hovered.total}</strong> total ({hovered.local} email · {hovered.google} Google ·{' '}
            {hovered.facebook} FB)
          </span>
        ) : (
          <span className="text-[#64748B] dark:text-slate-400">Hover any day bar for breakdown</span>
        )}
      </div>

      <div className="w-full overflow-hidden">
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[210px]">
        {yTicks.map((t) => {
          const y = padTop + plotH * (1 - t);
          return (
            <g key={t}>
              <line
                x1={padLeft}
                y1={y}
                x2={w - padRight}
                y2={y}
                stroke="currentColor"
                className="text-slate-200 dark:text-slate-800"
                strokeDasharray="3 3"
              />
              <text
                x={padLeft - 8}
                y={y + 4}
                textAnchor="end"
                className="fill-slate-400 dark:fill-slate-500 text-[10px] font-mono-tabular"
              >
                {Math.round(niceMax * t)}
              </text>
            </g>
          );
        })}

        {data.map((d, idx) => {
          const x = padLeft + idx * slotW + (slotW - barW) / 2;
          const localH = (d.local / niceMax) * plotH;
          const googleH = (d.google / niceMax) * plotH;
          const fbH = (d.facebook / niceMax) * plotH;
          const baseY = padTop + plotH;

          return (
            <g
              key={d.date || idx}
              className="cursor-pointer"
              onMouseEnter={() => setHoverIdx(idx)}
              onMouseLeave={() => setHoverIdx(null)}
            >
              <rect x={padLeft + idx * slotW} y={padTop} width={slotW} height={plotH} fill="transparent" />
              {d.local > 0 && (
                <rect x={x} y={baseY - localH} width={barW} height={Math.max(2, localH)} rx="2" fill="#145CFF" />
              )}
              {d.google > 0 && (
                <rect
                  x={x}
                  y={baseY - localH - googleH}
                  width={barW}
                  height={Math.max(2, googleH)}
                  rx="2"
                  fill="#10B981"
                />
              )}
              {d.facebook > 0 && (
                <rect
                  x={x}
                  y={baseY - localH - googleH - fbH}
                  width={barW}
                  height={Math.max(2, fbH)}
                  rx="2"
                  fill="#1877F2"
                />
              )}
              {d.total === 0 && (
                <rect x={x} y={baseY - 2} width={barW} height={2} rx="1" fill="#E2E8F0" />
              )}
              <title>{`${d.label}: ${d.total} total (${d.local} email, ${d.google} Google, ${d.facebook} Facebook)`}</title>
            </g>
          );
        })}

        {data.map((d, idx) => {
          if (idx % labelStep !== 0 && idx !== data.length - 1) return null;
          const cx = padLeft + idx * slotW + slotW / 2;
          return (
            <text
              key={`prov-lbl-${idx}`}
              x={cx}
              y={h - 8}
              textAnchor="middle"
              className="fill-slate-400 dark:fill-slate-500 text-[10px]"
            >
              {d.label}
            </text>
          );
        })}
      </svg>
      </div>
    </div>
  );
};

/* ---------- 4. Revenue Overview Bar + Line Chart ---------- */
export const RevenueOverviewChart: React.FC<{
  series: Array<{ label: string; revenue: number; orders: number }>;
}> = ({ series }) => {
  const data = series.length > 0 ? series : [{ label: 'Now', revenue: 0, orders: 0 }];
  const maxVal = Math.max(1000, ...data.map((d) => d.revenue));
  const w = 310;
  const h = 112;
  const padX = 6;
  const padTop = 10;
  const padBot = 10;
  const plotH = h - padTop - padBot;
  const colW = (w - padX * 2) / data.length;
  const barW = Math.max(6, Math.min(14, colW * 0.62));

  const linePts = data.map((d, i) => {
    const cx = padX + i * colW + colW / 2;
    const cy = padTop + plotH - (d.revenue / maxVal) * plotH;
    return `${cx.toFixed(1)},${cy.toFixed(1)}`;
  });

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[112px]">
      <defs>
        <linearGradient id="revBarGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#60A5FA" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#DBEAFE" stopOpacity="0.45" />
        </linearGradient>
      </defs>
      {data.map((d, i) => {
        const barH = Math.max(4, (d.revenue / maxVal) * plotH);
        const x = padX + i * colW + (colW - barW) / 2;
        const y = padTop + plotH - barH;
        return (
          <rect
            key={`${d.label}-${i}`}
            x={x}
            y={y}
            width={barW}
            height={barH}
            rx="3"
            fill="url(#revBarGrad)"
          >
            <title>{`${d.label}: ৳${d.revenue.toLocaleString()} (${d.orders} orders)`}</title>
          </rect>
        );
      })}
      {linePts.length > 1 && (
        <polyline
          fill="none"
          stroke="#145CFF"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={linePts.join(' ')}
        />
      )}
    </svg>
  );
};
