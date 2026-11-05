import { useEffect } from "react";
import { CircleMarker, MapContainer, Marker, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import { addBasemapGallery, rememberedBasemap } from "./basemaps";

/** Esri суурь зургийн gallery — сүүлд сонгосныг энэ хөтөч дээр санана */
function BasemapGallery() {
  const map = useMap();
  useEffect(() => addBasemapGallery(map, rememberedBasemap() ?? "imagery", true), [map]);
  return null;
}

export type MapPoint = {
  id: number;
  lat: number;
  lon: number;
  color: string;
  label: string;
  detail?: string;
  selected?: boolean;
  /** Цэгийн дэргэд үргэлж харагдах богино шошго (код) */
  tag?: string;
};

const escapeHtml = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Эрдэнэтийн уурхайн орчим
const DEFAULT_CENTER: [number, number] = [49.021, 104.122];

/** Газрын зураг дээр хөвөх самбарт хамаарах зай, px: [зүүн, дээд] ба [баруун, доод] — цэгүүд самбарын ард орохгүй */
export type FitPad = (size: L.Point) => { topLeft: [number, number]; bottomRight: [number, number] };

function FitBounds({ points, fitPad }: { points: MapPoint[]; fitPad?: FitPad }) {
  const map = useMap();
  const key = points.map((p) => p.id).join(",");
  useEffect(() => {
    if (!points.length) return;
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lon]));
    if (fitPad) {
      const pad = fitPad(map.getSize());
      map.fitBounds(bounds, { paddingTopLeft: pad.topLeft, paddingBottomRight: pad.bottomRight, maxZoom: 16 });
    } else map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}

export default function MapView({
  points,
  onSelect,
  height = 420,
  fitPad,
}: {
  points: MapPoint[];
  onSelect?: (id: number) => void;
  height?: number | string;
  fitPad?: FitPad;
}) {
  return (
    <div className="map" style={{ height }}>
      <MapContainer center={DEFAULT_CENTER} zoom={13} style={{ height: "100%" }}>
        <BasemapGallery />
        <FitBounds points={points} fitPad={fitPad} />
        {points.map((p) => (
          <CircleMarker
            key={p.id}
            center={[p.lat, p.lon]}
            radius={p.selected ? 10 : 7}
            pathOptions={{ color: "#ffffff", weight: 2, fillColor: p.color, fillOpacity: 1 }}
            eventHandlers={onSelect ? { click: () => onSelect(p.id) } : undefined}
          >
            <Tooltip direction="top" offset={[0, -6]}>
              <b>{p.label}</b>
              {p.detail && <div>{p.detail}</div>}
            </Tooltip>
          </CircleMarker>
        ))}
        {points
          .filter((p) => p.tag)
          .map((p) => (
            <Marker
              key={`tag-${p.id}`}
              position={[p.lat, p.lon]}
              interactive={false}
              keyboard={false}
              icon={L.divIcon({ className: "map-tag", html: `<span style="--c:${p.color}">${escapeHtml(p.tag!)}</span>`, iconSize: [0, 0] })}
            />
          ))}
      </MapContainer>
    </div>
  );
}
