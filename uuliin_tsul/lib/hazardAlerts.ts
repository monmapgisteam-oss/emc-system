import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import IconSymbol3DLayer from "@arcgis/core/symbols/IconSymbol3DLayer";
import PointSymbol3D from "@arcgis/core/symbols/PointSymbol3D";

export interface HazardAlertTruck {
  id: string | number;
  lon: number;
  lat: number;
  level: 0 | 1 | 2 | 3;
  /** Газрын өндөр — давхарга `absolute-height` үед; эс бол 0 */
  z?: number;
}

export interface HazardAlerts {
  layer: GraphicsLayer;
  sync(trucks: readonly HazardAlertTruck[], truckHeight: number): void;
  destroy(): void;
}

type AlertStyle = "low" | "medium" | "high";
type RGB = readonly [number, number, number];

interface AlertEntry {
  graphic: Graphic;
  style: AlertStyle;
  level: number;
  lon: number;
  lat: number;
  height: number;
}

const BADGE_PX = 18;
const CLEARANCE_PX = 16;
const ALERT_COLORS: Record<AlertStyle, { fill: string; rgb: RGB }> = {
  low: { fill: "#8bd12f", rgb: [139, 209, 47] },
  medium: { fill: "#ff7b0b", rgb: [255, 123, 11] },
  high: { fill: "#ff481f", rgb: [255, 72, 31] },
};

function rgba(color: RGB, alpha: number): number[] {
  return [color[0], color[1], color[2], alpha];
}

function badgeResource(style: AlertStyle): string {
  const fill = ALERT_COLORS[style].fill;
  const mark = style === "high"
    ? '<path fill="white" d="M14.3 8.7a2 2 0 0 1 3.4 0l7 12.2a2 2 0 0 1-1.7 3H9a2 2 0 0 1-1.7-3z"/><path stroke="#ff481f" stroke-width="2.2" stroke-linecap="round" d="M16 13v4.5"/><circle cx="16" cy="21" r="1.2" fill="#ff481f"/>'
    : '<path fill="white" d="M13.8 8.2a2.2 2.2 0 1 1 4.4 0v.5c2.7.9 4.3 3.1 4.3 6.3v3.3l2 2.4c.5.7.1 1.8-.8 1.8H8.3c-.9 0-1.3-1.1-.8-1.8l2-2.4V15c0-3.2 1.6-5.4 4.3-6.3zM13 24h6a3 3 0 0 1-6 0"/>';
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="${fill}"/>${mark}</svg>`,
  )}`;
}

function iconAnchor(sizePx: number) {
  // Keep the badge and its static halo centered above the truck.
  return {
    anchor: "relative" as const,
    anchorPosition: { x: 0, y: CLEARANCE_PX / sizePx },
    size: `${sizePx}px`,
  };
}

function makeSymbol(
  style: AlertStyle,
  resource: string,
): PointSymbol3D {
  const color = ALERT_COLORS[style].rgb;
  const layers: IconSymbol3DLayer[] = [];
  layers.push(
    new IconSymbol3DLayer({
      ...iconAnchor(24),
      resource: { primitive: "circle" },
      material: { color: rgba(color, 0.15) },
      outline: { color: rgba(color, 0), size: 0 },
    }),
    new IconSymbol3DLayer({
      ...iconAnchor(BADGE_PX),
      resource: { href: resource },
    }),
  );
  return new PointSymbol3D({ symbolLayers: layers });
}

/**
 * Scene-native alerts: green bell for level 1, orange bell for 2, red warning for 3.
 * Static badges follow each truck without flashing or pulsing.
 * The caller owns map insertion and layer visibility.
 */
export function createHazardAlerts(): HazardAlerts {
  const layer = new GraphicsLayer({
    title: "truck-hazard-alerts",
    listMode: "hide",
    elevationInfo: { mode: "relative-to-scene", offset: 0 },
    // Preserve the compact 18px badge regardless of camera distance.
    screenSizePerspectiveEnabled: false,
  });
  const entries = new Map<string | number, AlertEntry>();
  const styles = ["low", "medium", "high"] as const;
  const symbols = {} as Record<AlertStyle, PointSymbol3D>;
  for (const style of styles) {
    symbols[style] = makeSymbol(style, badgeResource(style));
  }

  // Reuse each symbol until a truck's alert style changes.
  let destroyed = false;

  return {
    layer,
    sync(trucks, truckHeight) {
      if (destroyed) return;
      const seen = new Set<string | number>();
      const height = Math.max(0, Number.isFinite(truckHeight) ? truckHeight : 0) + 1;
      for (const truck of trucks) {
        if (truck.level === 0 || !Number.isFinite(truck.lon) || !Number.isFinite(truck.lat)) continue;
        seen.add(truck.id);
        const style: AlertStyle = truck.level === 3 ? "high" : truck.level === 2 ? "medium" : "low";
        const z = height + (truck.z ?? 0);
        let entry = entries.get(truck.id);
        if (!entry) {
          const graphic = new Graphic({
            geometry: new Point({
              longitude: truck.lon,
              latitude: truck.lat,
              z,
              spatialReference: { wkid: 4326 },
            }),
            symbol: symbols[style],
            attributes: { truckId: truck.id, hazardLevel: truck.level },
          });
          entry = { graphic, style, level: truck.level, lon: truck.lon, lat: truck.lat, height: z };
          entries.set(truck.id, entry);
          layer.add(graphic);
        } else {
          if (entry.lon !== truck.lon || entry.lat !== truck.lat || entry.height !== z) {
            entry.graphic.geometry = new Point({
              longitude: truck.lon,
              latitude: truck.lat,
              z,
              spatialReference: { wkid: 4326 },
            });
            entry.lon = truck.lon;
            entry.lat = truck.lat;
            entry.height = z;
          }
          if (entry.style !== style) {
            entry.style = style;
            entry.graphic.symbol = symbols[style];
          }
          if (entry.level !== truck.level) {
            entry.level = truck.level;
            entry.graphic.attributes = { truckId: truck.id, hazardLevel: truck.level };
          }
        }
      }
      for (const [id, entry] of entries) {
        if (!seen.has(id)) {
          layer.remove(entry.graphic);
          entries.delete(id);
        }
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      layer.removeAll();
      entries.clear();
      layer.destroy();
    },
  };
}
