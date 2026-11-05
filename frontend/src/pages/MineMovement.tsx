import { useState } from "react";

/** Уулын цулын шилжилтийн 3D апп (uuliin_tsul): өөрийн React, загвартай тул тусгаарлан ачаална */
export default function MineMovement() {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="tsul-page">
      {!loaded && <div className="tsul-loading">Ачаалж байна…</div>}
      <iframe src="/uuliin-tsul/" title="Уулын цулын шилжилт" allow="fullscreen" onLoad={() => setLoaded(true)} />
    </div>
  );
}
