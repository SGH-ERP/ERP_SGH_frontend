import { h, svgEl } from '../utils/dom.js';

let activeTooltip = null;

function showTooltip(event, lines) {
  hideTooltip();
  const tip = h(
    'div',
    { className: 'chart-tooltip' },
    lines.map((line, i) =>
      h('div', { className: i === 0 ? 'font-semibold mb-0.5' : '' }, line)
    )
  );
  document.body.appendChild(tip);
  activeTooltip = tip;
  moveTooltip(event);
}

function moveTooltip(event) {
  if (!activeTooltip) return;
  const x = Math.min(window.innerWidth - activeTooltip.offsetWidth - 12, event.clientX + 12);
  const y = Math.max(12, event.clientY - activeTooltip.offsetHeight - 10);
  activeTooltip.style.left = `${x}px`;
  activeTooltip.style.top = `${y}px`;
}

function hideTooltip() {
  if (activeTooltip) {
    activeTooltip.remove();
    activeTooltip = null;
  }
}

function niceMax(rawMax) {
  if (rawMax <= 0) return 10;
  const mag = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const norm = rawMax / mag;
  let step = 1;
  if (norm <= 1.2) step = 1.2;
  else if (norm <= 2) step = 2;
  else if (norm <= 5) step = 5;
  else step = 10;
  return Math.ceil(step * mag);
}

/**
 * Pure SVG Grouped Bar Chart
 */
export function renderGroupedBarChart({
  data,
  labelKey = 'name',
  series = [],
  formatValue = (v) => String(v),
  height = 240,
}) {
  const width = 580;
  const padL = 56;
  const padR = 16;
  const padT = 16;
  const padB = 34;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const rawMax = Math.max(
    1,
    ...data.flatMap((row) => series.map((s) => Number(row[s.key] || 0)))
  );
  const maxVal = niceMax(rawMax);
  const ticks = 4;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width: '100%',
    height: String(height),
    role: 'img',
  });

  // Grid lines & Y labels
  for (let i = 0; i <= ticks; i++) {
    const val = (maxVal / ticks) * i;
    const y = padT + plotH - (val / maxVal) * plotH;
    svg.appendChild(
      svgEl('line', {
        x1: padL,
        x2: width - padR,
        y1: y,
        y2: y,
        stroke: '#E2E8F0',
        'stroke-dasharray': i === 0 ? undefined : '3 3',
      })
    );
    const labelTxt = val >= 1000 ? `${(val / 1000).toFixed(0)}k` : String(Math.round(val));
    svg.appendChild(
      svgEl(
        'text',
        {
          x: padL - 8,
          y: y + 4,
          'text-anchor': 'end',
          'font-size': '11',
          fill: '#64748B',
        },
        labelTxt
      )
    );
  }

  const groupW = plotW / Math.max(1, data.length);
  const barGap = 4;
  const maxBarW = 24;
  const barW = Math.min(maxBarW, Math.max(6, (groupW * 0.65) / Math.max(1, series.length)));

  data.forEach((row, idx) => {
    const groupCenter = padL + groupW * idx + groupW / 2;
    const totalGroupW = series.length * barW + (series.length - 1) * barGap;
    const startX = groupCenter - totalGroupW / 2;

    series.forEach((s, si) => {
      const val = Number(row[s.key] || 0);
      const bh = Math.max(2, (val / maxVal) * plotH);
      const x = startX + si * (barW + barGap);
      const y = padT + plotH - bh;
      const rect = svgEl('rect', {
        x,
        y,
        width: barW,
        height: bh,
        rx: 3,
        fill: s.color,
        style: 'cursor:pointer;transition:opacity 0.15s ease',
      });
      rect.addEventListener('mouseenter', (e) => {
        rect.setAttribute('opacity', '0.85');
        showTooltip(e, [
          String(row[labelKey] || ''),
          ...series.map((item) => `${item.name}: ${formatValue(Number(row[item.key] || 0))}`),
        ]);
      });
      rect.addEventListener('mousemove', moveTooltip);
      rect.addEventListener('mouseleave', () => {
        rect.setAttribute('opacity', '1');
        hideTooltip();
      });
      svg.appendChild(rect);
    });

    svg.appendChild(
      svgEl(
        'text',
        {
          x: groupCenter,
          y: height - 10,
          'text-anchor': 'middle',
          'font-size': '11',
          fill: '#64748B',
        },
        String(row[labelKey] || '')
      )
    );
  });

  const legend = h(
    'div',
    { className: 'chart-legend' },
    series.map((s) =>
      h(
        'span',
        { className: 'inline-flex items-center' },
        h('span', { className: 'chart-legend-dot', style: { backgroundColor: s.color } }),
        s.name
      )
    )
  );

  return h('div', { className: 'chart-container' }, svg, legend);
}

/**
 * Pure SVG Stacked Bar Chart (used in M1 Ocupación)
 */
export function renderStackedBarChart({
  data,
  labelKey = 'type',
  series = [],
  height = 240,
}) {
  const width = 580;
  const padL = 42;
  const padR = 16;
  const padT = 16;
  const padB = 34;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const totals = data.map((row) =>
    series.reduce((sum, s) => sum + Number(row[s.key] || 0), 0)
  );
  const maxVal = niceMax(Math.max(1, ...totals));
  const ticks = 4;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width: '100%',
    height: String(height),
    role: 'img',
  });

  for (let i = 0; i <= ticks; i++) {
    const val = (maxVal / ticks) * i;
    const y = padT + plotH - (val / maxVal) * plotH;
    svg.appendChild(
      svgEl('line', {
        x1: padL,
        x2: width - padR,
        y1: y,
        y2: y,
        stroke: '#E2E8F0',
        'stroke-dasharray': i === 0 ? undefined : '3 3',
      })
    );
    svg.appendChild(
      svgEl(
        'text',
        { x: padL - 8, y: y + 4, 'text-anchor': 'end', 'font-size': '11', fill: '#64748B' },
        String(Math.round(val))
      )
    );
  }

  const groupW = plotW / Math.max(1, data.length);
  const barW = Math.min(44, Math.max(18, groupW * 0.5));

  data.forEach((row, idx) => {
    const cx = padL + groupW * idx + groupW / 2;
    const x = cx - barW / 2;
    let runningY = padT + plotH;

    series.forEach((s) => {
      const val = Number(row[s.key] || 0);
      if (val <= 0) return;
      const bh = (val / maxVal) * plotH;
      runningY -= bh;
      const rect = svgEl('rect', {
        x,
        y: runningY,
        width: barW,
        height: bh,
        fill: s.color,
        style: 'cursor:pointer',
      });
      rect.addEventListener('mouseenter', (e) => {
        showTooltip(e, [
          String(row[labelKey] || ''),
          ...series.map((item) => `${item.name}: ${Number(row[item.key] || 0)} habs.`),
        ]);
      });
      rect.addEventListener('mousemove', moveTooltip);
      rect.addEventListener('mouseleave', hideTooltip);
      svg.appendChild(rect);
    });

    svg.appendChild(
      svgEl(
        'text',
        { x: cx, y: height - 10, 'text-anchor': 'middle', 'font-size': '11', fill: '#64748B' },
        String(row[labelKey] || '')
      )
    );
  });

  const legend = h(
    'div',
    { className: 'chart-legend' },
    series.map((s) =>
      h(
        'span',
        { className: 'inline-flex items-center' },
        h('span', { className: 'chart-legend-dot', style: { backgroundColor: s.color } }),
        s.name
      )
    )
  );

  return h('div', { className: 'chart-container' }, svg, legend);
}

/**
 * Pure SVG Donut Chart
 */
export function renderDonutChart({ data = [], unit = 'habs.', size = 190 }) {
  const total = data.reduce((sum, d) => sum + Number(d.value || 0), 0);
  const cx = 100;
  const cy = 100;
  const r = 68;
  const strokeW = 24;
  const circ = 2 * Math.PI * r;

  const svg = svgEl('svg', {
    viewBox: '0 0 200 200',
    width: String(size),
    height: String(size),
    role: 'img',
    style: 'display:block;margin:0 auto',
  });

  if (total === 0) {
    svg.appendChild(
      svgEl('circle', {
        cx,
        cy,
        r,
        fill: 'none',
        stroke: '#E2E8F0',
        'stroke-width': strokeW,
      })
    );
  } else {
    let offset = 0;
    data.forEach((d) => {
      const val = Number(d.value || 0);
      if (val <= 0) return;
      const len = (val / total) * circ;
      const seg = svgEl('circle', {
        cx,
        cy,
        r,
        fill: 'none',
        stroke: d.color,
        'stroke-width': strokeW,
        'stroke-dasharray': `${Math.max(1, len - 2)} ${circ}`,
        'stroke-dashoffset': -offset,
        transform: `rotate(-90 ${cx} ${cy})`,
        style: 'cursor:pointer',
      });
      seg.addEventListener('mouseenter', (e) => {
        const pct = Math.round((val / total) * 100);
        showTooltip(e, [`${d.name}: ${val} ${unit} (${pct}%)`]);
      });
      seg.addEventListener('mousemove', moveTooltip);
      seg.addEventListener('mouseleave', hideTooltip);
      svg.appendChild(seg);
      offset += len;
    });
  }

  svg.appendChild(
    svgEl(
      'text',
      {
        x: cx,
        y: cy - 2,
        'text-anchor': 'middle',
        'font-size': '20',
        'font-weight': '700',
        fill: '#0B1F3A',
      },
      String(total)
    )
  );
  svg.appendChild(
    svgEl(
      'text',
      {
        x: cx,
        y: cy + 16,
        'text-anchor': 'middle',
        'font-size': '11',
        fill: '#64748B',
      },
      unit
    )
  );

  return h('div', { className: 'chart-container' }, svg);
}

/**
 * Pure SVG Area Comparison Chart (used in M4 Reportes)
 */
export function renderAreaComparisonChart({
  data = [],
  labelKey = 'month',
  series = [],
  formatValue = (v) => String(v),
  height = 240,
}) {
  const width = 580;
  const padL = 56;
  const padR = 20;
  const padT = 18;
  const padB = 34;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const rawMax = Math.max(
    1,
    ...data.flatMap((row) => series.map((s) => Number(row[s.key] || 0)))
  );
  const maxVal = niceMax(rawMax);
  const ticks = 4;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width: '100%',
    height: String(height),
    role: 'img',
  });

  for (let i = 0; i <= ticks; i++) {
    const val = (maxVal / ticks) * i;
    const y = padT + plotH - (val / maxVal) * plotH;
    svg.appendChild(
      svgEl('line', {
        x1: padL,
        x2: width - padR,
        y1: y,
        y2: y,
        stroke: '#E2E8F0',
        'stroke-dasharray': i === 0 ? undefined : '3 3',
      })
    );
    const labelTxt = val >= 1000 ? `${(val / 1000).toFixed(0)}k` : String(Math.round(val));
    svg.appendChild(
      svgEl(
        'text',
        { x: padL - 8, y: y + 4, 'text-anchor': 'end', 'font-size': '11', fill: '#64748B' },
        labelTxt
      )
    );
  }

  const count = Math.max(2, data.length);
  const stepX = plotW / (count - 1);

  series.forEach((s) => {
    const pts = data.map((row, idx) => {
      const x = padL + idx * stepX;
      const val = Number(row[s.key] || 0);
      const y = padT + plotH - (val / maxVal) * plotH;
      return { x, y, row };
    });

    if (pts.length > 0) {
      const areaD =
        `M ${pts[0].x} ${padT + plotH} ` +
        pts.map((p) => `L ${p.x} ${p.y}`).join(' ') +
        ` L ${pts[pts.length - 1].x} ${padT + plotH} Z`;
      svg.appendChild(
        svgEl('path', {
          d: areaD,
          fill: s.color,
          'fill-opacity': s.fillOpacity ?? '0.16',
        })
      );

      const lineD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
      svg.appendChild(
        svgEl('path', {
          d: lineD,
          fill: 'none',
          stroke: s.color,
          'stroke-width': '2.25',
        })
      );
    }
  });

  // Hover dots + X axis labels
  data.forEach((row, idx) => {
    const x = padL + idx * stepX;
    svg.appendChild(
      svgEl(
        'text',
        { x, y: height - 10, 'text-anchor': 'middle', 'font-size': '11', fill: '#64748B' },
        String(row[labelKey] || '')
      )
    );
    series.forEach((s) => {
      const val = Number(row[s.key] || 0);
      const y = padT + plotH - (val / maxVal) * plotH;
      const dot = svgEl('circle', {
        cx: x,
        cy: y,
        r: 4.5,
        fill: s.color,
        stroke: '#FFFFFF',
        'stroke-width': '1.5',
        style: 'cursor:pointer',
      });
      dot.addEventListener('mouseenter', (e) => {
        showTooltip(e, [
          String(row[labelKey] || ''),
          ...series.map((item) => `${item.name}: ${formatValue(Number(row[item.key] || 0))}`),
        ]);
      });
      dot.addEventListener('mousemove', moveTooltip);
      dot.addEventListener('mouseleave', hideTooltip);
      svg.appendChild(dot);
    });
  });

  const legend = h(
    'div',
    { className: 'chart-legend' },
    series.map((s) =>
      h(
        'span',
        { className: 'inline-flex items-center' },
        h('span', { className: 'chart-legend-dot', style: { backgroundColor: s.color } }),
        s.name
      )
    )
  );

  return h('div', { className: 'chart-container' }, svg, legend);
}
