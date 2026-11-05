// Газрын зургийн хэмжилт, координатын тооцоо (WGS84)

type LL = { lat: number; lng: number };

const RAD = Math.PI / 180;
const A = 6378137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);

/** Цэгүүдийг дундаж өргөрөг дээрх хавтгайд (м) — уурхай, аймгийн хэмжээнд эллипсоидтой нийцнэ */
function localXY(pts: LL[]): [number, number][] {
  const lat0 = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const s = Math.sin(lat0 * RAD);
  const w = 1 - E2 * s * s;
  const m = (A * (1 - E2)) / w ** 1.5; // меридианы радиус
  const n = A / Math.sqrt(w); // перпендикуляр радиус
  return pts.map((p) => [(p.lng - pts[0].lng) * RAD * n * Math.cos(lat0 * RAD), (p.lat - pts[0].lat) * RAD * m]);
}

/** Шугамын урт, м */
export function pathLength(pts: LL[]): number {
  let sum = 0;
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = localXY([pts[i - 1], pts[i]]);
    sum += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return sum;
}

/** Олон өнцөгтийн талбай, м² */
export function polygonArea(pts: LL[]): number {
  if (pts.length < 3) return 0;
  const xy = localXY(pts);
  let sum = 0;
  xy.forEach(([x, y], i) => {
    const [x2, y2] = xy[(i + 1) % xy.length];
    sum += x * y2 - x2 * y;
  });
  return Math.abs(sum) / 2;
}

const num = (v: number, digits: number) => v.toLocaleString("mn-MN", { maximumFractionDigits: digits });
export const fmtLength = (m: number) => (m < 1000 ? `${num(m, 1)} м` : `${num(m / 1000, 3)} км`);
export const fmtArea = (m2: number) => (m2 < 10000 ? `${num(m2, 0)} м²` : m2 < 1e7 ? `${num(m2 / 10000, 2)} га` : `${num(m2 / 1e6, 2)} км²`);

/** UTM координат (Крюгерийн цуваа, WGS84) — өгөгдлийн сангийн EPSG:32648-тай ижил бүс */
export function toUtm({ lat, lng }: LL): { zone: number; east: number; north: number } {
  const zone = Math.floor((lng + 180) / 6) + 1;
  const n = F / (2 - F);
  const rect = (A / (1 + n)) * (1 + (n * n) / 4 + n ** 4 / 64);
  const al = [n / 2 - (2 * n * n) / 3 + (5 * n ** 3) / 16, (13 * n * n) / 48 - (3 * n ** 3) / 5, (61 * n ** 3) / 240];
  const c = (2 * Math.sqrt(n)) / (1 + n);
  const sinLat = Math.sin(lat * RAD);
  const t = Math.sinh(Math.atanh(sinLat) - c * Math.atanh(c * sinLat));
  const dl = (lng - (zone * 6 - 183)) * RAD;
  const xi = Math.atan(t / Math.cos(dl));
  const eta = Math.atanh(Math.sin(dl) / Math.sqrt(1 + t * t));
  let e = eta;
  let no = xi;
  al.forEach((a, i) => {
    const j = 2 * (i + 1);
    e += a * Math.cos(j * xi) * Math.sinh(j * eta);
    no += a * Math.sin(j * xi) * Math.cosh(j * eta);
  });
  return { zone, east: 500000 + 0.9996 * rect * e, north: 0.9996 * rect * no };
}
