"""ArcGIS dashboard дээр байхгүй, энэ системд нэмсэн график. Тодорхойлолтыг ачаалсны дараа нэмнэ."""
import copy
import logging

from app.services import env_extras

logger = logging.getLogger(__name__)

EXPLORATION = "e009bee96a01463da6ea562c3ec8f030"
HOLES = "ef613a0502c74faf9ed7ed95412dd4e0"
WATER_IN = "f17b1fc982aa4db687f1927f37416ce4"
WATER_OUT = "60269f37a24a4bcda81469f3e8bf607f"
WATER_GENERAL = "4aa22bcf722b42af9a04bfbc38a46758"
WATER_OTHER = "38f309925fe447bb886268dd921b3da0"
GOVIL = "c78ba973fe1e4dfe9eb2569a83558e0c"
PIEZOMETER = "add0cac7777548b8ae50a56540ac9dab"
RADIAL_WELLS = "6881797668e94c309b6da112353c31f7"
LAND_REGISTER = "e1ec8b20a6d347e68e64349abf134d50"
LICENCES = "b84bc4b55e2d45d99e2e85cb8aaf08c3"
CABLES = "8cbeb0e832c345c88edf491a518af092"
CABLE_SURVEY = "a7183226293c4b2788e7b00164fba242"
LAKE = "e50476e7809b4a76a0650bbe1e45e8b2"
HISTORY = "7de28b1b1fd84d75be4cfb3b376c1113"
RESERVES = "e3629640d8dd45698968acc1244cf133"
DUMPS = "d794edd303ad4a788a91b9378dfc0461"
HOLE_REPORT = "0b51c6d23a604d54aa2ef92683d0ac0a"
DRILL_MACHINES = "f32f890793984c13824263d87e9c969e"
DRILL_REPORT = "d50ba73480fd4a96ae83656d7438ed1f"
MAP_ITEM = "8febf814307f4429aca6fff85a434bc4"
COLLAR = {"type": "layerDataSource", "itemId": MAP_ITEM, "layerId": "19cb299c46a-layer-7"}
# Гол хоёр төсөл нэг өнгөний хоёр түвшнээр, бусад нь саарал
MIX_COLORS = {"NW": "#34d0ae", "CEN": "#a8e6d6"}
MIX_OTHER = "#7d8f8a"
HAS_YEAR = {"type": "filterRule", "field": {"name": "start_year", "type": "integer"}, "operator": "is_not_null"}
PROJECT_SELECTOR = "a51cd586"
DATE_SELECTOR = "37a9e1ae"
PURPOSE_SELECTOR = "e9e01247"
YEAR_SELECTOR = "790773d8"
DEPTH_BAR = "bc4047a9"
MAP = "8b8f6e9f-5e5c-4e78-85e6-157eb1a7dada"
COLLAR_KPI = "a050a4da-4219-47cb-82bc-7dc04063258d"


def _caption(text: str) -> str:
    return f'<p style="text-align:center;"><strong>{text}</strong></p>'


def _chart(wid: str, title: str, field: str, stat: str, out: str, on: str, *, kind: str = "barSeries", columns: bool = True, order: str | None = None) -> dict:
    w = {
        "id": wid,
        "type": "serialChartWidget",
        "topCaption": _caption(title),
        "categoryType": "groupByValues",
        "category": {"labelOverrides": [], "nullLabel": "null", "blankLabel": "blank"},
        "valueFormat": {"name": "value", "prefix": False, "style": "decimal", "useGrouping": True, "maximumFractionDigits": 0},
        "labelFormat": {"name": "label", "prefix": False, "style": "decimal", "useGrouping": True, "maximumFractionDigits": 0},
        "chartConfig": {"type": "chart", "columns": columns, "series": [{"type": kind, "x": field, "y": out, "name": title}]},
        "datasets": [
            {
                "type": "serviceDataset",
                "name": "main",
                "dataSource": COLLAR,
                "groupByFields": [field],
                "orderByFields": [order or f"{field} ASC"],
                "statisticDefinitions": [{"onStatisticField": on, "statisticType": stat, "outStatisticFieldName": out}],
                "maxFeatures": 1000,
                "outFields": ["*"],
            }
        ],
    }
    if field == "start_year":
        w["datasets"][0]["filter"] = HAS_YEAR
    return w


def _timeline() -> list[dict]:
    return [
        _chart("emc-year-depth", "Жилээр өрөмдсөн гүн, м", "start_year", "sum", "SUM_DEPTH", "DEPTH"),
        _chart("emc-year-count", "Жилээр өрөмдсөн цооног", "start_year", "count", "COUNT_OBJECTID", "OBJECTID"),
        _chart("emc-year-avg", "Цооногийн дундаж гүн, м", "start_year", "avg", "AVG_DEPTH", "DEPTH", kind="lineSeries"),
    ]


def _purpose_labels(w: dict) -> dict:
    # Хоосон зориулалтыг ArcGIS dashboard-д EXP гэж нэрлэсэн
    w["category"] = {"labelOverrides": [], "nullLabel": "EXP", "blankLabel": "blank"}
    w["chartConfig"]["nullIsValue"] = True
    return w


def _filter_action(widget: dict) -> dict | None:
    for ev in widget.get("events") or []:
        for action in ev.get("actions") or []:
            if action.get("type") == "filter" or any(t.get("by") == "whereClause" for t in action.get("targets") or []):
                return action
    return None


def _target(widget_id: str, field_map: list | None = None) -> dict:
    t = {"targetId": f"{widget_id}#main", "by": "whereClause", "requiresSelection": False}
    if field_map:
        t["fieldMap"] = field_map
    return t


def _exploration(dash: dict) -> None:
    timeline = _timeline()
    purpose = _purpose_labels(_chart("emc-purpose", "Зориулалтаар, цооног", "SITE_PURPOSE", "count", "COUNT_OBJECTID", "OBJECTID", columns=False, order="COUNT_OBJECTID DESC"))
    purpose["actionMode"] = "multiSelection"
    new_ids = [w["id"] for w in timeline] + [purpose["id"]]
    # Зориулалтын багана дээр дарахад COLLAR-ын график, газрын зураг шүүгдэнэ
    purpose["events"] = [
        {
            "type": "selectionChanged",
            "actions": [
                {
                    "type": "filter",
                    "targets": [
                        {"targetId": f"{MAP}#{COLLAR['layerId']}", "by": "whereClause", "requiresSelection": False},
                        _target(COLLAR_KPI),
                        *[_target(w["id"]) for w in timeline],
                    ],
                }
            ],
        }
    ]
    by_prefix = {w["id"][:8]: w for w in dash["widgets"]}
    selectors = {s["id"][:8]: s for s in (dash.get("header") or {}).get("selectors") or []}
    pies = [("COLLAR", "8e69183f"), ("SURVEY", "6ca68b74"), ("LITHOLOGY", "f8109b56"), ("ASSAY", "77695767"), ("ASSAY_COMP", "b80da3f4")]
    mix = {
        "id": "emc-project-mix",
        "type": "projectMixWidget",
        "topCaption": _caption("Мэдээллийн бүтэц, төслөөр"),
        "colors": MIX_COLORS,
        "otherColor": MIX_OTHER,
        "sources": [{"label": label, "widget": {k: by_prefix[p][k] for k in ("id", "type", "datasets")}} for label, p in pies],
    }

    # Дээд талын шүүлтүүрүүд шинэ графикт ч үйлчилнэ. Гүний график огнооны шүүлтүүрээс өмнө нь хоцордог байсан
    date_map = [{"sourceName": "filterField", "targetName": "ENDDATE"}]
    for sel, ids, fmap in (
        (PROJECT_SELECTOR, new_ids, None),
        (PURPOSE_SELECTOR, new_ids, None),
        (DATE_SELECTOR, new_ids + [by_prefix[DEPTH_BAR]["id"]], date_map),
    ):
        action = _filter_action(selectors[sel])
        if action is not None:
            action["targets"] = [*action.get("targets", []), *[_target(i, fmap) for i in ids]]
    # Төслийн багана дээр дарахад он жилийн график ч шүүгдэнэ
    action = _filter_action(by_prefix[DEPTH_BAR])
    if action is not None:
        action["targets"] = [*action.get("targets", []), *[_target(i) for i in new_ids]]
    dash["widgets"] = [*dash["widgets"], *timeline, purpose, mix]


# Судалгааны төрөл: нэг өнгөний түвшнүүд
PURPOSE_SHADES = {None: [52, 208, 174], "INF": [150, 232, 212], "OP": [95, 184, 163], "GEOMET": [199, 240, 229], "GEOTECH": [138, 168, 160], "REC": [214, 224, 220]}


def _holes_table(w: dict) -> None:
    """Цооног бүрийн мэдээлэл хүснэгтээр: гүнээр эрэмбэлсэн"""
    w["type"] = "tableWidget"
    ds = w["datasets"][0]
    ds.pop("statisticDefinitions", None)
    ds["groupByFields"] = []
    ds["orderByFields"] = ["DEPTH DESC"]
    ds["outFields"] = ["HOLEID", "start_year", "DEPTH"]
    ds["maxFeatures"] = 200
    w["columnSettings"] = [
        {"title": "Цооног", "fieldName": "HOLEID"},
        {"title": "Он", "fieldName": "start_year"},
        {"title": "Гүн, м", "fieldName": "DEPTH", "valueFormat": {"style": "decimal", "useGrouping": True, "maximumFractionDigits": 1}},
    ]


def _kpi(base: dict, wid: str, title: str, note: str, stat: str, out: str) -> dict:
    w = copy.deepcopy(base)
    w["id"] = wid
    w["defaultSettings"]["topSection"]["textInfo"]["text"] = title
    w["defaultSettings"]["bottomSection"]["textInfo"]["text"] = note
    w["datasets"][0]["statisticDefinitions"] = [{"onStatisticField": "DEPTH", "statisticType": stat, "outStatisticFieldName": out}]
    w.pop("events", None)
    return w


def _holes(dash: dict) -> None:
    by_prefix = {w["id"][:8]: w for w in dash["widgets"]}
    selectors = {s["id"][:8]: s for s in (dash.get("header") or {}).get("selectors") or []}
    project, purpose = by_prefix["ecb39c84"], by_prefix["8e69183f"]
    project["type"] = "shareListWidget"
    project["topCaption"] = _caption("Өрөмдсөн цооног, төслөөр, ш")
    purpose["topCaption"] = _caption("Судалгааны төрлөөр, цооног")
    for info in purpose["chartConfig"]["chartRenderer"]["uniqueValueInfos"]:
        shade = PURPOSE_SHADES.get(info.get("value"))
        if shade:
            info["symbol"]["color"] = [*shade, 255]
    _holes_table(by_prefix["bf0b1bfe"])
    total = by_prefix["ee661e9e"]
    timeline = _timeline()
    for chart in timeline[:2]:
        chart["chartConfig"]["series"][0]["type"] = "lineSeries"
    timeline[1]["topCaption"] = _caption("Жилээр өрөмдсөн цооног, ш")
    kpis = [_kpi(total, "emc-avg-depth", "ДУНДАЖ ГҮН", "нэг цооногт", "avg", "AVG_DEPTH"), _kpi(total, "emc-max-depth", "ХАМГИЙН ГҮН ЦООНОГ", "дээд утга", "max", "MAX_DEPTH")]
    for w, icon, unit in ((by_prefix["a050a4da"], "holes", "ш"), (total, "depth", "м"), (kpis[0], "average", "м"), (kpis[1], "deepest", "м")):
        w["icon"], w["unit"] = icon, unit
    new_ids = [w["id"] for w in [*timeline, *kpis]]
    date_map = [{"sourceName": "filterField", "targetName": "ENDDATE"}]
    for sel, fmap in ((YEAR_SELECTOR, None), (PROJECT_SELECTOR, None), (PURPOSE_SELECTOR, None), (DATE_SELECTOR, date_map)):
        action = _filter_action(selectors[sel])
        if action is not None:
            action["targets"] = [*action.get("targets", []), *[_target(i, fmap) for i in new_ids]]
    for chart in (project, purpose, by_prefix["bc4047a9"], by_prefix["bf0b1bfe"]):
        action = _filter_action(chart)
        if action is not None:
            action["targets"] = [*action.get("targets", []), *[_target(i) for i in new_ids]]
    dash["widgets"] = [*dash["widgets"], *timeline, *kpis]


# Нэгдсэн тайлан: цагийн KPI-ууд нэг графикт
HOUR_KPIS = ["9f17eab7", "ac337632", "e68e3a56", "46a2ae6c", "f55b5c0d", "567ea50b", "ceac416d", "bd076c77", "5d4fc133", "6f0a0fd3", "b7fbfbe3", "a4bf9b8b", "3baa00c8", "e128a937", "4be6aa43"]
REPORT_KPIS = {"5e83760b": ("holes", "ш"), "4d409383": ("depth", "м"), "44f86f97": ("sample", "ш"), "f9cbc481": ("hours", "цаг"), "d57ac576": ("worked", "цаг"), "9f368ceb": ("idle", "цаг")}


def _single_bar(w: dict, field: str, title: str) -> None:
    """Голчоор давхарласан олон өнгийн баганыг нэг өнгийн болгоно. Голчийн задаргаа тусдаа картанд"""
    w.pop("splitBy", None)
    ds = w["datasets"][0]
    ds["groupByFields"] = [field]
    ds["orderByFields"] = ["SUM_URUMDSUNM DESC"]
    w["chartConfig"] = {"type": "chart", "series": [{"type": "barSeries", "x": field, "y": "SUM_URUMDSUNM", "name": title}]}
    w["topCaption"] = _caption(title)


def _interval_summary(interval: dict) -> None:
    """Мөр бүрийг татвал хязгаарт цөөн цооног багтдаг. Цооног, голч бүрийн эхлэх, дуусах гүнг нэгтгэж бүх цооногийг авна"""
    ds = interval["datasets"][0]
    ds["filter"] = {"type": "filterRule", "field": {"name": "tsoonogiindugaar2", "type": "string"}, "operator": "is_not_null"}
    ds["groupByFields"] = ["tsoonogiindugaar2", "coresize"]
    ds["orderByFields"] = []
    ds["statisticDefinitions"] = [
        {"onStatisticField": "ehleh", "statisticType": "min", "outStatisticFieldName": "min_ehleh"},
        {"onStatisticField": "duusah", "statisticType": "max", "outStatisticFieldName": "max_duusah"},
    ]
    for series in interval["chartConfig"]["series"]:
        series["y"] = {"ehleh": "min_ehleh", "duusah": "max_duusah"}.get(series.get("y"), series.get("y"))
    interval["chartConfig"]["alignBars"] = True
    interval["topCaption"] = _caption("Интервал, цооногоор, м")


def _drill_report(dash: dict) -> None:
    by_prefix = {w["id"][:8]: w for w in dash["widgets"]}
    selectors = {s["id"][:8]: s for s in (dash.get("header") or {}).get("selectors") or []}
    for key, (icon, unit) in REPORT_KPIS.items():
        w = by_prefix[key]
        w["icon"], w["unit"] = icon, unit
        w["defaultSettings"].setdefault("bottomSection", {}).setdefault("textInfo", {})["text"] = ""
    by_prefix["d57ac576"]["defaultSettings"]["topSection"]["textInfo"]["text"] = "Машин ажилласан"
    by_prefix["9f368ceb"]["defaultSettings"]["topSection"]["textInfo"]["text"] = "Машин ажиллаагүй"

    stats, labels = [], []
    for key in HOUR_KPIS:
        w = by_prefix[key]
        stat = w["datasets"][0]["statisticDefinitions"][0]
        stats.append(stat)
        labels.append({"key": stat["onStatisticField"], "label": w["defaultSettings"]["topSection"]["textInfo"]["text"]})
    hours = {
        "id": "emc-hours",
        "type": "shareListWidget",
        "topCaption": _caption("Өрөмдлөгт зарцуулсан хугацаа, цаг"),
        "categoryType": "fields",
        "category": {"labelOverrides": labels, "nullLabel": "null", "blankLabel": "blank"},
        "valueFormat": {"name": "value", "prefix": False, "style": "decimal", "useGrouping": True, "maximumFractionDigits": 1},
        "datasets": [{**copy.deepcopy(by_prefix[HOUR_KPIS[0]]["datasets"][0]), "statisticDefinitions": stats, "groupByFields": [], "orderByFields": []}],
    }

    metres = by_prefix["6676cfad"]
    core = {
        "id": "emc-core",
        "type": "shareListWidget",
        "topCaption": _caption("Өрөмдсөн метр, голчоор, м"),
        "maxItems": 5,
        "valueFormat": {"name": "value", "prefix": False, "style": "decimal", "useGrouping": True, "maximumFractionDigits": 1},
        "datasets": [{**copy.deepcopy(metres["datasets"][0]), "groupByFields": ["coresize"], "orderByFields": []}],
        "events": copy.deepcopy([e for e in selectors["443cda5b"].get("events") or [] if e.get("type") == "selectionChanged"]),
    }
    # ArcGIS-ийн голчийн шүүлтүүр бүртгэл, интервалд хүрдэггүй; карт дээр дарахад хоёуланд нь үйлчилнэ
    core_filter = _filter_action(core)
    if core_filter is not None:
        core_filter["targets"] = [*core_filter.get("targets", []), _target(by_prefix["10e504ff"]["id"]), _target(by_prefix["ffbaba56"]["id"])]
    _single_bar(metres, "tsoonogiindugaar2", "Өрөмдсөн метр, цооногоор, м")
    _single_bar(by_prefix["5b2e3191"], "urumdugchinterval", "Өрөмдөгчийн өрөмдсөн гүн, м")

    # Цооногийн дугааргүй мөрүүд дараалалд эхэлж, 1000 мөрийн хязгаарт зөвхөн эхний цооногууд багтдаг байсан.
    # Хамгийн сүүлийн бүртгэлээс эхэлнэ
    has_hole = {"type": "filterRule", "field": {"name": "tsoonogiindugaar2", "type": "string"}, "operator": "is_not_null"}
    ds = by_prefix["10e504ff"]["datasets"][0]
    ds["filter"] = has_hole
    ds["orderByFields"] = ["CreationDate DESC", "tsoonogiindugaar2 ASC", "ehleh ASC"]

    _interval_summary(by_prefix["ffbaba56"])

    # Бүртгэлийн жагсаалт хүснэгтээр
    log = by_prefix["10e504ff"]
    log["type"] = "tableWidget"
    log["topCaption"] = _caption("Өрөмдлөгийн бүртгэл")
    log["columnSettings"] = [
        {"title": "Цооног", "fieldName": "tsoonogiindugaar2"},
        {"title": "Өрөмдөгч", "fieldName": "urumdugchinterval"},
        {"title": "Голч", "fieldName": "coresize"},
        {"title": "Эхлэх", "fieldName": "ehleh"},
        {"title": "Дуусах", "fieldName": "duusah"},
        {"title": "Метр", "fieldName": "urumdsunm"},
        {"title": "Дээж", "fieldName": "awsandeej"},
        {"title": "Огноо", "fieldName": "CreationDate"},
    ]

    dash["widgets"] = [*dash["widgets"], hours, core]
    # Шүүлтүүр: цагийн KPI-д очдог бүх холбоос шинэ графикт, голчоор давхарласан графикт очдог нь голчийн картад
    follow = {HOUR_KPIS[0]: "emc-hours", "6676cfad": "emc-core"}
    for w in [*dash["widgets"], *selectors.values()]:
        for ev in w.get("events") or []:
            for action in ev.get("actions") or []:
                for t in list(action.get("targets") or []):
                    new = follow.get(t.get("targetId", "")[:8])
                    if new and t.get("by") == "whereClause":
                        action["targets"].append({**t, "targetId": f"{new}#main"})


# Өрмийн машин: {key: (дүрс, нэгж, гарчиг)}
MACHINE_KPIS = {
    "558940df": ("records", "ш", "Бүртгэгдсэн мэдээ"),
    "073f2e80": ("holes", "ш", "Цооногийн тоо"),
    "422a6c0b": ("depth", "м", "Цооногийн гүн"),
    "0beea1cc": ("hours", "цаг", "Ажлын нийт цаг"),
    "ebc4fb58": ("gauge", "", "Ашиглалтын коэффициент"),
}
# Хүснэгтийн богино нэр: {талбар: нэр}. Нэгж нь картын гарчигт
MACHINE_TITLES = {
    "mashiniidugaar": "Машин",
    "SUM_URMIINSUMURGUJBUULGAH": "Сум өргөж буулгах",
    "SUM_YANDAN": "Яндан суулгах, сугалах",
    "SUM_TSOONOGIINHANAURGUSGUH": "Хана өргөсгөх",
    "SUM_TEXNOSOLHUNDRELARILGAH": "Осол, хүндрэл арилгах",
    "SUM_URUMDUHTSEGDEERBAIRLUULAH": "Цэг дээр байрлуулах",
    "SUM_URMIINMASHINNIITTSAG": "Ажилласан нийт",
    "SUM_TEXNIKIINEWDREL": "Эвдрэл, засвар",
    "SUM_SULZOGSOLT": "Сул зогсолт",
    "SUM_URMIINMASHINAJILLAAGUINIITTSAG": "Ажиллаагүй нийт",
    "SUM_URMIINMASHINDAWSANDT": "Машинд",
    "SUM_TSAHILGAANUUSGUURTAWSANDT": "Цахилгаан үүсгүүрт",
    "SUM_HALAAGUURTAWSANDT": "Халаагуурт",
}


def _drill_machines(dash: dict) -> None:
    by_prefix = {w["id"][:8]: w for w in dash["widgets"]}
    for key, (icon, unit, title) in MACHINE_KPIS.items():
        w = by_prefix[key]
        w["icon"], w["unit"] = icon, unit
        settings = w["defaultSettings"]
        settings["topSection"]["textInfo"]["text"] = title
        settings.setdefault("bottomSection", {}).setdefault("textInfo", {})["text"] = ""
    for key, title in (("72dc8043", "Машины ажилласан цаг"), ("fc1f9ef4", "Машины ажиллаагүй цаг"), ("42b74b98", "Шатахуун зарцуулалт, ДТ")):
        w = by_prefix[key]
        w["topCaption"] = _caption(title)
        # Гурван хүснэгтэд машин ижил дарааллаар
        w["datasets"][0]["orderByFields"] = ["mashiniidugaar ASC"]
        for col in w.get("columnSettings") or []:
            name = MACHINE_TITLES.get(col.get("outStatisticFieldName") or col.get("fieldName"))
            if name:
                col["title"] = name
    # Голч солигдож орсон цооногт хамгийн бага, их гүн нь давхцдаг тул өрөмдсөн метрээр залгаж зурна
    interval = by_prefix["944e2dd2"]
    _interval_summary(interval)
    interval["datasets"][0]["statisticDefinitions"].append({"onStatisticField": "urumdsunm", "statisticType": "sum", "outStatisticFieldName": "sum_metr"})
    interval["chartConfig"].update({"stackRuns": "sum_metr", "maxRows": 20})
    interval["topCaption"] = _caption("Өрөмдсөн метр, цооногоор, голчоор")

    worked_table, idle_table, fuel_table = by_prefix["72dc8043"], by_prefix["fc1f9ef4"], by_prefix["42b74b98"]
    worked_total, idle_total = "SUM_URMIINMASHINNIITTSAG", "SUM_URMIINMASHINAJILLAAGUINIITTSAG"

    def stat_of(table: dict, out: str) -> dict:
        return next(s for s in table["datasets"][0]["statisticDefinitions"] if s["outStatisticFieldName"] == out)

    def by_machine(wid: str, title: str, parts: list) -> dict:
        ds = copy.deepcopy(worked_table["datasets"][0])
        ds["statisticDefinitions"] = [stat for _, _, _, stat in parts]
        return {
            "id": wid,
            "type": "serialChartWidget",
            "topCaption": _caption(title),
            "categoryType": "groupByValues",
            "category": {"labelOverrides": [], "nullLabel": "null", "blankLabel": "blank"},
            "valueFormat": {"name": "value", "prefix": False, "style": "decimal", "useGrouping": True, "maximumFractionDigits": 1},
            "chartConfig": {"type": "chart", "stackedType": "stacked", "hideZero": True, "series": [{"type": "barSeries", "x": "mashiniidugaar", "y": y, "name": name, "color": color} for y, name, color, _ in parts]},
            "datasets": [ds],
        }

    def by_activity(wid: str, title: str, table: dict, total: str) -> dict:
        cols = [c for c in table["columnSettings"] if c.get("outStatisticFieldName") not in (None, total)]
        stats = [stat_of(table, c["outStatisticFieldName"]) for c in cols]
        ds = copy.deepcopy(table["datasets"][0])
        ds.update({"groupByFields": [], "orderByFields": [], "statisticDefinitions": stats})
        return {
            "id": wid,
            "type": "shareListWidget",
            "topCaption": _caption(title),
            "leadRow": True,
            "categoryType": "fields",
            "category": {"labelOverrides": [{"key": s["onStatisticField"], "label": c["title"]} for s, c in zip(stats, cols)], "nullLabel": "null", "blankLabel": "blank"},
            "valueFormat": {"name": "value", "prefix": False, "style": "decimal", "useGrouping": True, "maximumFractionDigits": 1},
            "datasets": [ds],
        }

    hours = by_machine("emc-machine-hours", "Машины цаг", [
        (worked_total, "Ажилласан", "#34d0ae", copy.deepcopy(stat_of(worked_table, worked_total))),
        (idle_total, "Ажиллаагүй", "#7d8f8a", copy.deepcopy(stat_of(idle_table, idle_total))),
    ])
    fuel = by_machine("emc-machine-fuel", "Шатахуун, машинаар, ДТ", [
        (y, name, color, copy.deepcopy(stat_of(fuel_table, y)))
        for y, name, color in (("SUM_URMIINMASHINDAWSANDT", "Машинд", "#34d0ae"), ("SUM_TSAHILGAANUUSGUURTAWSANDT", "Үүсгүүрт", "#a8e6d6"), ("SUM_HALAAGUURTAWSANDT", "Халаагуурт", "#7d8f8a"))
    ])
    worked = by_activity("emc-worked", "Ажилласан цаг, ажлаар", worked_table, worked_total)
    idle = by_activity("emc-idle", "Ажиллаагүй цаг, шалтгаанаар", idle_table, idle_total)
    dash["widgets"] = [*dash["widgets"], hours, fuel, worked, idle]

    # Хүснэгтэд очдог шүүлтүүр бүр шинэ графикт ч очно
    selectors = {s["id"][:8]: s for s in (dash.get("header") or {}).get("selectors") or []}
    follow = {"72dc8043": ["emc-machine-hours", "emc-worked", "emc-idle"], "42b74b98": ["emc-machine-fuel"]}
    for w in [*selectors.values(), by_prefix["944e2dd2"]]:
        for ev in w.get("events") or []:
            for action in ev.get("actions") or []:
                for t in list(action.get("targets") or []):
                    if t.get("by") == "whereClause":
                        action["targets"].extend({**t, "targetId": f"{new}#main"} for new in follow.get(t.get("targetId", "")[:8], []))
    # Машины багана дээр дарахад машины шүүлтүүртэй адил
    machine_filter = _filter_action(selectors["0a707f5f"])
    for chart in (hours, fuel):
        chart["events"] = [{"type": "selectionChanged", "actions": [copy.deepcopy(machine_filter)]}]


def _has_value(field: str) -> dict:
    """Хоосон, null утгатай мөрийг хасна"""
    rule = {"type": "filterRule", "field": {"name": field, "type": "string"}}
    return {"type": "filterGroup", "condition": "AND", "rules": [{**rule, "operator": "is_not_null"}, {**rule, "operator": "not_equal", "constraint": {"value": ""}}]}


def _hole_report(dash: dict) -> None:
    by_prefix = {w["id"][:8]: w for w in dash["widgets"]}
    selectors = {s["id"][:8]: s for s in (dash.get("header") or {}).get("selectors") or []}
    for key, icon, unit in (("6f64f3a9", "holes", "ш"), ("eab8521e", "depth", "м"), ("956ba02d", "sample", "ш")):
        w = by_prefix[key]
        w["icon"], w["unit"] = icon, unit
        w["defaultSettings"].setdefault("bottomSection", {}).setdefault("textInfo", {})["text"] = ""

    fmt = {"name": "value", "prefix": False, "style": "decimal", "useGrouping": True, "maximumFractionDigits": 1}
    metres = by_prefix["cc693ff9"]
    hole_ds = metres["datasets"][0]

    def share(wid: str, field: str, title: str) -> dict:
        ds = copy.deepcopy(hole_ds)
        ds["groupByFields"] = [field]
        ds["orderByFields"] = []
        return {
            "id": wid,
            "type": "pieChartWidget",
            "topCaption": _caption(title),
            "categoryType": "groupByValues",
            "category": {"labelOverrides": [], "nullLabel": "null", "blankLabel": "blank"},
            "monoShades": True,
            "maxItems": 5,
            "valueFormat": fmt,
            "chartConfig": {"type": "chart", "series": [{"type": "pieSeries", "x": field, "y": "SUM_URUMDSUNM", "name": title}]},
            "datasets": [ds],
        }

    core = share("emc-core", "coresize", "Өрөмдсөн метр, голчоор, м")
    core["events"] = copy.deepcopy([e for e in selectors["347571de"].get("events") or [] if e.get("type") == "selectionChanged"])
    fluid = share("d75b428d-e181-4ee3-bbec-9fae62fac285", "drillfluid", "Өрмийн шингэн, м")
    water = share("f18d9bb3-99e0-4e16-8a3a-bbb13fe9a5cd", "usaldalt", "Ус алдалт, м")

    # Өрмийн машинтай ижил: цооног бүрийн метр голчоор, нэг ногооны түвшнээр, давхцалгүй
    metres.pop("splitBy", None)
    metres["categoryType"] = "features"
    metres["chartConfig"] = {
        "type": "chart",
        "series": [
            {"type": "lineSeries", "id": "ehleh", "x": "tsoonogiindugaar2", "y": "ehleh", "name": "Эхлэх гүн"},
            {"type": "barSeries", "id": "duusah", "x": "tsoonogiindugaar2", "y": "duusah", "name": "Дуусах гүн"},
        ],
    }
    _interval_summary(metres)
    hole_ds["filter"] = _has_value("tsoonogiindugaar2")
    hole_ds["statisticDefinitions"].append({"onStatisticField": "urumdsunm", "statisticType": "sum", "outStatisticFieldName": "sum_metr"})
    metres["chartConfig"].update({"stackRuns": "sum_metr", "maxRows": 20})
    metres["topCaption"] = _caption("Өрөмдсөн метр, цооногоор, голчоор")

    # Цооногийн дугааргүй мөрийг хүснэгт, дэлгэрэнгүйгээс хасна. Дэлгэрэнгүй хоосон мөрийг харуулдаг байсан
    table = by_prefix["63e8a5f3"]
    table["topCaption"] = _caption("Цооногийн өнцөг")
    table["datasets"][0]["filter"] = _has_value("tsoonogiindugaar")
    table["datasets"][0]["orderByFields"] = ["tsoonogiindugaar ASC"]
    titles = {"tsoonogiindugaar": "Цооног", "AVG_TSONOGIINNALUUGIINUNTSUG": "Налуу, °", "AVG_TSONOGIINAZIMUTIINUNTSUG": "Азимут, °"}
    for col in table["columnSettings"]:
        col["title"] = titles.get(col.get("outStatisticFieldName") or col.get("fieldName"), col.get("title"))
    by_prefix["d4da632e"]["datasets"][0]["filter"] = _has_value("tsoonogiindugaar")

    # Интервалын давхаргаас нэмсэн 2 KPI
    def run_kpi(wid: str, title: str, icon: str, stat: dict) -> dict:
        w = copy.deepcopy(by_prefix["eab8521e"])
        w["id"], w["icon"], w["unit"] = wid, icon, "м"
        w["defaultSettings"]["topSection"]["textInfo"]["text"] = title
        w["datasets"][0]["statisticDefinitions"] = [stat]
        w.pop("events", None)
        return w

    deepest = run_kpi("emc-deepest", "Хамгийн гүн", "deepest", {"onStatisticField": "duusah", "statisticType": "max", "outStatisticFieldName": "MAX_DUUSAH"})
    avg_run = run_kpi("emc-avg-run", "Дундаж интервал", "average", {"onStatisticField": "urumdsunm", "statisticType": "avg", "outStatisticFieldName": "AVG_URUMDSUNM"})

    dash["widgets"] = [w for w in dash["widgets"] if w["id"] not in (fluid["id"], water["id"])] + [core, fluid, water, deepest, avg_run]
    # Шингэний картанд очдог шүүлтүүр голчийн картанд, урт KPI-д очдог нь шинэ KPI-д очно
    follow = {"d75b428d": ["emc-core"], "eab8521e": ["emc-deepest", "emc-avg-run"]}
    for w in [*selectors.values(), metres, core]:
        for ev in w.get("events") or []:
            for action in ev.get("actions") or []:
                for t in list(action.get("targets") or []):
                    if t.get("by") == "whereClause":
                        action["targets"].extend({**t, "targetId": f"{new}#main"} for new in follow.get(t.get("targetId", "")[:8], []))
    # Шингэн, ус алдалт нь зөвхөн интервалын давхаргад байдаг тул тэр давхаргын widget-үүдийг л шүүнэ
    layer5 = [by_prefix["eab8521e"]["id"], by_prefix["956ba02d"]["id"], metres["id"], core["id"], fluid["id"], water["id"], deepest["id"], avg_run["id"]]
    for w in (fluid, water):
        w["events"] = [{"type": "selectionChanged", "actions": [{"type": "filter", "targets": [_target(i) for i in layer5 if i != w["id"]]}]}]
    action = _filter_action(core)
    if action is not None:
        action["targets"] = [*action.get("targets", []), _target(fluid["id"]), _target(water["id"])]
        seen = set()
        action["targets"] = [t for t in action["targets"] if not (t["targetId"] in seen or seen.add(t["targetId"]))]


# Овоолго: хувийг нэмж болохгүй — агуулга = металл ÷ хүдэр. Хүдэр мян.тн, металл тн тул 100 / 1000
GRADE_FACTOR = 0.1
ORE, CU, MO = "Хүдэр", "Зэс__м", "Moлиб_1"
DUMP_NUMBERS = ["1", "2", "2б", "3", "4", "4а", "5", "8", "8а", "9", "9а", "9б", "10a", "11", "12", "14"]


ACCENT_GREEN = "#34d0ae"


def _sum(field: str, out: str) -> dict:
    return {"onStatisticField": field, "statisticType": "sum", "outStatisticFieldName": out}


def _dumps(dash: dict) -> None:
    by_prefix = {w["id"][:8]: w for w in dash["widgets"]}
    selectors = {s["id"][:8]: s for s in (dash.get("header") or {}).get("selectors") or []}
    has_year = {"type": "filterRule", "field": {"name": "Он", "type": "integer"}, "operator": "greater", "constraint": {"value": 0}}

    for key, icon, unit, title in (("fbfe6078", "ore", "мян.тн", "Хүдэр"), ("3eb594e8", "rock", "мян.м³", "Уулын цул"), ("6fdabc3b", "metal", "тн", "Зэс"), ("8f361ba3", "metal", "тн", "Молибден")):
        w = by_prefix[key]
        w["icon"], w["unit"] = icon, unit
        w["defaultSettings"]["topSection"]["textInfo"]["text"] = title
        w["defaultSettings"].setdefault("bottomSection", {}).setdefault("textInfo", {})["text"] = ""
        w["valueFormat"] = {**w.get("valueFormat", {}), "maximumFractionDigits": 0}
    grade = copy.deepcopy(by_prefix["fbfe6078"])
    grade.update({"id": "emc-grade", "icon": "grade", "unit": "%", "valueFormat": {**grade["valueFormat"], "maximumFractionDigits": 3}})
    grade["defaultSettings"]["topSection"]["textInfo"]["text"] = "Зэсийн дундаж агуулга"
    grade["datasets"][0]["statisticDefinitions"] = [_sum(CU, "sum_cu"), _sum(ORE, "sum_ore")]
    grade["chartConfig"] = {"ratio": {"key": "grade", "num": "sum_cu", "den": "sum_ore", "factor": GRADE_FACTOR}}

    def ratio_chart(w: dict, num: str) -> None:
        """Нийлбэр хувийн оронд металл ÷ хүдэр"""
        w["datasets"][0]["statisticDefinitions"] = [_sum(num, "sum_metal"), _sum(ORE, "sum_ore")]
        w["chartConfig"]["ratio"] = {"key": "grade", "num": "sum_metal", "den": "sum_ore", "factor": GRADE_FACTOR}
        w["chartConfig"]["series"] = [{**w["chartConfig"]["series"][0], "y": "grade"}]

    # Жилээр: шугам, он нь бөглөгдсөн мөр
    for key, title in (("3fcfbcd6", "Хүдэр, жилээр, мян.тн"), ("01f7e790", "Уулын цул, жилээр, мян.м³"), ("7d13cde8", "Зэс, жилээр, метал.тн"), ("284557d7", "Молибден, жилээр, метал.тн"), ("893c69c9", "Зэсийн агуулга, жилээр, %"), ("b5efb4c7", "Молибдений агуулга, жилээр, %")):
        w = by_prefix[key]
        w["topCaption"] = _caption(title)
        w["datasets"][0]["filter"] = has_year
    ratio_chart(by_prefix["893c69c9"], CU)
    ratio_chart(by_prefix["b5efb4c7"], MO)

    # Овоолгоор: 18 өнгөтэй цувааны оронд нэг өнгийн эрэмбэ
    def by_dump(key: str, title: str) -> dict:
        w = by_prefix[key]
        w.pop("splitBy", None)
        ds = w["datasets"][0]
        out = ds["statisticDefinitions"][0]["outStatisticFieldName"]
        ds["groupByFields"] = ["dugaar"]
        ds["orderByFields"] = []
        ds["filter"] = _has_value("dugaar")
        # Жилийн хэсэгтэй ижил гөлгөр шугам
        w["chartConfig"] = {"type": "chart", "hideZero": True, "series": [{"type": "lineSeries", "id": "main", "x": "dugaar", "y": out, "name": title}]}
        # Гарчигт «овоолгоор» гэж байгаа тул багананд дугаар нь л
        w["category"] = {"labelOverrides": [{"key": f"Овоолго {n}", "label": n} for n in DUMP_NUMBERS], "nullLabel": "null", "blankLabel": "blank"}
        w["topCaption"] = _caption(title)
        return w

    ore = by_dump("1a493355", "Хүдэр, овоолгоор, мян.тн")
    by_dump("14e85342", "Зэс, овоолгоор, метал.тн")
    by_dump("76d5e9f7", "Молибден, овоолгоор, метал.тн")
    by_dump("0d491ab5", "Уулын цул, овоолгоор, мян.м³")
    ratio_chart(by_dump("d2647d0e", "Зэсийн агуулга, овоолгоор, %"), CU)
    ratio_chart(by_dump("c69c5185", "Молибдений агуулга, овоолгоор, %"), MO)
    for key, digits in (("893c69c9", 3), ("b5efb4c7", 4), ("d2647d0e", 3), ("c69c5185", 4)):
        w = by_prefix[key]
        for fmt in ("valueFormat", "labelFormat"):
            w[fmt] = {**w.get(fmt, {}), "maximumFractionDigits": digits}

    dash["widgets"] = [*dash["widgets"], grade]
    # Хүдрийн KPI-д очдог шүүлтүүр агуулгын KPI-д ч очно. Оны сонголт донатад хүрдэггүй байсан
    for w in [*dash["widgets"], *selectors.values()]:
        for ev in w.get("events") or []:
            for action in ev.get("actions") or []:
                for t in list(action.get("targets") or []):
                    if t.get("by") == "whereClause" and t.get("targetId", "").startswith("fbfe6078"):
                        action["targets"].append({**t, "targetId": "emc-grade#main"})
    action = _filter_action(selectors["5c4a9126"])
    if action is not None:
        action["targets"] = [*action.get("targets", []), _target(ore["id"])]


def _reserves(dash: dict) -> None:
    by_prefix = {w["id"][:8]: w for w in dash["widgets"]}
    # Жил дарааллаараа. Заагаагүй бол график утгаар нь эрэмбэлж авдаг
    for key in ("55ee5abb", "ae7bcd1d", "6e4f197b", "4a743254", "6522f767"):
        by_prefix[key]["datasets"][0]["orderByFields"] = ["Ашиглалтын_жил ASC"]
    stage = by_prefix["1dd6139d"]
    stage["topCaption"] = _caption("Хүдрийн хөдөлгөөн, нөөцийн үеэр, мян.тн")
    stage["chartConfig"]["stagedSplit"] = True


def _history(dash: dict) -> None:
    by_prefix = {w["id"][:8]: w for w in dash["widgets"]}
    selectors = (dash.get("header") or {}).get("selectors") or []
    year = "Ашиглалтын_жил"
    ore, cu, mo = "Хүдрийн_хэмжээ__мян_тн__Ил_уурх", "Зэс_Металлийн_хэжмээ__тн_2", "Молиб__Металлийн_хэжмээ__тн_2"

    for key, icon, unit, title in (
        ("3f725eb6", "ore", "мян.тн", "Боловсруулсан хүдэр"),
        ("c37f3f43", "ore", "мян.тн", "Ядуу агуулгатай хүдэр"),
        ("77693e8e", "ore", "мян.тн", "Исэлдсэн хүдэр"),
        ("7144f370", "rock", "мян.м³", "Хоосон чулуулаг"),
        ("424d1427", "grade", "%", "Зэсийн дундаж агуулга"),
        ("e2514c9c", "grade", "%", "Молибдений дундаж агуулга"),
    ):
        w = by_prefix[key]
        w["icon"], w["unit"] = icon, unit
        w["defaultSettings"]["topSection"]["textInfo"]["text"] = title
        w["valueFormat"] = {**w.get("valueFormat", {}), "maximumFractionDigits": 0}
    # Жилүүдийн энгийн дундаж биш: нийт металл ÷ нийт хүдэр
    for key, metal, digits in (("424d1427", cu, 3), ("e2514c9c", mo, 4)):
        w = by_prefix[key]
        w["datasets"][0]["statisticDefinitions"] = [_sum(metal, "sum_metal"), _sum(ore, "sum_ore")]
        w["chartConfig"] = {"ratio": {"key": "grade", "num": "sum_metal", "den": "sum_ore", "factor": GRADE_FACTOR}}
        w["valueFormat"] = {**w["valueFormat"], "maximumFractionDigits": digits}

    def series(kind: str, pairs: list, color: str | None = None) -> list:
        return [{"type": kind, "id": y, "x": year, "y": y, "name": name, **({"color": color} if color else {})} for y, name in pairs]

    def chart(w: dict, title: str, parts: list, **config) -> dict:
        w["topCaption"] = _caption(title)
        w["chartConfig"] = {"type": "chart", "series": parts, **config}
        # Жил дарааллаараа. Заагаагүй бол утгаар нь эрэмбэлж авдаг
        w["datasets"][0]["orderByFields"] = [f"{year} ASC"]
        return w

    chart(by_prefix["9644c9c8"], "Хүдэр олборлолт, материалын төрлөөр, мян.тн", series("barSeries", [(ore, "Баяжуулах үйлдвэрт өгсөн"), ("Хүдрийн_хэмжээ__мян_тн__Исэлдсэ", "Исэлдсэн хүдэр")]), columns=True, stackedType="stacked")
    rock_parts = [("Хүдэр_боловсруулалт__м3", "Хүдэр боловсруулалт"), ("Исэлдсэн_хүдэр_олборлолт__м3", "Исэлдсэн хүдэр"), ("Ядуу_агуулгатай_хүдэр_олборлолт", "Ядуу агуулгатай хүдэр"), ("Хоосон_чулуулаг__мян_м3", "Хоосон чулуулаг")]
    # Сүүлийн жилүүдэд задаргаа бөглөгдөөгүй: зохиохгүй, нийт дүнгээс үлдсэнийг тусад нь
    chart(
        by_prefix["fefc5c9a"],
        "Нийт уулын цул гаргалт, мян.м³",
        [*series("barSeries", rock_parts), {"type": "barSeries", "id": "emc_rest", "x": year, "y": "emc_rest", "name": "Задаргаагүй", "color": "#7d8f8a"}],
        columns=True,
        stackedType="stacked",
        remainder={"key": "emc_rest", "total": "Нийт_уулын_цул_гаргалт___сая_м3", "parts": [y for y, _ in rock_parts]},
    )
    chart(by_prefix["5a3bd0ea"], "Уулын ажлын мэдээлэл, жилээр", series("lineSeries", [("Хүдрийн_хэмжээ__мян_тн__нийт__1", "Нийт хүдэр, мян.тн"), ("Хүдрийн_хэмжээ__мян_тн__Исэлдсэ", "Исэлдсэн хүдэр, мян.тн"), ("Хүдрийн_хэмжээ__мян_тн__Ядуу_аг", "Ядуу агуулгатай хүдэр, мян.тн"), ("Хоосон_чулуулаг__мян_м3", "Хоосон чулуулаг, мян.м³")]))

    # Молибденийг 20 дахин өсгөж зэстэй нэг тэнхлэгт тавьсан байсан — тус тусдаа, жинхэнэ хувиар
    mo_processed = copy.deepcopy(by_prefix["b69d0859"])
    mo_processed["id"] = "emc-mo-processed"
    for w, title, y, digits in (
        (by_prefix["b69d0859"], "Боловсруулсан хүдрийн зэсийн агуулга, %", "Зэс_Дундаж_агуулга____2", 3),
        (mo_processed, "Боловсруулсан хүдрийн молибдений агуулга, %", "Молиб___Дундаж_агуулга___2", 4),
        (by_prefix["d155ace8"], "Олборлосон хүдрийн зэсийн агуулга, %", "Зэс_Дундаж_агуулга____1", 3),
        (by_prefix["a4f1bcd2"], "Олборлосон хүдрийн молибдений агуулга, %", "Молиб___Дундаж_агуулга____1", 4),
    ):
        chart(w, title, series("lineSeries", [(y, title)], ACCENT_GREEN), **({"valueDigits": 3} if digits == 4 else {}))
        for fmt in ("valueFormat", "labelFormat"):
            w[fmt] = {**w.get(fmt, {}), "maximumFractionDigits": digits}
    donut = by_prefix["7a29fad5"]
    # Задаргаа 2023 он хүртэл л бөглөгдсөн
    donut["topCaption"] = _caption("Олборлолтын бүтэц, мян.м³, 2023 он хүртэл")
    for info in donut["chartConfig"]["chartRenderer"]["uniqueValueInfos"]:
        info["label"] = {"ХҮДЭР БОЛОВСРУУЛАЛТ": "Хүдэр боловсруулалт", "ЯДУУ АГУУЛГАТАЙ ХҮДЭР ОЛБОРЛОЛТ": "Ядуу агуулгатай хүдэр", "ИСЭЛДСЭН ХҮДЭР ОЛБОРЛОЛТ": "Исэлдсэн хүдэр"}.get(info["label"].split(",")[0].strip(), info["label"])

    dash["widgets"] = [*dash["widgets"], mo_processed]
    for w in [*selectors, *dash["widgets"]]:
        for ev in w.get("events") or []:
            for action in ev.get("actions") or []:
                for t in list(action.get("targets") or []):
                    if t.get("by") == "whereClause" and t.get("targetId", "").startswith("b69d0859"):
                        action["targets"].append({**t, "targetId": "emc-mo-processed#main"})


# Хиймэл нуур: сэдэв бүрийн үзүүлэлт. (widget, нэр, нэгж, тэмдэглэгээ). Бусад нь анхны тодорхойлолтоор «сүүлийн жил»
AVG = "дундаж"
LAKE_GROUPS = {
    "emc-lake-area": ("Талбай, нуур", [("b509862c", "Талбай", "га", None), ("7126021e", "Нуурын талбай", "га", AVG), ("bf812e8c", "Далангийн талбай", "га", None), ("ab3370d0", "Элсэн талбай", "га", AVG), ("dc0ab4c5", "Нуурын дундаж гүн", "м", None), ("888c8701", "Дээд далангийн тоо", "ш", None)]),
    "emc-lake-level": ("Түвшин, ус", [("40b69c9f", "Нуурын усны түвшин", "м", None), ("13c55c3b", "Далангийн дээд түвшин", "м", None), ("00747768", "Элсэн талбайн түвшин", "м", None), ("834044e3", "Жилийн өсөлт", "м", AVG), ("b2c11e8a", "Элсэн талбайн өргөн", "м", AVG), ("91b6bfee", "Нуурын усны эзлэхүүн", "сая.м³", AVG)]),
    "emc-lake-waste": ("Хаягдал, хүдэр", [("17ef0496", "Жилд хураагдсан", "сая.м³", None), ("63522ac9", "Нийт хураагдсан", "сая.м³", None), ("11940242", "Хаягдлын сан", "сая.м³", None), ("c2f18650", "Жилд хураагдсан", "сая.тн", None), ("bcaa6785", "Нийт хураагдсан", "сая.тн", None), ("f63dab49", "Жилд боловсруулсан хүдэр", "сая.тн", None)]),
}
# Нэг хэмжигдэхүүнтэй цуваанууд нэг графикт. {id: (гарчиг, [(талбар, нэр)])}
LAKE_CHARTS = {
    "1b53d437": ("Түвшин, м (абс)", [("Нуурын_усны_түвшин__м__абс_", "Нуурын ус"), ("далангийн__ажиллаж_буй__түвшин_", "Далан"), ("Элсэн_талбайн_хамгийн_их_түвшин", "Элсэн талбай")]),
    "emc-lake-depth": ("Гүн, өсөлт, м", [("Нуурын_дундаж_гүн__м_", "Нуурын дундаж гүн"), ("Нуурын_усны_түвшний_жилийн_өсөл", "Түвшний жилийн өсөлт")]),
    "emc-lake-width": ("Элсэн талбайн өргөн, м", [("элсэн_талбайн_жилийн_хамгийн_ба", "Өргөн")]),
    "ff83a85c": ("Талбай, га", [("талбай_га", "Нийт"), ("Нуурталбай", "Нуур"), ("элсэнталбай", "Элсэн"), ("ДалангийнТалбайГа", "Далан")]),
    "ca8917e6": ("Жил бүрийн хаягдал, хүдэр, сая.тн", [("Жилд_хураагдсан_хаягдлын_хэмжээ", "Хаягдал"), ("Жилд_боловсруулсан_хүдэр____сая", "Хүдэр")]),
    "emc-lake-total-t": ("Нийт хураагдсан хаягдал, сая.тн", [("хураагдсан_хаягдлын__хэмжээ__жи", "Нийт хаягдал")]),
    "8d6e988e": ("Хаягдал, сан, сая.м³", [("хураагдсан_хаягдлын__хэмжээ___ж", "Нийт хаягдал"), ("хаягдлын_сангийн_хэмжээ____жил_", "Сан")]),
    "emc-lake-year-m": ("Жил бүрийн хаягдал, ус, сая.м³", [("Жилд_хураагдсан_хаягдлын_хэмж_1", "Хаягдал"), ("Нуурын_усны_эзлэхүүн_____сая_м3", "Нуурын ус")]),
}
LAKE_SHADES = ["#34d0ae", "#a8e6d6", "#1f8f78", "#d6f5ec"]


def _replace_tabs(el: dict, tab_id: str) -> None:
    """Таб мөрийг хасаж, эхний табын агуулгыг байранд нь үлдээнэ."""
    kids = el.get("elements") or []
    for i, kid in enumerate(kids):
        if kid.get("type") == "tabsLayoutElement" and kid["id"].startswith(tab_id):
            first = {k: v for k, v in kid["elements"][0].items() if k != "tabName"}
            first.update({k: kid[k] for k in ("width", "height") if k in kid})
            kids[i] = first
        else:
            _replace_tabs(kid, tab_id)


def _lake(dash: dict) -> None:
    by_prefix = {w["id"][:8]: w for w in dash["widgets"]}
    # 2D/3D-г зураг өөрөө сэлгэдэг
    _replace_tabs(dash["layout"], "ee143d7d")
    selectors = (dash.get("header") or {}).get("selectors") or []
    groups = []
    for gid, (title, rows) in LAKE_GROUPS.items():
        stats = []
        for key, label, unit, note in rows:
            w = by_prefix[key]
            fmt = {**w.get("valueFormat", {}), "useGrouping": True, "maximumFractionDigits": min(2, w.get("valueFormat", {}).get("maximumFractionDigits", 1))}
            stats.append({"label": label, "unit": unit, "note": note, "widget": {"id": w["id"], "type": w["type"], "datasets": w["datasets"], "valueFormat": fmt}})
        groups.append({"id": gid, "type": "statListWidget", "topCaption": _caption(title), "statRows": stats})
    base = by_prefix["ca8917e6"]
    clones = []
    for wid, (title, parts) in LAKE_CHARTS.items():
        w = by_prefix.get(wid)
        if w is None:
            w = {**copy.deepcopy(base), "id": wid}
            w.pop("events", None)
            clones.append(w)
        w["topCaption"] = _caption(title)
        w["datasets"][0]["orderByFields"] = ["Он ASC"]
        w["chartConfig"] = {"type": "chart", "series": [{"type": "lineSeries", "id": y, "x": "Он", "y": y, "name": name, "color": LAKE_SHADES[i]} for i, (y, name) in enumerate(parts)]}
    dash["widgets"] = [*dash["widgets"], *clones, *groups]
    for w in [*selectors, *dash["widgets"]]:
        for ev in w.get("events") or []:
            for action in ev.get("actions") or []:
                for t in list(action.get("targets") or []):
                    if t.get("by") == "whereClause" and t.get("targetId", "").startswith("ca8917e6"):
                        action["targets"].extend({**t, "targetId": f"{c['id']}#main"} for c in clones)


# Усны балансын оролт: (KPI, график, нэр). График, жагсаалт нэг дарааллаар
WATER_IN_ROWS = [
    ("0433931c", "b90fc27e", "Даланд хаягдаж буй булингийн ус"),
    ("638e405a", "029ea9c3", "Цэвэрлэх байгууламжийн ус"),
    ("c7e1f3ce", "98ac5cc1", "Хур тунадасны ус"),
    ("0bbfe32f", "ff9a9699", "Ил уурхайн шүүрлийн ус"),
    ("fef747fe", "c94e0546", "Зуны гол, Бөхөнгийн хөндийн урсац"),
    ("ae866f8d", "c4ef9358", "ДЦС-ийн хэрэглэсэн ус"),
    ("f24afb9b", "0960473e", "M4 цөөрмөөс татан авсан ус"),
    ("d90f48ba", "cd200f3e", "Элсний нүх сүвээс ялгарах ус"),
]


def _water_rows(dash: dict, rows: list[tuple[str, str, str]], units: dict | None = None, icons: dict | None = None) -> dict:
    by_prefix = {w["id"][:8]: w for w in dash["widgets"]}
    units, icons = units or {}, icons or {}
    for kpi, chart, label in rows:
        w = by_prefix[kpi]
        unit = units.get(kpi, "сая.м³")
        w["icon"], w["iconWide"], w["unit"] = icons.get(kpi, "drop"), True, unit
        w["defaultSettings"]["topSection"]["textInfo"]["text"] = label
        w["defaultSettings"]["middleSection"]["textInfo"]["text"] = "{value}"
        w["defaultSettings"].setdefault("bottomSection", {}).setdefault("textInfo", {})["text"] = ""
        w["valueFormat"] = {**w.get("valueFormat", {}), "useGrouping": True, "maximumFractionDigits": 2}
        by_prefix[chart]["topCaption"] = _caption(f"{label}, {unit}")
    return by_prefix


def _water_in(dash: dict) -> None:
    by_prefix = _water_rows(dash, WATER_IN_ROWS)
    # Утга нь 0.01 орчим: тэнхлэг дээр ялгарахаар
    by_prefix["c94e0546"]["chartConfig"]["valueDigits"] = 3
    # Анхны график «хэрэглэсэн ус» нэртэй ч эргэлтийн усны талбар уншдаг байсан: картын тоотой нэг талбар болгов
    by_prefix["c4ef9358"]["datasets"][0]["statisticDefinitions"][0]["onStatisticField"] = "ДЦС_ийн_хэрэглэсэн_техникийн__у"


# Усны балансын гаралт: (KPI, график, нэр). График, индикатор нэг дарааллаар
WATER_OUT_ROWS = [
    ("0433931c", "b90fc27e", "БҮ-ийн эргэлтийн ус"),
    ("638e405a", "029ea9c3", "Нүх сүвд барьцалдан үлдсэн ус"),
    ("c7e1f3ce", "98ac5cc1", "Шүүрлийн сувагт баригдаагүй алдсан ус"),
    ("0bbfe32f", "ff9a9699", "Элсэн талбай, нуурын ууршилт"),
    ("fef747fe", "0960473e", "Товарын бүтээгдэхүүнд шингэсэн ус"),
    ("ae866f8d", "c4ef9358", "ДЦС-ийн эргэлтийн ус"),
    ("f24afb9b", "c94e0546", "Говьл талд тектоник хагарлаар алдсан ус"),
]


def _water_out(dash: dict) -> None:
    by_prefix = _water_rows(dash, WATER_OUT_ROWS)
    # Утгын зөрүү бага: тэнхлэг дээр ялгарахаар
    for chart in ("0960473e", "c94e0546"):
        by_prefix[chart]["chartConfig"]["valueDigits"] = 3


# Усны балансын ерөнхий мэдээлэл: (KPI, график, нэр, статистик). Нөөц, талбай дундаж, урсгал нь нийт дүн
WATER_GENERAL_ROWS = [
    ("0433931c", "b90fc27e", "Балансын зөрүү", "нийт дүн"),
    ("638e405a", "029ea9c3", "Хаягдлын сангийн нийт ус", "дундаж"),
    ("c7e1f3ce", "c4ef9358", "Нуурнаас авч болох ус", "дундаж"),
    ("0bbfe32f", "ff9a9699", "Нуурнаас авч болохгүй ус", "дундаж"),
    ("fef747fe", "0960473e", "Хүдэр боловсруулалт", "нийт дүн"),
    ("ae866f8d", "98ac5cc1", "БҮ-ийн техникийн ус", "нийт дүн"),
    ("f24afb9b", "c94e0546", "Нуурын талбай", "дундаж"),
]


def _water_general(dash: dict) -> None:
    ore, area = "fef747fe", "f24afb9b"
    by_prefix = _water_rows(dash, [r[:3] for r in WATER_GENERAL_ROWS], {ore: "сая.тн", area: "га"}, {ore: "ore", area: "area"})
    for kpi, _, _, note in WATER_GENERAL_ROWS:
        by_prefix[kpi]["defaultSettings"]["bottomSection"]["textInfo"]["text"] = note
    # 108,267,000 тн картанд багтахгүй: бусадтай адил сая нэгжээр. Графикийн тэнхлэг нь «3.4 сая» гэж тн-оор гарна
    by_prefix[ore]["valueConversion"] = {"factor": 1e-6, "offset": 0}
    by_prefix["0960473e"]["topCaption"] = _caption("Хүдэр боловсруулалт, тн")
    by_prefix[area]["valueFormat"]["maximumFractionDigits"] = 1


# Усны балансын бусад мэдээлэл: (KPI, график, нэр)
WATER_OTHER_ROWS = [
    ("0433931c", "b90fc27e", "Шүүрлийн сувгаас татан авсан ус"),
    ("638e405a", "029ea9c3", "ДЦС-ийн ундны ус"),
    ("c7e1f3ce", "c4ef9358", "ДЦС-ийн эргэлтийн ус"),
    ("0bbfe32f", "ff9a9699", "ДЦС-ийн техникийн ус"),
]


def _water_other(dash: dict) -> None:
    by_prefix = _water_rows(dash, WATER_OTHER_ROWS)
    # Анхны хоёр график хөндлөн эргүүлсэн байсан: бусадтай адил цаг хугацаа хэвтээ тэнхлэгт
    for chart in ("b90fc27e", "029ea9c3"):
        by_prefix[chart]["chartConfig"]["rotated"] = False
    # Ундны усны утга 0.00х: тэнхлэг дээр ялгарахаар
    by_prefix["029ea9c3"]["chartConfig"]["valueDigits"] = 3


# Говил, цооног тус бүрээр: (график, хугацааны нэр)
GOVIL_WELLS = [("b53f0636", "жилээр"), ("71e859e8", "сараар"), ("b69ab7b1", "өдрөөр")]
# Цооног бүрт тогтмол өнгө: шүүсэн ч, аль ч графикт ижил
GOVIL_COLORS = {
    "G--17/01": "#3987e5", "G--17/02": "#d95926", "G--17/03": "#199e70", "G-22/01": "#c98500", "G-22/02": "#d55181",
    "G-24/01": "#5f9e2f", "G-24/02": "#9085e9", "G-24/03": "#e66767", "HM20191006": "#1fa2b4", "HM20191007": "#958f38",
}


def _govil(dash: dict) -> None:
    by_prefix = {w["id"][:8]: w for w in dash["widgets"]}
    # Түвшин 1200 орчим, 0-ээс эхэлсэн баганад ялгаа харагдахгүй: шугаман график утгын мужид шахагдана
    for chart, period in GOVIL_WELLS:
        w = by_prefix[chart]
        for series in w["chartConfig"]["series"]:
            series["type"] = "lineSeries"
        w["splitBy"]["missingSeriesTemplate"]["type"] = "lineSeries"
        w["chartConfig"].update({"splitColors": GOVIL_COLORS, "plainLines": True})
        w["topCaption"] = _caption(f"Усны үнэмлэхүй түвшин, цооногоор, {period}")


# Пьезометр: (нэр, табын товч, цооногоор, жилээр, сараар)
PIEZO_ROWS = [
    ("Усны үнэмлэхүй өндөршил", "Ус", "611374c3", "c844b52d", "77eb690e"),
    ("Цооногийн үнэмлэхүй өндөршил", "Цооног", "62d6c583", "e64a2e7f", "8dd4822c"),
    ("Цооногийн гүн", "Гүн", "4b978d2a", "a9843756", "9c186e05"),
    ("Трубаны өндөр", "Труба", "78e1835a", "74f82f66", "99ac3d8c"),
    ("Газрын гадарга хүртэл түвшин", "Газар", "79643901", "bfa2d945", "ca43e903"),
]


def _tab_labels(node: dict, labels: dict) -> None:
    for child in node.get("elements") or []:
        if child["id"][:8] in labels:
            child["tabLabel"] = labels[child["id"][:8]]
        _tab_labels(child, labels)


def _piezometer(dash: dict) -> None:
    by_prefix = {w["id"][:8]: w for w in dash["widgets"]}
    labels = {"02f8a0a0": "Сарын эхэн", "8480fb86": "Сарын сүүл"}
    for name, tab, wells, year, month in PIEZO_ROWS:
        labels.update(dict.fromkeys((wells, year, month), tab))
        by_prefix[wells]["topCaption"] = _caption(f"{name}, м")
        by_prefix[wells]["chartConfig"]["allRows"] = True
        for chart, period in ((year, "жилээр"), (month, "сараар")):
            by_prefix[chart]["topCaption"] = _caption(f"{name} /дундаж утга/, {period}, м")
            by_prefix[chart]["chartConfig"]["endLabelInside"] = True
    _tab_labels(dash["layout"], labels)
    # Өндөршил далайн түвшнээс: 0 нь утгагүй тул багана утгын мужаас эхэлнэ
    for chart in ("611374c3", "62d6c583"):
        by_prefix[chart]["chartConfig"]["tightBars"] = True
    # Анхны график «усны» нэртэй, 1226-ийн аюулын шугамтай ч цооногийн өндөршлийн талбар уншдаг байсан
    by_prefix["611374c3"]["datasets"][0]["statisticDefinitions"][0]["onStatisticField"] = "Усныүнэмлэхүйөндөршил_м"


# Цацраг худаг: (нэр, нэгж, табын товч, өндөршил эсэх, цооногоор, жилээр, сараар, өдрөөр)
RADIAL_ROWS = [
    ("Цооногийн үнэмлэхүй өндөршил", "м", "Цооног", True, "fa1de1b7", "0018aeb5", "bec9e184", "21c89689"),
    ("Трубаны өндөр", "м", "Труба", False, "a2c3e0db", "a4a123c8", "bb593fed", "6700f589"),
    ("Усны үнэмлэхүй өндөршил", "м", "Ус", True, "8adeb96a", "d8c35149", "cfe3ad92", "a1816f75"),
    ("Газрын гадарга хүртэл түвшин", "м", "Газар", False, "c14cf235", "c9a8335c", "2475738c", "f77da173"),
    ("Хэмжилтийн цэгийн усны түвшин", "", "Түвшин", False, "8e504e1f", "1460d774", "3edeaa71", "1752d9e3"),
]


def _radial_wells(dash: dict) -> None:
    by_prefix = {w["id"][:8]: w for w in dash["widgets"]}
    # DK цооногуудын өндөршил 560–616 гарч, уснаас (1225) доор байсан: 0 бичлэг дунджийг татаж байна
    positive = {"type": "filterRule", "field": {"name": "Цооногийн_үнэмлэхүй_өндөршил_м", "type": "double"}, "operator": "greater", "constraint": {"value": 0}}
    for chart in ("fa1de1b7", "0018aeb5", "bec9e184", "21c89689"):
        ds = by_prefix[chart]["datasets"][0]
        ds["filter"] = {"type": "filterGroup", "condition": "AND", "rules": [ds["filter"], positive]} if ds.get("filter") else positive
    # Багана дарахад газрын зураг, баруун графикууд шүүгдэнэ; бусад 4 багана бүх цооногоо харуулсан хэвээр
    sources = {by_prefix[r[4]]["id"] for r in RADIAL_ROWS}
    labels = {}
    for name, unit, tab, tight, wells, year, month, day in RADIAL_ROWS:
        w = by_prefix[wells]
        w["topCaption"] = _caption(f"{name}, {unit}" if unit else name)
        w["datasets"][0]["orderByFields"] = ["Цооногийн_дугаар ASC"]
        w["chartConfig"].update({"columns": True, "rotated": False, "tightBars": tight, "solidBars": True, "evenTicks": True})
        w["valueFormat"] = {**w.get("valueFormat", {}), "minimumFractionDigits": 2, "maximumFractionDigits": 2}
        for event in w["events"]:
            for action in event["actions"]:
                action["targets"] = [t for t in action["targets"] if t["targetId"].split("#")[0] not in sources]
        labels.update(dict.fromkeys((year, month, day), tab))
        suffix = f", {unit}" if unit else ""
        middle = " /дундаж утга/" if unit else ""
        for chart, period in ((year, "жилээр"), (month, "сараар"), (day, "өдрөөр")):
            by_prefix[chart]["topCaption"] = _caption(f"{name}{middle}, {period}{suffix}")
            by_prefix[chart]["chartConfig"].update({"endLabelInside": True, "evenTicks": True})
    _tab_labels(dash["layout"], labels)


def _copy_targets(dash: dict, source_id: str, widgets: list[dict]) -> None:
    """Шинэ виджетүүд эх виджетийн адил шүүлтүүрт орно."""
    for holder in [*dash["widgets"], *dash["header"]["selectors"]]:
        for event in holder.get("events") or []:
            for action in event["actions"]:
                action["targets"] += [{**t, "targetId": t["targetId"].replace(source_id, w["id"])} for t in action["targets"] if t["targetId"].startswith(source_id) for w in widgets]


def _year_line(w: dict, base: dict, title: str, field: str, kind: str, stat: dict) -> None:
    """Усны балансын адил гөлгөр шугам: талбар нь хоосон бичлэг графикт орохгүй."""
    w.update({"type": "serialChartWidget", "topCaption": _caption(title), "chartConfig": copy.deepcopy(base)})
    w["datasets"][0].update({
        "groupByFields": [field],
        "orderByFields": [f"{field} ASC"],
        "statisticDefinitions": [stat],
        "filter": {"type": "filterRule", "field": {"name": field, "type": kind}, "operator": "is_not_null", "constraint": {"type": "nil"}},
    })
    config = w["chartConfig"]
    config["series"][0].update({"type": "lineSeries", "x": field, "y": stat["outStatisticFieldName"]})
    config.update({"rotated": False, "evenTicks": True, "endLabelInside": True})
    if kind == "date":
        # Он болгон нэгтгэсэн тул огноогоор сонгож шүүх боломжгүй
        config["yearBin"] = True
        w["events"] = []


def _land_register(dash: dict) -> None:
    by_prefix = {w["id"][:8]: w for w in dash["widgets"]}
    count = {"onStatisticField": "OBJECTID", "statisticType": "count", "outStatisticFieldName": "COUNT_OBJECTID"}
    area = {"onStatisticField": "Area_hec", "statisticType": "sum", "outStatisticFieldName": "SUM_AREA_HEC"}
    base = copy.deepcopy(by_prefix["efe35614"]["chartConfig"])
    base.pop("chartRenderer", None)
    # 24 бүртгэлгүй бичлэг огноогүй тул графикт орохгүй
    for chart, title, field, kind, stat in (
        ("6638fcbf", "Бүртгэсэн нэгж талбар, оноор, ш", "Бүртг", "date", count),
        ("efe35614", "Бүртгэсэн газрын хэмжээ, оноор, га", "Бүртг", "date", area),
        ("c533f3c9", "Хянан баталгаа дуусах нэгж талбар, оноор, ш", "Хянан", "double", count),
        ("7d91ca63", "Хянан баталгаа дуусах газрын хэмжээ, оноор, га", "Хянан", "double", area),
    ):
        _year_line(by_prefix[chart], base, title, field, kind, stat)
    for kpi, title, icon, unit in (("83427b8c", "Нэгж талбарын тоо", "records", "ш"), ("763c3bfc", "Нийт газрын хэмжээ", "area", "га")):
        w = by_prefix[kpi]
        w["icon"], w["iconWide"], w["unit"] = icon, True, unit
        w["defaultSettings"]["topSection"]["textInfo"]["text"] = title
        w["defaultSettings"]["middleSection"]["textInfo"]["text"] = "{value}"
    # Төрөл, бүс графикаас шүүлтүүрт шилжив
    selectors = dash["header"]["selectors"]
    # Аймаг, сумыг бүртгэлийн өөрийн талбараас сонгоно: хилийн давхаргад нэр зөрдөг («Баян Өндөр», «Баян-Өндөр»),
    # нэг нэртэй сум олон аймагт байдаг. Зураг сонгосон талбайнууд руу очно.
    records = {w["id"] for w in dash["widgets"]} | {x["id"] for x in selectors if not x["id"].startswith(("0bfdaede", "dffc793d"))}
    map_id = by_prefix["5cd44381"]["id"]
    source_layer = by_prefix["6638fcbf"]["datasets"][0]["dataSource"]
    for prefix, target in (("0bfdaede", "Аймаг"), ("dffc793d", "Сум")):
        selector = next(x for x in selectors if x["id"].startswith(prefix))
        dataset = selector["datasets"][0]
        dataset["dataSource"] = copy.deepcopy(source_layer)
        dataset["groupByFields"] = [target]
        dataset["orderByFields"] = [f"{target} ASC"]
        dataset["statisticDefinitions"] = [{"onStatisticField": "OBJECTID", "statisticType": "count", "outStatisticFieldName": "COUNT_OBJECTID"}]
        for event in selector["events"]:
            for action in event["actions"]:
                if action["type"] != "filter":
                    continue
                kept = []
                for t in action["targets"]:
                    owner = t["targetId"].split("#")[0]
                    if owner == map_id:
                        continue  # хилийн давхарга: бүртгэлийн давхаргын холбоосыг context үүсгэнэ
                    if owner in records and "#main" in t["targetId"]:
                        t.update({"by": "whereClause"})
                        t.pop("fieldMap", None)
                        kept.append(t)
                action["targets"] = kept
    template = next(x for x in selectors if x["id"].startswith("b8f9aad8"))
    added = []
    for selector_id, label, field in (("emc-land-type", "Төрлөөр шүүх", "Газар"), ("emc-land-zone", "Бүсээр шүүх", "Бүс")):
        selector = copy.deepcopy(template)
        selector.update({"id": selector_id, "label": label})
        selector["datasets"][0].update({"groupByFields": [field], "orderByFields": [f"{field} ASC"]})
        for event in selector["events"]:
            for action in event["actions"]:
                action["targets"] = [t for t in action["targets"] if "#194fdb3bee8" not in t["targetId"]]
        added.append(selector)
    dash["header"]["selectors"] = [*added, *selectors]


def _licences(dash: dict) -> None:
    by_prefix = {w["id"][:8]: w for w in dash["widgets"]}
    count = {"onStatisticField": "FID", "statisticType": "count", "outStatisticFieldName": "COUNT_FID"}
    area = {"onStatisticField": "Талб_1", "statisticType": "sum", "outStatisticFieldName": "SUM_AREA_HA"}
    source = by_prefix["bf589dda"]
    base = copy.deepcopy(source["chartConfig"])
    base.pop("chartRenderer", None)
    # Анхны холбоос алдаатай: лицензийн талбараар аймгийн хилийг шүүж 400 буцдаг, аймгийн нэрийг лицензийн дугаартай тулгаж 0 гардаг
    map_id, aimag = by_prefix["0031d955"]["id"], "405520d2"
    for selector in dash["header"]["selectors"]:
        layer = "#19511fbbce5" if selector["id"].startswith(aimag) else "#19511f852d4"
        for event in selector["events"]:
            for action in event["actions"]:
                if action["type"] == "filter":
                    action["targets"] = [
                        t for t in action["targets"]
                        if (layer in t["targetId"] if t["targetId"].startswith(map_id) else not selector["id"].startswith(aimag) and not t["targetId"].startswith(aimag))
                    ]
    # Шинэ 2 график хуучин графикийн адил шүүлтүүрт орно
    added = [{**copy.deepcopy(source), "id": "emc-licence-issued-area"}, {**copy.deepcopy(source), "id": "emc-licence-end-area"}]
    _copy_targets(dash, source["id"], added)
    dash["widgets"] = [*dash["widgets"], *added]
    for w, title, field, stat in (
        (by_prefix["50e1d23e"], "Олгосон лиценз, оноор, ш", "Олгос", count),
        (added[0], "Олгосон талбай, оноор, га", "Олгос", area),
        (source, "Хугацаа дуусах лиценз, оноор, ш", "Хүчин", count),
        (added[1], "Хугацаа дуусах талбай, оноор, га", "Хүчин", area),
    ):
        _year_line(w, base, title, field, "date", stat)
        # Он дараалсан 20 гаруй цэг, ихэнх нь 0: зөвхөн оргилд тоо бичнэ
        w["chartConfig"]["peakLabels"] = True
    for kpi, title, icon, unit in (("9d648b13", "Лицензийн тоо", "records", "ш"), ("5844f7b4", "Нийт талбай", "area", "га"), ("c743f460", "Нийт талбай", "area", "км²")):
        w = by_prefix[kpi]
        w["icon"], w["iconWide"], w["unit"] = icon, True, unit
        w["defaultSettings"]["topSection"]["textInfo"]["text"] = title
        w["defaultSettings"]["middleSection"]["textInfo"]["text"] = "{value}"
        w["defaultSettings"].setdefault("bottomSection", {}).setdefault("textInfo", {})["text"] = ""


def _cables(dash: dict) -> None:
    by_prefix = {w["id"][:8]: w for w in dash["widgets"]}
    length = {"onStatisticField": "urt", "statisticType": "sum", "outStatisticFieldName": "SUM_URT"}
    rule = lambda field, op, **constraint: {"type": "filterRule", "field": {"name": field, "type": "string"}, "operator": op, "constraint": constraint}
    # 352 бичлэгийн 275-ын нэр «0», «1»: нэрээр эрэмбэлэхэд тэд давамгайлна
    named = rule("Name", "not_in", type="values", values=["0", "1"])
    template = by_prefix["240d8a79"]["chartConfig"]
    # Цацраг худгийн адил босоо багана: панелиа дүүргэнэ
    column_config = copy.deepcopy(template)
    column_config.pop("chartRenderer", None)
    column_config.update({"columns": True, "rotated": False, "evenTicks": True, "wholeValues": True, "wideColumns": True, "wrapCats": True})
    list_config = copy.deepcopy(template)
    list_config.pop("chartRenderer", None)
    list_config.update({"allRows": True, "wholeValues": True})
    # 150 төрөлгүй бичлэг аль алинд нь орохгүй
    for name, value, code_chart, line_chart, kpis in (
        ("Физик", "Физик кабель", "2f42e6ac", "7f2cc4ee", (("0927d38c", "Физик кабель", "records", "ш"), ("b9749e13", "Физик кабелийн урт", "depth", "м"), ("de0682fa", "Физик муфт", "records", "ш"))),
        ("Шилэн", "Шилэн кабель", "240d8a79", "2bf0de49", (("8fee0e78", "Шилэн кабель", "records", "ш"), ("7ad9738a", "Шилэн кабелийн урт", "depth", "м"), ("ac106118", "Шилэн муфт", "records", "ш"))),
    ):
        sub = rule("Дэд_т", "equal", type="value", value=value)
        w = by_prefix[code_chart]
        w.update({"topCaption": _caption(f"{name} кабелийн төрөл, м"), "chartConfig": {**copy.deepcopy(column_config), "catAxisHeight": 110}})
        w["chartConfig"]["series"][0].update({"x": "Шугам", "y": "SUM_URT"})
        w["datasets"][0].update({"statisticDefinitions": [length], "orderByFields": ["SUM_URT DESC"], "filter": sub})
        w = by_prefix[line_chart]
        w.update({"topCaption": _caption(f"{name} кабелийн шугам, м"), "bottomCaption": "Нэргүй («0», «1») хэсгүүд ороогүй", "chartConfig": copy.deepcopy(list_config)})
        w["chartConfig"]["series"][0].update({"x": "Name", "y": "SUM_URT"})
        w["datasets"][0].update({"filter": {"type": "filterGroup", "condition": "AND", "rules": [sub, named]}})
        for kpi, title, icon, unit in kpis:
            w = by_prefix[kpi]
            w["icon"], w["iconWide"], w["unit"] = icon, True, unit
            w["defaultSettings"]["topSection"]["textInfo"]["text"] = title
            w["defaultSettings"]["middleSection"]["textInfo"]["text"] = "{value}"
            w["defaultSettings"].setdefault("bottomSection", {}).setdefault("textInfo", {})["text"] = ""
    # Он, суурилуулалт Физикт бага мэдээлэлтэй (2 он, 98% газар доор): нэг график, төрлөөр өнгө ялгана
    both = rule("Дэд_т", "is_in", type="values", values=["Физик кабель", "Шилэн кабель"])
    colors = {"Физик кабель": "#a7ecd9", "Шилэн кабель": "#2aa98d"}
    for chart, title, field, order in (("8a024fd9", "Кабелийн урт, оноор, м", "ognoo", "ognoo ASC"), ("00136c2d", "Кабелийн суурилуулалт, м", "Шуга_1", "SUM_URT DESC")):
        w = by_prefix[chart]
        w.update({"topCaption": _caption(title), "bottomCaption": "", "chartConfig": {**copy.deepcopy(column_config), "splitColors": colors}, "splitBy": {"fieldName": "Дэд_т"}})
        w["chartConfig"]["series"][0].update({"x": field, "y": "SUM_URT"})
        w["datasets"][0].update({"groupByFields": [field, "Дэд_т"], "orderByFields": [order], "statisticDefinitions": [length], "filter": both})
    # Бүсийн шүүлтүүр анхнаасаа эдгээрт хүрдэггүй байсан
    for selector in dash["header"]["selectors"]:
        if selector["id"].startswith("35a0b34a"):
            for event in selector["events"]:
                for action in event["actions"]:
                    if action["type"] == "filter":
                        action["targets"] += [{"targetId": f'{by_prefix[k]["id"]}#main', "by": "whereClause", "requiresSelection": False} for k in ("240d8a79", "2f42e6ac", "00136c2d")]


def _cable_survey(dash: dict) -> None:
    by_prefix = {w["id"][:8]: w for w in dash["widgets"]}
    rule = lambda field, op, **constraint: {"type": "filterRule", "field": {"name": field, "type": "string"}, "operator": op, "constraint": constraint}
    # Анхны is_not_empty шүүлтийг сервер дэмждэггүй тул 323 хоосон мөр гардаг байсан. cross нь SQL-ийн нөөц үг: кодоор нь шүүнэ
    for chart, title, field in (
        ("0af49329", "Аппаратын засвар, ш", "apparat"), ("866951da", "Кабель шугамын засвар, ш", "cableshugam"), ("32ed008c", "Станцын гэмтэл, ш", "stantsiingemtel"),
        ("894d6dbb", "Кроссын засвар, ш", "crosskod"), ("b3d6dd50", "Бусад гэмтэл, ш", "busad"),
    ):
        by_prefix[chart]["topCaption"] = _caption(title)
        by_prefix[chart]["datasets"][0]["filter"] = {"type": "filterGroup", "condition": "AND", "rules": [rule(field, "is_not_null", type="nil"), rule(field, "not_equal", type="value", value="")]}
    by_prefix["93217e06"]["topCaption"] = _caption("Татсан кабелийн урт, м")
    by_prefix["ad12f25d"]["topCaption"] = _caption("Кабелийн ажлын тоо, ш")
    # Ажилтан: 11 хүн бүгд, цэнхэр, улбар шарын оронд нэг ногооны 2 түвшин
    staff = by_prefix["e2197bbd"]
    staff["topCaption"] = _caption("Ажилтны гүйцэтгэл, ш")
    staff["chartConfig"].update({"allRows": True, "splitColors": {"Cable": "#2aa98d", "Duudlaga": "#a7ecd9"}})
    # Холболтын талбар бараг хоосон (0, 0, 0, 1): ажлын нийт тоо, уртаар солив
    for kpi, title, icon, unit, flt, stat in (
        ("39ed8593", "Засвар хийсэн", "records", "ш", None, None),
        ("50355499", "Дуудлага", "records", "ш", rule("gemtliinturul", "equal", type="value", value="Duudlaga"), None),
        ("a5a55abb", "Кабелийн ажил", "records", "ш", rule("gemtliinturul", "equal", type="value", value="Cable"), None),
        ("20dd1174", "Татсан кабелийн урт", "depth", "м", by_prefix["93217e06"]["datasets"][0]["filter"], {"onStatisticField": "cabliinurt", "statisticType": "sum", "outStatisticFieldName": "SUM_CABLIINURT"}),
    ):
        w = by_prefix[kpi]
        w["icon"], w["iconWide"], w["unit"] = icon, True, unit
        w["defaultSettings"]["topSection"]["textInfo"]["text"] = title
        w["defaultSettings"]["middleSection"]["textInfo"]["text"] = "{value}"
        w["defaultSettings"].setdefault("bottomSection", {}).setdefault("textInfo", {})["text"] = ""
        w["valueFormat"] = {**w.get("valueFormat", {}), "useGrouping": True, "maximumFractionDigits": 0}
        if flt:
            w["datasets"][0]["filter"] = copy.deepcopy(flt)
        if stat:
            w["datasets"][0]["statisticDefinitions"] = [stat]
    # Кабелийн ажлын бичлэгт ognoo хоосон, огноо нь ehelsenognoo
    cable_only = {by_prefix[k]["id"] for k in ("a5a55abb", "20dd1174", "ad12f25d")}
    for selector in dash["header"]["selectors"]:
        if selector["id"].startswith("7b53af27"):
            for event in selector["events"]:
                for action in event["actions"]:
                    for target in action["targets"]:
                        if target["targetId"].split("#")[0] in cable_only:
                            for mapped in target.get("fieldMap") or []:
                                mapped["targetName"] = "ehelsenognoo"


EXTRAS = {EXPLORATION: _exploration, HOLES: _holes, WATER_IN: _water_in, WATER_OUT: _water_out, WATER_GENERAL: _water_general, WATER_OTHER: _water_other, GOVIL: _govil, PIEZOMETER: _piezometer, RADIAL_WELLS: _radial_wells, LAND_REGISTER: _land_register, LICENCES: _licences, CABLES: _cables, CABLE_SURVEY: _cable_survey, LAKE: _lake, HISTORY: _history, RESERVES: _reserves, DUMPS: _dumps, DRILL_REPORT: _drill_report, DRILL_MACHINES: _drill_machines, HOLE_REPORT: _hole_report, **env_extras.EXTRAS}


def apply(dash: dict) -> dict:
    fn = EXTRAS.get(dash.get("id"))
    if not fn:
        return dash
    # ArcGIS-ийн тодорхойлолт кэштэй тул хуулбар дээр өөрчилнө
    out = copy.deepcopy(dash)
    try:
        fn(out)
    except Exception:
        # ArcGIS дээр виджет устсан г.м.: самбар унахгүй, нэмэлтгүйгээр анхны хэлбэрээрээ харагдана
        logger.exception("Dashboard %s: нэмэлт тохиргоо хэрэгжсэнгүй", dash.get("id"))
        return dash
    return out
