import { useEffect, useState } from "react";
import { api } from "../api";

/** Уулын цулын шилжилтийн 3D апп (uuliin_tsul): өөрийн React, загвартай тул тусгаарлан ачаална */
export default function MineMovement() {
  const [loaded, setLoaded] = useState(false);
  // iframe 401-ийг мэдэхгүй: сесс дууссан бол JSON харуулахын оронд нэвтрэх хуудас руу шилжинэ
  useEffect(() => {
    api.me().catch(() => undefined);
  }, []);
  return (
    <div className="tsul-page">
      {!loaded && <div className="tsul-loading">Ачаалж байна…</div>}
      <iframe src="/uuliin-tsul/" title="Уулын цулын шилжилт" allow="fullscreen" onLoad={() => setLoaded(true)} />
    </div>
  );
}
