const fs = require('fs');

const W = 800, H = 360;
const project = ([lng, lat]) => [
  ((lng + 180) / 360) * W,
  ((90 - lat) / 180) * H,
];

const sqDist = (a, b) => {
  const dx = a[0] - b[0], dy = a[1] - b[1];
  return dx * dx + dy * dy;
};

const sqSegDist = (p, a, b) => {
  let x = a[0], y = a[1];
  let dx = b[0] - x, dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x = b[0]; y = b[1]; }
    else if (t > 0) { x += dx * t; y += dy * t; }
  }
  return (p[0] - x) ** 2 + (p[1] - y) ** 2;
};

const simplifyDP = (points, tol) => {
  if (points.length < 3) return points;
  const sqTol = tol * tol;
  const last = points.length - 1;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[last] = 1;
  const stack = [[0, last]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    let maxD = 0, idx = 0;
    for (let i = i0 + 1; i < i1; i++) {
      const d = sqSegDist(points[i], points[i0], points[i1]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > sqTol) {
      keep[idx] = 1;
      stack.push([i0, idx], [idx, i1]);
    }
  }
  const out = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
};

const ringToPath = (ring, tol) => {
  const projected = ring.map(project);
  const simp = simplifyDP(projected, tol);
  if (simp.length < 3) return '';
  return simp.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') + ' Z';
};

const polygonToPath = (rings, tol) => rings.map((r) => ringToPath(r, tol)).filter(Boolean).join(' ');

const geo = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const tol = parseFloat(process.argv[3] || '0.4');

const paths = [];
for (const f of geo.features) {
  const g = f.geometry;
  if (!g) continue;
  if (g.type === 'Polygon') {
    const p = polygonToPath(g.coordinates, tol);
    if (p) paths.push(p);
  } else if (g.type === 'MultiPolygon') {
    for (const poly of g.coordinates) {
      const p = polygonToPath(poly, tol);
      if (p) paths.push(p);
    }
  }
}

const joined = paths.join(' ');
console.error(`features=${geo.features.length} rings=${paths.length} chars=${joined.length}`);
process.stdout.write(joined);
