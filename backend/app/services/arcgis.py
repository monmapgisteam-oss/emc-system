"""ArcGIS Online холболт: dashboard-ын тодорхойлолт уншиж, виджет бүрийн өгөгдлийг
feature service-ээс шууд (live) асууна.

Хаалттай (private) item-д хандахын тулд орчны хувьсагчийн аль нэгийг тохируулна:
  EMC_ARCGIS_TOKEN                       — бэлэн token
  EMC_ARCGIS_USERNAME / EMC_ARCGIS_PASSWORD — нэвтрэх нэр, нууц үгээр token үүсгэнэ
"""

import copy
import json
import os
import re
import threading
import time
from contextvars import ContextVar
from datetime import datetime

import httpx
from app.services import dashboard_extras

PORTAL = os.getenv("EMC_ARCGIS_PORTAL", "https://www.arcgis.com").rstrip("/")
ITEM_TTL = 600  # dashboard, webmap, давхаргын тодорхойлолт — 10 мин
QUERY_TTL = 120  # статистик асуулга — 2 мин
MAX_FEATURES = 2000

_cache: dict[str, tuple[float, object]] = {}
_lock = threading.Lock()
_token: dict = {"value": os.getenv("EMC_ARCGIS_TOKEN") or None, "expires": float("inf")}
_client = httpx.Client(timeout=40, follow_redirects=True)


class ArcGISError(Exception):
    def __init__(self, message: str, code: int | None = None):
        super().__init__(message)
        self.code = code


# Нэвтэрсэн хэрэглэгчийн ArcGIS token (хүсэлт бүрт middleware тохируулна).
# Ингэснээр хэрэглэгч өөрийн эрхтэй хаалттай dashboard-ыг харна.
_user: ContextVar[dict | None] = ContextVar("arcgis_user", default=None)
EMC_ORG_ID = os.getenv("EMC_ARCGIS_ORG_ID", "iErGCwr6emXIFjPR")


def set_user(username: str | None, user_token: str | None, referer: str | None):
    _user.set({"username": username, "token": user_token, "referer": referer} if user_token else None)


def _scope() -> str:
    u = _user.get()
    return f"u:{u['username']}" if u else "pub"


def generate_token(username: str, password: str, referer: str, minutes: int = 720) -> dict:
    """ArcGIS Online нэр, нууц үгээр token үүсгэж, хэрэглэгчийн мэдээлэлтэй буцаана."""
    try:
        r = _client.post(
            f"{PORTAL}/sharing/rest/generateToken",
            data={"username": username, "password": password, "client": "referer", "referer": referer, "expiration": minutes, "f": "json"},
        ).json()
    except httpx.HTTPError as e:
        raise ArcGISError(f"ArcGIS Online-тэй холбогдож чадсангүй: {e}", 502)
    if "token" not in r:
        raise ArcGISError("Нэвтрэх нэр эсвэл нууц үг буруу байна", 401)
    me = _client.get(
        f"{PORTAL}/sharing/rest/community/self", params={"f": "json", "token": r["token"]}, headers={"Referer": referer}
    ).json()
    return {"token": r["token"], "expires": r["expires"] / 1000, "self": me}


def has_credentials() -> bool:
    return bool(_user.get() or _token["value"] or os.getenv("EMC_ARCGIS_USERNAME"))


def token() -> str | None:
    u = _user.get()
    if u:
        return u["token"]
    if _token["value"] and time.time() < _token["expires"] - 60:
        return _token["value"]
    user, pwd = os.getenv("EMC_ARCGIS_USERNAME"), os.getenv("EMC_ARCGIS_PASSWORD")
    if not (user and pwd):
        return _token["value"]
    r = _client.post(
        f"{PORTAL}/sharing/rest/generateToken",
        data={"username": user, "password": pwd, "client": "referer", "referer": PORTAL, "expiration": 120, "f": "json"},
    ).json()
    if "token" not in r:
        raise ArcGISError(f"ArcGIS нэвтрэлт амжилтгүй: {r.get('error', {}).get('message', r)}", 401)
    _token.update(value=r["token"], expires=r["expires"] / 1000)
    return r["token"]


def _cached(key: str, ttl: int, fn):
    # Хэрэглэгч бүрийн эрх өөр тул кэшийг хэрэглэгчээр тусгаарлана
    key = f"{_scope()}|{key}"
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    value = fn()
    with _lock:
        _cache[key] = (now, value)
    return value


def _request(url: str, params: dict, method: str = "GET") -> dict:
    params = {**params, "f": "json"}
    tok = token()
    headers = {}
    if tok:
        params["token"] = tok
        # referer-д холбогдсон token тул ижил Referer илгээнэ
        u = _user.get()
        headers["Referer"] = (u and u["referer"]) or PORTAL
    r = _client.post(url, data=params, headers=headers) if method == "POST" else _client.get(url, params=params, headers=headers)
    if r.status_code >= 400:
        raise ArcGISError(f"ArcGIS HTTP {r.status_code}", r.status_code)
    data = r.json()
    if isinstance(data, dict) and "error" in data:
        err = data["error"]
        code = err.get("code")
        detail = json.dumps(err, ensure_ascii=False).lower()
        if code in (403, 498, 499) or "permission" in detail or "not authorized" in detail:
            raise ArcGISError("Энэ item хаалттай. ArcGIS нэвтрэх эрх тохируулна уу.", 403)
        raise ArcGISError(err.get("message") or "ArcGIS алдаа", code)
    return data


def item(item_id: str) -> dict:
    return _cached(f"item:{item_id}", ITEM_TTL, lambda: _request(f"{PORTAL}/sharing/rest/content/items/{item_id}", {}))


def item_data(item_id: str) -> dict:
    return _cached(
        f"data:{item_id}", ITEM_TTL, lambda: _request(f"{PORTAL}/sharing/rest/content/items/{item_id}/data", {})
    )


def layer_info(url: str) -> dict:
    return _cached(f"layer:{url}", ITEM_TTL, lambda: _request(url, {}))


def clear_cache():
    with _lock:
        _cache.clear()


# ---------------------------------------------------------------- dashboard


def dashboard(item_id: str) -> dict:
    """Dashboard-ын тодорхойлолт: header, layout, виджетүүд (desktop view)."""
    meta = item(item_id)
    if meta.get("type") != "Dashboard":
        raise ArcGISError(f"Энэ item dashboard биш ({meta.get('type')})", 400)
    data = item_data(item_id)
    view = data.get("desktopView") or data
    return dashboard_extras.apply({
        "id": item_id,
        "title": meta.get("title"),
        "modified": meta.get("modified"),
        "access": meta.get("access"),
        "version": data.get("version"),
        "header": view.get("header"),
        "leftPanel": view.get("leftPanel"),
        "layout": (view.get("layout") or {}).get("rootElement"),
        "widgets": view.get("widgets") or data.get("widgets") or [],
    })


def find_widget(dash: dict, widget_id: str) -> dict:
    pools = [dash["widgets"], (dash.get("header") or {}).get("selectors") or [], (dash.get("leftPanel") or {}).get("selectors") or []]
    for pool in pools:
        for w in pool:
            if w.get("id") == widget_id:
                return w
    raise ArcGISError("Виджет олдсонгүй", 404)


# ---------------------------------------------------------------- data source → layer


def _walk_layers(layers: list[dict]):
    for lyr in layers or []:
        yield lyr
        yield from _walk_layers(lyr.get("layers") or [])


def webmap_layers(webmap_id: str) -> dict:
    data = item_data(webmap_id)
    return {
        "operational": list(_walk_layers(data.get("operationalLayers") or [])) + list(data.get("tables") or []),
        "basemap": (data.get("baseMap") or {}).get("baseMapLayers") or [],
        "title": (data.get("baseMap") or {}).get("title"),
    }


def resolve_source(source: dict) -> dict:
    """layerDataSource → {url, definitionExpression, title}."""
    item_id, layer_id = source.get("itemId"), source.get("layerId")
    if not item_id:
        raise ArcGISError("Өгөгдлийн эх үүсвэр тодорхойгүй", 400)
    meta = item(item_id)
    if meta.get("type") == "Web Map":
        for lyr in webmap_layers(item_id)["operational"]:
            if str(lyr.get("id")) == str(layer_id):
                if not lyr.get("url"):
                    raise ArcGISError("Давхарга service URL-гүй (featureCollection)", 400)
                return {
                    "url": lyr["url"],
                    "definitionExpression": (lyr.get("layerDefinition") or {}).get("definitionExpression"),
                    "title": lyr.get("title"),
                }
        raise ArcGISError(f"Webmap-д давхарга олдсонгүй: {layer_id}", 404)
    url = meta.get("url")
    if not url:
        raise ArcGISError("Item-д service URL алга", 400)
    if url.rstrip("/").split("/")[-1].isdigit():
        return {"url": url, "definitionExpression": None, "title": meta.get("title")}
    return {"url": f"{url.rstrip('/')}/{layer_id or 0}", "definitionExpression": None, "title": meta.get("title")}


def fields_of(url: str) -> list[dict]:
    out = []
    for f in layer_info(url).get("fields") or []:
        dom = f.get("domain") or {}
        out.append(
            {
                "name": f["name"],
                "alias": f.get("alias") or f["name"],
                "type": f.get("type"),
                "domain": {str(c["code"]): c["name"] for c in dom.get("codedValues") or []} or None,
            }
        )
    return out


# ---------------------------------------------------------------- SQL


def _lit(v, ftype: str | None = None) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float)) and ftype != "esriFieldTypeString":
        return repr(v)
    if ftype == "esriFieldTypeDate" or isinstance(v, datetime):
        if isinstance(v, datetime):
            ts = v
        elif isinstance(v, (int, float)):
            ts = datetime.fromtimestamp(v / 1000)  # epoch мс
        else:
            ts = datetime.fromisoformat(str(v).replace("Z", ""))
        return f"timestamp '{ts:%Y-%m-%d %H:%M:%S}'"
    return "'" + str(v).replace("'", "''") + "'"


def _ident(name: str) -> str:
    if not name or any(c in name for c in "'\";()") or "--" in name:
        raise ArcGISError(f"Буруу талбарын нэр: {name}", 400)
    return name


def filter_to_sql(node: dict | None) -> str | None:
    """Dashboard-ын бүтэцтэй шүүлтүүрийг (filterGroup / filterRule) SQL болгоно."""
    if not node:
        return None
    if node.get("type") == "filterGroup":
        parts = [p for p in (filter_to_sql(r) for r in node.get("rules") or []) if p]
        if not parts:
            return None
        return "(" + f" {node.get('condition', 'AND')} ".join(parts) + ")"
    field = (node.get("field") or {}).get("name")
    ftype = {"integer": "esriFieldTypeInteger", "string": "esriFieldTypeString", "date": "esriFieldTypeDate"}.get(
        (node.get("field") or {}).get("type"), None
    )
    op = node.get("operator")
    c = node.get("constraint") or {}
    val = c.get("value")
    f = _ident(field)
    ops = {"equal": "=", "not_equal": "<>", "greater": ">", "greater_or_equal": ">=", "less": "<", "less_or_equal": "<="}
    if op in ops:
        return f"{f} {ops[op]} {_lit(val, ftype)}"
    if op in ("is_in", "not_in"):
        vals = c.get("values") or (val if isinstance(val, list) else [val])
        return f"{f} {'NOT IN' if op == 'not_in' else 'IN'} ({', '.join(_lit(v, ftype) for v in vals)})"
    if op == "between":
        return f"{f} BETWEEN {_lit(c.get('min'), ftype)} AND {_lit(c.get('max'), ftype)}"
    if op == "is_null":
        return f"{f} IS NULL"
    if op == "is_not_null":
        return f"{f} IS NOT NULL"
    if op in ("contains", "does_not_contain", "begins_with", "ends_with"):
        pat = {"contains": f"%{val}%", "does_not_contain": f"%{val}%", "begins_with": f"{val}%", "ends_with": f"%{val}"}[op]
        return f"{f} {'NOT ' if op == 'does_not_contain' else ''}LIKE {_lit(pat)}"
    return None  # дэмжээгүй оператор — шүүлтгүй үлдээнэ


def runtime_filter_to_sql(flt: dict, field_types: dict[str, str]) -> str | None:
    """Хэрэглэгчийн сонголтоос ирсэн шүүлтүүр: {field, op: in|between|contains, values}."""
    field = _ident(flt["field"])
    ftype = field_types.get(field)
    values = flt.get("values") or []
    if flt.get("op") == "contains":
        # Олон утгатай талбар ("Нэр1,Нэр2") — аль нэг нэр агуулсан бичлэг
        parts = [f"{field} LIKE {_lit('%' + str(v) + '%')}" for v in values if v not in (None, "")]
        return "(" + " OR ".join(parts) + ")" if parts else None
    if flt.get("op") == "between" and len(values) == 2:
        parts = []
        if values[0] is not None:
            parts.append(f"{field} >= {_lit(values[0], ftype)}")
        if values[1] is not None:
            parts.append(f"{field} <= {_lit(values[1], ftype)}")
        return " AND ".join(parts) or None
    if not values:
        return None
    non_null = [v for v in values if v is not None]
    parts = []
    if non_null:
        parts.append(f"{field} IN ({', '.join(_lit(v, ftype) for v in non_null)})")
    if len(non_null) < len(values):
        parts.append(f"{field} IS NULL")
    return "(" + " OR ".join(parts) + ")"


# ---------------------------------------------------------------- query


def run_dataset(ds: dict, runtime_filters: list[dict], sort_desc: str | None = None) -> dict:
    if ds.get("type") == "staticDataset":
        data = ds.get("data") or {}
        return {"rows": data.get("rows") or data.get("features") or [], "fields": data.get("fields") or []}

    src = resolve_source(ds.get("dataSource") or {})
    fields = fields_of(src["url"])
    types = {f["name"]: f["type"] for f in fields}

    where = [w for w in (src.get("definitionExpression"), filter_to_sql(ds.get("filter"))) if w]
    where += [w for w in (runtime_filter_to_sql(f, types) for f in runtime_filters) if w]
    params: dict = {"where": " AND ".join(f"({w})" for w in where) or "1=1", "returnGeometry": "false"}

    stats = ds.get("statisticDefinitions") or []
    group_by = [g for g in ds.get("groupByFields") or [] if g]
    order_by = [o for o in ds.get("orderByFields") or [] if o]
    if stats:
        params["outStatistics"] = json.dumps(
            [
                {k: s[k] for k in ("statisticType", "onStatisticField", "outStatisticFieldName", "statisticParameters") if k in s}
                for s in stats
            ],
            ensure_ascii=False,
        )
        if group_by:
            params["groupByFieldsForStatistics"] = ",".join(group_by)
    else:
        out_fields = ds.get("outFields") or ["*"]
        params["outFields"] = ",".join(out_fields)
        params["resultRecordCount"] = min(int(ds.get("maxFeatures") or MAX_FEATURES), MAX_FEATURES)
        if ds.get("returnDistinctValues"):
            params["returnDistinctValues"] = "true"
    # Олон бичлэгтэй (2000-аас их) давхаргаас «их утгатай нь» хэрэгтэй үед ArcGIS дээр эрэмбэлж авна
    if sort_desc and not stats and not order_by and sort_desc in types:
        order_by = [f"{_ident(sort_desc)} DESC"]
    if order_by:
        params["orderByFields"] = ",".join(order_by)

    key = f"q:{src['url']}:{json.dumps(params, sort_keys=True, ensure_ascii=False)}"

    def fetch():
        try:
            res = _request(f"{src['url']}/query", params, method="POST")
        except ArcGISError:
            if "orderByFields" not in params:
                raise
            # Зарим service статистиктай orderBy-г дэмждэггүй — эрэмбэгүйгээр дахин оролдоно
            res = _request(f"{src['url']}/query", {k: v for k, v in params.items() if k != "orderByFields"}, "POST")
        return {"rows": [f.get("attributes", {}) for f in res.get("features") or []], "more": bool(res.get("exceededTransferLimit"))}

    got = _cached(key, QUERY_TTL, fetch)
    total = None
    if got["more"]:
        # Хязгаараас хэтэрсэн — нийт тоог тусад нь асууна
        cnt = _cached(f"c:{key}", QUERY_TTL, lambda: _request(f"{src['url']}/query", {"where": params["where"], "returnCountOnly": "true"}, "POST"))
        total = cnt.get("count")
    return {"rows": got["rows"], "fields": fields, "layer": src.get("title"), "total": total}


def _cim_color(c) -> list | None:
    """CIM өнгө: [r,g,b,a] (a нь 0–255) эсвэл {"values": [r,g,b,a]} (a нь 0–100)."""
    if isinstance(c, dict):
        v = c.get("values") or []
        if len(v) >= 3:
            return [int(v[0]), int(v[1]), int(v[2]), int(round((v[3] if len(v) > 3 else 100) * 2.55))]
        return None
    if isinstance(c, list) and len(c) >= 3:
        return [int(x) for x in c[:3]] + [int(c[3]) if len(c) > 3 else 255]
    return None


def _cim_layers(sym: dict) -> list[dict]:
    return [layer for layer in sym.get("symbolLayers") or [] if layer.get("enable", True)]


def _cim_to_simple(sym, fill_hollow: bool = False):
    """ArcGIS Pro-ийн CIM тэмдэглэгээг Leaflet (esri-leaflet-renderers) ойлгох энгийн тэмдэглэгээ болгоно.
    Хувиргаагүй бол талбай, шугам огт зурагдахгүй байдаг."""
    if not isinstance(sym, dict) or sym.get("type") != "CIMSymbolReference":
        return sym
    s = sym.get("symbol") or {}
    layers = _cim_layers(s)
    fill = next((x for x in layers if x.get("type") == "CIMSolidFill"), None)
    stroke = next((x for x in layers if x.get("type") == "CIMSolidStroke"), None)
    t = s.get("type")
    if t == "CIMPolygonSymbol":
        line = (_cim_color(stroke.get("color")) if stroke else None) or [0, 0, 0, 0]
        # Ангиллаар өнгөлсөн (uniqueValue) дүүргэлтгүй талбайг хүрээний өнгөөр бүдэг дүүргэнэ.
        # Нэг тэмдэглэгээтэй хүрээ (аймаг, сумын хил) хөндий хэвээр — газрын зургийг таглахгүй
        color = (_cim_color(fill.get("color")) if fill else None) or (line[:3] + [56] if stroke and fill_hollow else None)
        return {
            "type": "esriSFS",
            "style": "esriSFSSolid" if color else "esriSFSNull",
            "color": color or [0, 0, 0, 0],
            "outline": {
                "type": "esriSLS",
                "style": "esriSLSSolid" if stroke else "esriSLSNull",
                "color": line,
                "width": max(0.5, float(stroke.get("width", 1))) if stroke else 0,
            },
        }
    if t == "CIMLineSymbol":
        return {
            "type": "esriSLS",
            "style": "esriSLSSolid",
            "color": (_cim_color(stroke.get("color")) if stroke else None) or [128, 128, 128, 255],
            "width": max(0.75, float(stroke.get("width", 1)) if stroke else 1),
        }
    if t == "CIMPointSymbol":
        marker = next((x for x in layers if "Marker" in (x.get("type") or "")), {})
        color = None
        for g in marker.get("markerGraphics") or []:
            f = next((x for x in _cim_layers(g.get("symbol") or {}) if x.get("type") == "CIMSolidFill"), None)
            if f:
                color = _cim_color(f.get("color"))
                break
        return {
            "type": "esriSMS",
            "style": "esriSMSCircle",
            "color": color or [52, 208, 174, 255],
            "size": float(marker.get("size", 6)),
            "outline": {"color": [255, 255, 255, 255], "width": 0.75},
        }
    return sym


def simplify_drawing_info(di):
    if not isinstance(di, dict) or not isinstance(di.get("renderer"), dict):
        return di
    di = copy.deepcopy(di)
    r = di["renderer"]
    for k in ("symbol", "defaultSymbol"):
        if k in r:
            r[k] = _cim_to_simple(r[k], fill_hollow=r.get("type") in ("uniqueValue", "classBreaks"))
    for k in ("uniqueValueInfos", "classBreakInfos"):
        for info in r.get(k) or []:
            if "symbol" in info:
                info["symbol"] = _cim_to_simple(info["symbol"], fill_hollow=True)
    return di


def label_field(drawing_info) -> str | None:
    """Webmap-ын шошгоны илэрхийллээс талбарын нэрийг гаргана: $feature.NAME, $feature["NAME"], [NAME]."""
    for li in (drawing_info or {}).get("labelingInfo") or []:
        expr = (li.get("labelExpressionInfo") or {}).get("expression") or li.get("labelExpression") or ""
        m = re.search(r"\$feature(?:\.(\w+)|\[\s*[\"']([^\"']+)[\"']\s*\])", expr) or re.search(r"\[([^\]]+)\]", expr)
        if m:
            return next(g for g in m.groups() if g)
    return None


def _popup_spec(pi) -> dict | None:
    """Webmap-д тохируулсан popup: гарчгийн загвар ба харагдах талбарууд (дарааллаар, нэртэй)."""
    if not isinstance(pi, dict):
        return None
    fields = [
        {"name": f["fieldName"], "label": f.get("label") or f["fieldName"]}
        for f in pi.get("fieldInfos") or []
        if f.get("visible") and f.get("fieldName") and not str(f["fieldName"]).startswith(("expression/", "relationships/"))
    ]
    return {"title": pi.get("title"), "fields": fields}


def _layer_out(lyr: dict) -> dict | None:
    """Webmap-ын нэг давхаргыг Leaflet-д ойлгомжтой хэлбэрт оруулна (дэмжигдээгүй бол None)."""
    if not lyr.get("url"):
        return None
    ltype = lyr.get("layerType") or ""
    kind = (
        "feature"
        if ltype == "ArcGISFeatureLayer"
        else "tiled"
        if ltype in ("ArcGISTiledMapServiceLayer", "VectorTileLayer") and "MapServer" in lyr["url"]
        else "dynamic"
        if ltype == "ArcGISMapServiceLayer"
        else "imagery"
        if ltype in ("ArcGISImageServiceLayer", "ArcGISTiledImageServiceLayer")
        else None
    )
    if not kind:
        return None
    ld = lyr.get("layerDefinition") or {}
    return {
        "id": str(lyr.get("id")),
        "title": lyr.get("title"),
        "kind": kind,
        "url": lyr["url"],
        "visible": lyr.get("visibility", True),
        "opacity": lyr.get("opacity", 1),
        "definitionExpression": ld.get("definitionExpression"),
        "drawingInfo": simplify_drawing_info(ld.get("drawingInfo")),
        "labelField": label_field(ld.get("drawingInfo")),
        "popup": _popup_spec(lyr.get("popupInfo")),
        "itemId": lyr.get("itemId"),
    }


def map_layers(webmap_id: str) -> dict:
    """Map виджетэд зориулж webmap-ын давхаргуудыг хавтгай жагсаалтаар."""
    wm = webmap_layers(webmap_id)
    layers = [out for out in map(_layer_out, wm["operational"]) if out]
    base = [b.get("url") for b in wm["basemap"] if b.get("url")]
    return {"layers": layers, "basemap": base, "basemap_title": wm["title"], "token": token()}


def _tree_nodes(layers: list[dict], parent_on: bool = True) -> list[dict]:
    """Давхаргын мод (бүлгүүдтэй). Навч анх асаалттай эсэх: өөрөө болон бүх эцэг бүлэг нь асаалттай бол."""
    nodes = []
    for lyr in layers or []:
        on = parent_on and lyr.get("visibility") is not False
        if lyr.get("layerType") == "GroupLayer" or lyr.get("layers"):
            children = _tree_nodes(lyr.get("layers") or [], on)
            if children:
                nodes.append({"id": str(lyr.get("id")), "title": lyr.get("title"), "itemId": lyr.get("itemId"), "children": children})
            continue
        out = _layer_out(lyr)
        if out:
            nodes.append({**out, "visible": on})
    return nodes


def map_tree(webmap_id: str) -> dict:
    """Webmap-ыг бүлгийн бүтэцтэй нь: давхаргын цэс, анхны харагдац, суурь зураг."""
    data = item_data(webmap_id)
    basemap = data.get("baseMap") or {}
    target = ((data.get("initialState") or {}).get("viewpoint") or {}).get("targetGeometry") or {}
    return {
        "tree": _tree_nodes(data.get("operationalLayers") or []),
        "extent": {k: target[k] for k in ("xmin", "ymin", "xmax", "ymax")} if all(k in target for k in ("xmin", "ymin", "xmax", "ymax")) else None,
        "basemap": [b.get("url") for b in basemap.get("baseMapLayers") or [] if b.get("url")],
        "basemap_title": basemap.get("title"),
        "token": token(),
    }
