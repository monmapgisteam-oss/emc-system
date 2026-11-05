import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Уулын цулын шилжилт · Ил уурхай Cu-Mo",
  description:
    "Ил уурхайн сар бүрийн уулын цулын шилжилт — Excel «Нийт орд arcgis» + ArcGIS 3D",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="mn" data-theme="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
        />
        {/* ArcGIS-ийн загварын хуудас. ЗААВАЛ хэрэгтэй: үүнгүйгээр
            `.esri-view-root` нь `position:absolute; inset:0` авахгүй тул
            SceneView эцгийнхээ өндрийг дүүргэхгүй (910x688 контейнерт
            canvas 910x455 болж) панелийн доор хар зай үлдэж, зум/компасын
            виджетүүд газрын зургийн ДООР унжиж байсан.
            Замыг `esriConfig.assetsPath`-тай нэг CDN-ээс авав. */}
        <link
          rel="stylesheet"
          href="https://js.arcgis.com/4.34/@arcgis/core/assets/esri/themes/light/main.css"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
