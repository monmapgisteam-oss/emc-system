import { useEffect, useState } from "react";

/** Одоо ажиллаж буй build-ийн JS файлын нэр (жишээ нь /assets/index-CFCn82he.js) */
const currentBuild = () =>
  [...document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]')].map((s) => new URL(s.src).pathname).find((p) => p.includes("/assets/")) ?? null;

/**
 * Сервер дээр шинэ хувилбар гарсан эсэхийг минут тутам шалгаж, гарсан бол дээд талд мэдэгдэл харуулна.
 * (Хөтөч хуучин хувилбарыг ажиллуулсаар байх асуудлаас сэргийлнэ.)
 */
export default function UpdateBanner() {
  const [outdated, setOutdated] = useState(false);

  useEffect(() => {
    const mine = currentBuild();
    if (!mine) return; // хөгжүүлэлтийн горим (vite dev) — шалгахгүй
    const check = async () => {
      try {
        const html = await (await fetch("/", { cache: "no-store" })).text();
        const latest = html.match(/\/assets\/index-[^"']+\.js/)?.[0];
        if (latest && latest !== mine) setOutdated(true);
      } catch {
        /* сүлжээ тасарсан — дараа дахин */
      }
    };
    const t = setInterval(check, 60_000);
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  if (!outdated) return null;
  return (
    <div className="update-banner" role="status">
      Системийн шинэ хувилбар гарлаа.
      <button onClick={() => window.location.reload()}>Шинэчлэх</button>
    </div>
  );
}
