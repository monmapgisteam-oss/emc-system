/* ==========================================================================
   Бодит мэшийн газрын өндөр — машин, экскаваторыг байрлуулах
   --------------------------------------------------------------------------
   `relative-to-scene` нь мэшийн тухайн үед ачаалагдсан LOD-оос өндөр авдаг
   тул zoom хийхэд машин үсэрч, мэшинд буусан жинхэнэ техник, шон дээр
   гарч агаарт хөвдөг байв. tools/build_im_dem.py мэшийн нэг LOD-ыг торонд
   буулгаж, жижиг өндөрлөг биетүүдийг шүүсэн тогтмол тор гаргана.
   ========================================================================== */

/** lon/lat -> мэшийн газрын абсолют өндөр, м (мэшээс гадна бол NaN) */
export type GroundSampler = (lon: number, lat: number) => number;

const R = 6378137;

export async function loadImGround(base = "/data/im_dem"): Promise<GroundSampler> {
  const [info, buf] = await Promise.all([
    fetch(`${base}.json`).then((r) => {
      if (!r.ok) throw new Error(`${base}.json: ${r.status}`);
      return r.json();
    }),
    fetch(`${base}.bin`).then((r) => {
      if (!r.ok) throw new Error(`${base}.bin: ${r.status}`);
      return r.arrayBuffer();
    }),
  ]);
  const { x0, y0, cell, w, h, z0, scale } = info as Record<string, number>;
  const q = new Int16Array(buf);
  if (q.length !== w * h) throw new Error(`im_dem: ${q.length} ≠ ${w}×${h}`);
  const at = (c: number, r: number) => {
    const v = q[r * w + c];
    return v === -32768 ? NaN : z0 + v * scale;
  };
  return (lon, lat) => {
    /* WGS84 -> Web Mercator (мэшийн координат) */
    const x = R * lon * Math.PI / 180;
    const y = R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
    const fc = (x - x0) / cell, fr = (y - y0) / cell;
    const c = Math.floor(fc), r = Math.floor(fr);
    if (c < 0 || r < 0 || c >= w - 1 || r >= h - 1) return NaN;
    const tc = fc - c, tr = fr - r;
    const v00 = at(c, r), v01 = at(c + 1, r), v10 = at(c, r + 1), v11 = at(c + 1, r + 1);
    if (Number.isNaN(v00 + v01 + v10 + v11)) {
      /* Мэшийн ирмэг — хамгийн ойрын утгатай булан */
      const near = [[tr + tc, v00], [tr + 1 - tc, v01], [1 - tr + tc, v10], [2 - tr - tc, v11]]
        .filter((p) => !Number.isNaN(p[1]))
        .sort((a, b) => a[0] - b[0]);
      return near.length ? near[0][1] : NaN;
    }
    return (v00 * (1 - tc) + v01 * tc) * (1 - tr) + (v10 * (1 - tc) + v11 * tc) * tr;
  };
}
