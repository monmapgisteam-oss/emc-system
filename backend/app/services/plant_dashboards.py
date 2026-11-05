"""Баяжуулах үйлдвэрийн ус, агаарын хяналтын самбар.

ArcGIS дээр dashboard item-гүй, энд бүрдэнэ: Ус нь «Хүрээлэн буй орчин / Ус»-ын, Агаар нь «Агаар»-ын бүтэцтэй
(толгойн шүүлтүүр, дээр дундаж утгууд, дунд газрын зураг ба салхи, доор сараарх графикууд).
Өгөгдөл нь feature service-ээс шууд ирнэ. Item id нь зөвхөн системийн дотоод танигч.
"""

from app.services.env_extras import ORANGE, RED, add_guides, caption, env_style, guide, monitor_layout
from app.services.env_extras import stack as _stack

SERVICES = "https://services7.arcgis.com/iErGCwr6emXIFjPR/arcgis/rest/services"
WATER_URL = f"{SERVICES}/Ус_баяжуулах_үйлдвэр/FeatureServer/0"
AIR_URL = f"{SERVICES}/Агаар_баяжуулах_үйлдвэр/FeatureServer/1"

PLANT_WATER = "b4a7e1c05d3f4e6a9c21f08d7e36a501"
PLANT_AIR = "b4a7e1c05d3f4e6a9c21f08d7e36a502"

# Нэргүй мөр (бүх талбар хоосон) самбарт орохгүй
HAS_NAME = "Сорьцын_нэр IS NOT NULL"
VALUE = "AVG_VALUE"
COUNT = "COUNT_VALUE"

# Үзүүлэлт: slug → (талбар, нэр, таб, графикийн гарчиг, картын орон, графикийн орон)
WATER_METRICS = {
    "ph": ("pH", "pH", "pH", "pH /дундаж/", 2, 1),
    "fe": ("Fe__", "Fe²⁺", "Fe²⁺", "Fe²⁺ /дундаж/", 2, 1),
    "cu": ("Cu", "Cu", "Cu", "Cu /дундаж/", 2, 1),
    "mo": ("Мо", "Mo", "Mo", "Mo /дундаж/", 2, 2),  # талбарын нэр кирилл «Мо»
    "nh4": ("NH__", "NH₄⁺", "NH₄⁺", "NH₄⁺ /дундаж/", 2, 2),
    "mn": ("Mn", "Mn", "Mn", "Mn /дундаж/", 1, 1),
    "no3": ("NO__", "NO₃⁻", "NO₃⁻", "NO₃⁻ /дундаж/", 2, 1),
    "ec": ("ХҮ", "ХҮ", "ХҮ", "ХҮ /дундаж/", 0, 1),
    "so4": ("SO___", "SO₄²⁻", "SO₄²⁻", "SO₄²⁻ /дундаж/", 0, 1),
    "cr": ("Cr__", "Cr⁶⁺", "Cr⁶⁺", "Cr⁶⁺ /дундаж/", 2, 3),
    "ca": ("Ca__", "Ca²⁺", "Ca²⁺", "Ca²⁺ /дундаж/", 2, 1),
    "no2": ("NO_1", "NO₂⁻", "NO₂⁻", "NO₂⁻ /дундаж/", 2, 3),
    "zn": ("Zn", "Zn", "Zn", "Zn /дундаж/", 2, 3),
    "mg": ("Mg__", "Mg²⁺", "Mg²⁺", "Mg²⁺ /дундаж/", 2, 1),
    "po4": ("PO___", "PO₄³⁻", "PO₄³⁻", "PO₄³⁻ /дундаж/", 2, 2),
    "f": ("F1", "F⁻", "F⁻", "F⁻ /дундаж/", 2, 2),
    "co3": ("CO___", "CO₃²⁻", "CO₃²⁻", "CO₃²⁻ /дундаж/", 2, 1),
    "color": ("Өнгө", "Өнгө", "ӨНГӨ", "ӨНГӨ /дундаж/", 0, 1),
    "hard": ("Хатуулаг", "Хатуулаг", "ХАТУУЛАГ", "ХАТУУЛАГ /дундаж/", 2, 2),
    "sio2": ("SiO_", "SiO₂", "SiO₂", "SiO₂ /дундаж/", 2, 1),
    "hco3": ("HCO__", "HCO₃⁻", "HCO₃⁻", "HCO₃⁻ /дундаж/", 1, 2),
    "cl": ("Cl_", "Cl⁻", "Cl⁻", "Cl⁻ /дундаж/", 2, 2),
    "tair": ("Агаар", "Агаар t⁰C", "АГААР t⁰C", "АГААРЫН ДУНДАЖ ТЕМПЕРАТУР", 2, 2),
    "twater": ("Ус", "Ус t⁰C", "УС t⁰C", "УСНЫ ДУНДАЖ ТЕМПЕРАТУР", 1, 2),
    "tds": ("ЖБ", "ЖБ", "ЖБ", "ЖБ /дундаж/", 0, 2),
    "wind": ("Салхины_хурд", "САЛХИНЫ ХУРД", "САЛХИНЫ ХУРД", "САЛХИНЫ ДУНДАЖ ХУРД", 1, 2),
    "wind2": ("Салхины_хурд2", "САЛХИНЫ ХУРД 2", "САЛХИНЫ ХУРД 2", "САЛХИНЫ ДУНДАЖ ХУРД 2", 1, 2),
}

AIR_METRICS = {
    "dust": ("Тоос", "Тоос", "Тоос", "Тоос /дундаж/", 3, 3),
    "co2": ("CO_", "CO₂", "CO₂", "CO₂ /дундаж/", 2, 2),
    "o2": ("O_", "O₂", "O₂", "O₂ /дундаж/", 2, 2),
    "so2": ("SO_", "SO₂", "SO₂", "SO₂ /дундаж/", 2, 2),
    "no2": ("NO_", "NO₂", "NO₂", "NO₂ /дундаж/", 2, 2),
    "hc": ("HC_LEL", "HC/LEL", "HC/LEL", "HC/LEL /дундаж/", 2, 2),
    "nox": ("NOx", "NOx", "NOx", "NOx /дундаж/", 2, 2),
    "co": ("CO", "CO", "CO", "CO /дундаж/", 2, 2),
    "no": ("NO1", "NO", "NO", "NO /дундаж/", 2, 2),
    "pressure": ("Даралт", "Даралт", "ДАРАЛТ", "ДАРАЛТ /дундаж/", 1, 1),
    "tair": ("Агаар", "Агаар t⁰C", "АГААР t⁰C", "АГААРЫН ДУНДАЖ ТЕМПЕРАТУР", 1, 1),
    "wind": ("хурд", "САЛХИНЫ ХУРД", "САЛХИНЫ ХУРД", "САЛХИНЫ ДУНДАЖ ХУРД", 1, 2),
    "wind2": ("хурд1", "САЛХИНЫ ХУРД 2", "САЛХИНЫ ХУРД 2", "САЛХИНЫ ДУНДАЖ ХУРД 2", 1, 2),
}

# Стандарт: (нэр, өнгө, шошгоны тал, {үзүүлэлт: утгууд}). US_HURS_AGAAR_GUIDE_ZURAAS_UTGA.xlsx, «bayjuulah_uildver US»
# Хоёр стандарт өөр цэгүүдэд хамаарна: 4943 нь нуур, шүүрэл, булагт; 6148 нь цооногт. Шошго нь давхцахгүйгээр хоёр талд
# pH-д Excel-д утга (6–9, 6.5–8.5) байгаа ч шугам зурахгүй: хэрэглэгчийн шийдвэр
WATER_STANDARDS = (
    ("MNS 4943:2015", RED, "left", {"fe": (1,), "cu": (1,), "mo": (0.5,), "mn": (0.5,), "cr": (0.01,), "zn": (3,), "ec": (1000,), "tds": (30,)}),
    ("MNS 6148:2010", ORANGE, "right", {"cu": (1,), "mo": (0.04,), "so4": (500,), "nh4": (3,), "no3": (50,), "no2": (1,), "mn": (0.1,), "cr": (0.005,), "zn": (5,), "po4": (3.5,), "f": (1.5,), "cl": (350,)}),
)

# Агаарт O₂ 0 байх боломжгүй: 2, 4, 5 сарын бичлэгт хэмжээгүйг 0 гэж бичсэн. Дунджийг татахгүйн тулд хасна
POSITIVE_ONLY = {"O_"}


def _rule(field: str, kind: str, operator: str, value=None) -> dict:
    rule = {"type": "filterRule", "field": {"name": field, "type": kind}, "operator": operator}
    if value is not None:
        rule["constraint"] = {"type": "value", "value": value}
    return rule


def _all_of(*rules: dict) -> dict:
    return {"type": "filterGroup", "condition": "AND", "rules": list(rules)}


def _fmt(name: str, digits: int) -> dict:
    return {"name": name, "prefix": True, "style": "decimal", "useGrouping": True, "maximumFractionDigits": digits}


def _dataset(source: dict, **fields) -> dict:
    return {"type": "serviceDataset", "name": "main", "dataSource": source, "groupByFields": [], "orderByFields": [], "outFields": ["*"], "returnDistinctValues": False, **fields}


def _avg(field: str) -> list:
    return [{"onStatisticField": field, "statisticType": "avg", "outStatisticFieldName": VALUE}]


def _value_rules(field: str) -> list:
    return [_rule(field, "double", "greater", 0)] if field in POSITIVE_ONLY else []


def _indicator(prefix: str, slug: str, metric: tuple, source: dict) -> dict:
    field, label, _, _, digits, _ = metric
    rules = _value_rules(field)
    return {
        "id": f"{prefix}-ind-{slug}",
        "type": "indicatorWidget",
        "name": label,
        "datasets": [_dataset(source, statisticDefinitions=_avg(field), **({"filter": rules[0]} if rules else {}))],
        "defaultSettings": {
            "topSection": {"fontSize": 80, "textInfo": {"text": label}},
            "middleSection": {"fontSize": 160, "textInfo": {"text": "{calculated/value}"}},
            "bottomSection": {"fontSize": 80, "textInfo": {"text": None}},
        },
        "comparison": "none",
        "valueConversion": {"factor": 1, "offset": 0},
        "valueFormat": _fmt("value", digits),
        "valueType": "statistic",
    }


def _month_chart(prefix: str, slug: str, metric: tuple, source: dict) -> dict:
    field, _, _, title, _, digits = metric
    config = {
        "type": "chart",
        "rotated": False,
        "stackedType": "sideBySide",
        "series": [{"type": "lineSeries", "id": slug, "name": title, "x": "Сар", "y": VALUE, "dataLabels": {"visible": True}}],
    }
    # Утга нь 0.0х: тэнхлэг дээр ялгарахаар
    if digits >= 3:
        config["valueDigits"] = digits
    return {
        "id": f"{prefix}-chart-{slug}",
        "type": "serialChartWidget",
        "name": title,
        "topCaption": caption(title),
        "categoryType": "groupByValues",
        "category": {"labelOverrides": [], "nullLabel": "null", "blankLabel": "blank"},
        "valueFormat": _fmt("value", digits),
        "labelFormat": _fmt("label", digits),
        "chartConfig": config,
        "datasets": [_dataset(source, groupByFields=["Сар"], statisticDefinitions=_avg(field), maxFeatures=1000, filter=_all_of(_rule("Сар", "double", "is_not_null"), *_value_rules(field)))],
    }


def _direction_pie(prefix: str, field: str, source: dict) -> dict:
    title = "САЛХИНЫ ЧИГЛЭЛ"
    return {
        "id": f"{prefix}-direction",
        "type": "pieChartWidget",
        "name": title,
        "topCaption": caption(title),
        "categoryType": "groupByValues",
        "category": {"labelOverrides": [], "nullLabel": "null", "blankLabel": "blank"},
        "valueFormat": _fmt("value", 0),
        "chartConfig": {"type": "chart", "series": [{"type": "pieSeries", "id": "main", "name": title, "x": field, "y": COUNT, "innerRadius": 65, "startAngle": 225, "dataLabels": {"visible": False}}]},
        # «-» гэж бичсэн нь чиглэл биш
        "datasets": [_dataset(source, groupByFields=[field], statisticDefinitions=[{"onStatisticField": "OBJECTID", "statisticType": "count", "outStatisticFieldName": COUNT}], filter=_all_of(_rule(field, "string", "is_not_null"), _rule(field, "string", "not_equal", "-")))],
    }


def _selector(prefix: str, slug: str, label: str, field: str, source: dict) -> dict:
    return {
        "id": f"{prefix}-sel-{slug}",
        "type": "categorySelectorWidget",
        "name": label,
        "label": label,
        "category": {"type": "groupByValues", "labelOverrides": []},
        "selection": {"operator": "is_in", "allowNone": True, "noneLabelPlacement": "first", "type": "multiple"},
        "showFilter": True,
        "datasets": [_dataset(source, groupByFields=[field], orderByFields=[f"{field} ASC"], statisticDefinitions=[{"onStatisticField": field, "statisticType": "count", "outStatisticFieldName": COUNT}], maxFeatures=50)],
    }


def _item(wid: str, **extra) -> dict:
    return {"type": "itemLayoutElement", "id": wid, "width": 1, "height": 1, **extra}


def _tabs(tid: str, metrics: dict, charts: dict, group: list) -> dict:
    return {"type": "tabsLayoutElement", "id": tid, "width": 1, "height": 1, "elements": [_item(charts[slug]["id"], tabName=metrics[slug][2]) for slug in group]}


def _build(item_id: str, prefix: str, title: str, url: str, metrics: dict, cards: list, winds: list, direction: str, tabs: list, standards: tuple = (), cards_on_top: bool = False) -> dict:
    source = {"type": "layerDataSource", "url": url, "where": HAS_NAME, "title": title}
    map_id = f"{prefix}-map"
    layer_id = f"{prefix}-layer"
    indicators = {slug: _indicator(prefix, slug, metrics[slug], source) for row in [*cards, winds] for slug in row}
    charts = {slug: _month_chart(prefix, slug, metrics[slug], source) for group in tabs for slug in group}
    pie = _direction_pie(prefix, direction, source)
    for label, color, align, values in standards:
        for slug, limits in values.items():
            add_guides(charts[slug], [guide(limit, label, color, align) for limit in limits])
    selectors = [
        _selector(prefix, "place", "БАЙРШЛААР ШҮҮХ", "Сорьцын_нэр", source),
        _selector(prefix, "year", "ОНООР ШҮҮХ", "Жил", source),
        _selector(prefix, "month", "САРААР ШҮҮХ", "Сар", source),
        _selector(prefix, "day", "ӨДРӨӨР ШҮҮХ", "Өдөр", source),
    ]
    # Шүүлтүүр, график, дугуй, газрын зураг дээр сонгоход бусад нь бүгд шүүгдэнэ
    data_targets = [{"targetId": f"{w['id']}#main", "by": "whereClause", "requiresSelection": False} for w in [*selectors, *indicators.values(), pie, *charts.values()]]
    map_target = {"targetId": f"{map_id}#{layer_id}", "by": "whereClause", "requiresSelection": False}
    events = [{"type": "selectionChanged", "actions": [{"type": "filter", "targets": [*data_targets, map_target]}]}]
    for w in [*selectors, pie, *charts.values()]:
        w["events"] = events
    map_widget = {
        "id": map_id,
        "type": "mapWidget",
        "name": title,
        "itemId": item_id,
        "clickFields": {layer_id: "Сорьцын_нэр"},
        "events": [{"type": "selectionChanged", "actions": [{"type": "filter", "targets": data_targets}]}],
    }
    widgets = [*indicators.values(), map_widget, pie, *charts.values()]

    tab_nodes = [_tabs(f"{prefix}-tabs-{i}", metrics, charts, group) for i, group in enumerate(tabs)]
    all_cards = [_item(indicators[slug]["id"]) for row in cards for slug in row]
    wind_cards = [_item(indicators[slug]["id"]) for slug in winds]
    dash = {
        "id": item_id,
        "title": title,
        "modified": None,
        "access": "public",
        "version": None,
        "header": {"type": "header", "title": title, "selectors": selectors},
        "leftPanel": None,
        "widgets": widgets,
    }
    if cards_on_top:
        # «Хүрээлэн буй орчин / Агаар»-ын бүтэц: дээр картууд, дунд дугуй, газрын зураг, график, доор 2 график
        weather, *rest = tab_nodes[::-1]
        dash["layout"] = _stack(f"{prefix}-root", "row", [
            _stack(f"{prefix}-cards", "col", [*all_cards, *wind_cards], height=0.13),
            _stack(f"{prefix}-main", "col", [{**_item(pie["id"]), "width": 0.25}, {**_item(map_id), "width": 0.45}, {**weather, "width": 0.3}], height=0.43),
            _stack(f"{prefix}-charts", "col", [{**t, "width": 1 / len(rest)} for t in rest[::-1]], height=0.44),
        ])
    else:
        dash["layout"] = _stack(f"{prefix}-root", "col", [
            _stack(f"{prefix}-cards", "row", all_cards),
            _stack(f"{prefix}-middle", "row", [_item(map_id), _stack(f"{prefix}-weather", "col", [_stack(f"{prefix}-winds", "row", wind_cards), _item(pie["id"])])]),
            _stack(f"{prefix}-charts", "row", tab_nodes),
        ])
        monitor_layout(dash)
    env_style(dash)
    return dash


_DASHBOARDS = {
    PLANT_WATER: _build(
        PLANT_WATER,
        "plant-water",
        "БАЯЖУУЛАХ ҮЙЛДВЭРИЙН УСНЫ МЭДЭЭЛЛИЙН ХЯНАЛТЫН САМБАР",
        WATER_URL,
        WATER_METRICS,
        cards=[
            ["ph", "fe", "cu"], ["mo", "nh4", "mn"], ["no3", "ec", "so4"], ["cr", "ca", "no2"],
            ["zn", "mg", "po4"], ["f", "co3", "color"], ["hard", "sio2", "hco3"], ["cl", "tair", "twater"],
        ],
        winds=["wind", "wind2"],
        direction="Чиглэл",
        tabs=[
            ["so4", "ph", "nh4", "no2", "no3", "ec", "color", "cu", "ca", "mg", "co3"],
            ["po4", "zn", "sio2", "cr", "mn", "fe", "mo", "tds", "f", "hco3"],
            ["hard", "cl", "tair", "twater", "wind", "wind2"],
        ],
        standards=WATER_STANDARDS,
    ),
    PLANT_AIR: _build(
        PLANT_AIR,
        "plant-air",
        "БАЯЖУУЛАХ ҮЙЛДВЭРИЙН АГААРЫН МЭДЭЭЛЛИЙН ХЯНАЛТЫН САМБАР",
        AIR_URL,
        AIR_METRICS,
        cards=[["dust", "co2", "o2"], ["so2", "no2", "hc"], ["nox", "co", "no"], ["pressure", "tair"]],
        winds=["wind", "wind2"],
        direction="чиглэл",
        tabs=[
            ["dust", "o2", "co2"],
            ["so2", "no2", "nox", "co", "no", "hc"],
            ["pressure", "tair", "wind", "wind2"],
        ],
        cards_on_top=True,
    ),
}

_MAP_SOURCES = {PLANT_WATER: ("plant-water", WATER_URL, WATER_METRICS), PLANT_AIR: ("plant-air", AIR_URL, AIR_METRICS)}


def get(item_id: str) -> dict | None:
    return _DASHBOARDS.get(item_id)


def map_layers(item_id: str) -> list[dict] | None:
    """Газрын зургийн ганц давхарга: цэг бүр сорьц авсан байршил."""
    if item_id not in _DASHBOARDS:
        return None
    prefix, url, metrics = _MAP_SOURCES[item_id]
    popup_fields = [{"name": "Огноо", "label": "Огноо"}, *({"name": m[0], "label": m[1]} for m in metrics.values())]
    return [{
        "id": f"{prefix}-layer",
        "title": _DASHBOARDS[item_id]["title"],
        "kind": "feature",
        "url": url,
        "visible": True,
        "opacity": 1,
        "definitionExpression": HAS_NAME,
        "drawingInfo": {"renderer": {"type": "simple", "symbol": {"type": "esriSMS", "style": "esriSMSCircle", "color": [52, 208, 174, 255], "size": 8, "outline": {"color": [255, 255, 255, 255], "width": 0.75}}}},
        "labelField": "Сорьцын_нэр",
        "popup": {"title": None, "fields": popup_fields},
        "itemId": None,
    }]
