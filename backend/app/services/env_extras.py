"""Байгаль орчны хуудасны dashboard-ууд: стандартын шугам (guide), виджетүүдийн хоорондын бүрэн шүүлтүүр.

Стандартын утгууд: US_HURS_AGAAR_GUIDE_ZURAAS_UTGA.xlsx-ийн баганын доорх мөр.
"""

import copy
import re

WATER = "3b0fe193e4d64909a00e12887494531f"
SOIL = "a61b6ca8b88c4c7db3dfb3305d4168f0"
AIR = "55e91e367ac0480c8e0f4d4abd94f817"
DUST = "2fc14c08d9994d64aa7a3ae0beeb5ac7"
RECLAMATION = "41e720a94df34af4a2914a5867a150df"
GROVE = "743b66104ae6488b9c78dbb06cb74de9"
TREES = "25408bc53b2142ec91ca41b0720f644c"

RED = [255, 0, 0, 255]
ORANGE = [255, 152, 0, 255]

# Усны шугамууд ArcGIS дээр бий (Excel-тэй таарч байгааг шалгасан). pH-д Excel-д 6.5–9 байгаа ч шугам зурахгүй: хэрэглэгчийн шийдвэр

SOIL_STANDARD = "MNS 5850:2019"
SOIL_GUIDES = {
    "d57bf114": (100,),  # Cu
    "6e49a024": (300,),  # Zn
    "072e03b0": (20,),  # As
    "d9722924": (100,),  # Pb
    "9725a8cd": (50,),  # Co
    "1d4a4bb3": (5,),  # Mo
    "8c6257d0": (150,),  # Cr
}

AIR_STANDARD = "MNS 4585:2016"
AIR_DUST_CHART = "4390a116"
# Excel-д стандартын нэр 2 багана эзэлдэг (A:B) ч sheet 3 таних баганатай тул утгууд нэг баганаар зүүн тийш зөрсөн:
# 0.5 нь Тоосных (ArcGIS-ийн шугамаар батлагдсан). Тэгэхээр SO₂ 0.45, NO₂ 0.2, CO 60
# ArcGIS dashboard-д эдгээрийн график байхгүй тул Тоосны графикийн хажууд табаар нэмнэ
AIR_CHARTS = (("emc-air-so2", "SO₂", "SO_", 0.45), ("emc-air-no2", "NO₂", "NO_", 0.2), ("emc-air-co", "CO", "CO", 60))

TIME_FIELD = re.compile(r"^(он|сар|өдөр|улирал|year|month|day|жил)$", re.IGNORECASE)
PLACE_FIELD = re.compile(r"байршил|байршл|bairshil", re.IGNORECASE)


def caption(text: str) -> str:
    return f'<p style="text-align:center;"><strong>{text}</strong></p>'


def guide(value: float, label: str, color: list = RED, align: str = "left") -> dict:
    """ArcGIS-ийн chartGuide хэлбэрээр: систем бусад шугамын адил зурна."""
    return {
        "type": "chartGuide",
        "above": True,
        "start": value,
        "style": {"type": "esriSLS", "style": "esriSLSSolid", "color": color, "width": 1},
        "label": {"type": "esriTS", "color": color, "text": label, "horizontalAlignment": align},
        "visible": True,
    }


def add_guides(widget: dict, guides: list[dict]) -> None:
    axes = widget.setdefault("chartConfig", {}).setdefault("axes", [])
    axis = next((a for a in axes if (a.get("valueFormat") or {}).get("type") == "number"), None)
    if axis is None:
        axis = {"valueFormat": {"type": "number"}}
        axes.append(axis)
    current = axis.get("guides") or []
    have = {(g.get("start"), (g.get("label") or {}).get("text")) for g in current}
    axis["guides"] = [*current, *(g for g in guides if (g["start"], g["label"]["text"]) not in have)]


def _standard_guides(dash: dict, label: str, table: dict) -> None:
    by_prefix = {w["id"][:8]: w for w in dash["widgets"]}
    for key, values in table.items():
        # ArcGIS дээр график устсан бол бусад нь хэвээр
        if key in by_prefix:
            add_guides(by_prefix[key], [guide(v, label) for v in values])


# ---------------------------------------------------------------- хоорондын шүүлтүүр


def _layer_of(widget: dict) -> str:
    """Давхаргын танигч. Өөр webmap-д ижил layerId байж болох тул item-тай нь."""
    source = (widget.get("datasets") or [{}])[0].get("dataSource") or {}
    return source.get("url") or f"{source.get('itemId')}/{source.get('layerId')}"


def _map_layer(map_widget: dict, layer_id: str) -> str:
    return f"{map_widget.get('itemId')}/{layer_id}"


def _group_field(widget: dict) -> str | None:
    """Энэ виджет дээр сонгоход шүүх талбар: систем график, дугуйг эхний бүлэглэлтээр нь шүүдэг."""
    if widget.get("categoryType") == "fields" or widget["type"] == "indicatorWidget":
        return None
    groups = (widget.get("datasets") or [{}])[0].get("groupByFields") or []
    return groups[0] if groups else None


def _where_action(widget: dict) -> dict:
    events = widget.setdefault("events", [])
    actions = [a for ev in events if ev.get("type") == "selectionChanged" for a in ev.get("actions") or []]
    for action in actions:
        if action.get("type") == "filter" or any(t.get("by") == "whereClause" for t in action.get("targets") or []):
            return action
    if actions:
        return actions[0]
    action = {"type": "filter", "targets": []}
    events.append({"type": "selectionChanged", "actions": [action]})
    return action


def _target(target_id: str, field_map: list | None = None) -> dict:
    t = {"targetId": target_id, "by": "whereClause", "requiresSelection": False}
    if field_map:
        t["fieldMap"] = field_map
    return t


def _place_field(sources: list[dict], selectors: list[dict]) -> str | None:
    """Газрын зураг дээр дарахад шүүх талбар: байршил, эс бөгөөс хугацаа биш эхний шүүлтүүр."""
    for s in selectors:
        if PLACE_FIELD.search(str(s.get("label"))) and _group_field(s):
            return _group_field(s)
    for w in sources:
        if PLACE_FIELD.search(_group_field(w) or ""):
            return _group_field(w)
    return next((_group_field(s) for s in selectors if _group_field(s) and not TIME_FIELD.match(_group_field(s))), None)


def link_all(dash: dict) -> None:
    """Шүүлтүүр, график, дугуй, газрын зураг бүгд бие биенээ шүүнэ.

    «Энэ талбар тэр давхаргад ийм нэртэй» гэдгийг ArcGIS-ийн одоогийн холбоосоос авна. Мэдэгдээгүй бол ижил нэрээр:
    сервер давхаргын талбарыг мэддэг тул байхгүй талбарын шүүлтүүрийг алгасна (`arcgis._plan`).
    Газрын зураг шууд ArcGIS рүү хандаж алдаа буцаадаг тул зөвхөн мэдэгдэж буй талбараар холбогдоно.
    """
    selectors = [*((dash.get("header") or {}).get("selectors") or []), *((dash.get("leftPanel") or {}).get("selectors") or [])]
    everything = [*dash["widgets"], *selectors]
    by_id = {w["id"]: w for w in everything}
    data = [w for w in everything if w.get("datasets")]
    maps = [w for w in dash["widgets"] if w["type"] == "mapWidget"]
    map_ids = {m["id"] for m in maps}
    sources = [w for w in data if _group_field(w)]

    # (талбар, давхарга) → тэр давхарга дахь талбарын нэр
    known: dict[tuple[str, str], str] = {}
    map_layers: dict[str, set[str]] = {m["id"]: set() for m in maps}
    for w in everything:
        field = _group_field(w) if w.get("datasets") else None
        for ev in w.get("events") or []:
            for action in ev.get("actions") or []:
                for t in action.get("targets") or []:
                    target_id, _, part = str(t.get("targetId")).partition("#")
                    if target_id in map_ids:
                        map_layers[target_id].add(part)
                    if not field or t.get("by") != "whereClause" or target_id not in by_id:
                        continue
                    layer = _map_layer(by_id[target_id], part) if target_id in map_ids else _layer_of(by_id[target_id])
                    known[(field, layer)] = next((m["targetName"] for m in t.get("fieldMap") or [] if m.get("sourceName") == field), field)

    def field_in(field: str, source_layer: str, layer: str) -> str | None:
        return field if layer == source_layer else known.get((field, layer))

    for src in sources:
        field, layer = _group_field(src), _layer_of(src)
        action = _where_action(src)
        targets = action.setdefault("targets", [])
        have = {t.get("targetId") for t in targets if t.get("by") == "whereClause"}

        def add(target_id: str, target_field: str | None):
            if target_field and target_id not in have:
                targets.append(_target(target_id, None if target_field == field else [{"sourceName": field, "targetName": target_field}]))
                have.add(target_id)

        for w in data:
            if w["id"] != src["id"]:
                add(f"{w['id']}#main", field_in(field, layer, _layer_of(w)) or field)
        for m in maps:
            for map_layer in map_layers[m["id"]]:
                add(f"{m['id']}#{map_layer}", field_in(field, layer, _map_layer(m, map_layer)))

    # Газрын зураг: объект дээр дарахад бусад нь шүүгдэнэ. Давхарга бүр байршлаа өөр нэрээр хадгалж болно
    place = _place_field(sources, selectors)
    if not place:
        return
    place_layer = next(_layer_of(w) for w in sources if _group_field(w) == place)
    for m in maps:
        click_fields = {
            map_layer: name
            for map_layer in sorted(map_layers[m["id"]])
            if (name := field_in(place, place_layer, _map_layer(m, map_layer)))
        }
        if not click_fields:
            continue
        targets = []
        for w in data:
            target_field = field_in(place, place_layer, _layer_of(w)) or place
            targets.append(_target(f"{w['id']}#main", [{"sourceName": name, "targetName": target_field} for name in dict.fromkeys(click_fields.values())]))
        m["clickFields"] = click_fields
        m["events"] = [{"type": "selectionChanged", "actions": [{"type": "filter", "targets": targets}]}]


# ---------------------------------------------------------------- байрлал, загвар


def stack(sid: str, orientation: str, elements: list, width: float = 1, height: float = 1) -> dict:
    """orientation: «col» — хүүхдүүд зэрэгцэнэ, «row» — дээш доош."""
    return {"type": "stackLayoutElement", "id": sid, "orientation": orientation, "width": width, "height": height, "elements": elements}


def _item(node: dict, width: float = 1, height: float = 1) -> dict:
    return {**node, "width": width, "height": height}


def _split_tree(node: dict, items: list, tabs: list) -> None:
    if node["type"] == "tabsLayoutElement":
        tabs.append(node)
    elif node["type"] == "itemLayoutElement":
        items.append(node)
    else:
        for child in node.get("elements") or []:
            _split_tree(child, items, tabs)


def monitor_layout(dash: dict) -> None:
    """Олон үзүүлэлттэй самбар: дээр 2 эгнээ бүх карт, дунд газрын зураг ба дугуй, доор таб графикууд бүтэн өргөнөөр.

    ArcGIS дээр картууд нарийн баганад шахагдаж, графикууд нэг баганад давхарладаг. Энд график бүр зайтай, табууд хэвээр.
    """
    kinds = {w["id"]: w["type"] for w in dash["widgets"]}
    root = dash.get("layout") or {}
    columns = root.get("elements") or []
    card_column = next((c for c in columns if _leaves(c) and all(kinds.get(i["id"]) == "indicatorWidget" for i in _leaves(c))), None)
    if card_column is None:
        return  # танихгүй бүтэц: ArcGIS-ийн хэлбэрээр үлдээнэ
    items: list = []
    tabs: list = []
    for column in columns:
        if column is not card_column:
            _split_tree(column, items, tabs)
    the_map = next((i for i in items if kinds.get(i["id"]) == "mapWidget"), None)
    if the_map is None or not tabs:
        return
    pie = next((i for i in items if kinds.get(i["id"]) == "pieChartWidget"), None)
    # Салхины картууд бусад карттай нэг эгнээнд: дугуй газрын зургийн хажууд бүтэн өндрөөрөө
    cards = [*_leaves(card_column), *(i for i in items if kinds.get(i["id"]) == "indicatorWidget")]
    # ArcGIS дээр нэмсэн бусад виджет (жагсаалт, таб биш график) алдагдахгүй: графикуудын эгнээнд
    others = [i for i in items if i is not the_map and i is not pie and kinds.get(i["id"]) != "indicatorWidget"]
    bottom = [*tabs, *others]

    per_row = (len(cards) + 1) // 2
    card_rows = [stack(f"emc-cards-{n}", "col", [_item(c) for c in cards[n * per_row : (n + 1) * per_row]], height=0.085) for n in range(2)]
    # Дугуй 25%: нарийн бол тайлбар нь доошоо орж «+N бусад» болж хумигдана
    main = [_item(the_map, width=0.75)]
    if pie:
        main.append(_item(pie, width=0.25))
    dash["layout"] = stack(
        "emc-root",
        "row",
        [
            *card_rows,
            stack("emc-main", "col", main, height=0.36),
            stack("emc-charts", "col", [_item(n, width=1 / len(bottom)) for n in bottom], height=0.47),
        ],
    )


def _leaves(node: dict) -> list:
    return [node] if node["type"] == "itemLayoutElement" else [leaf for child in node.get("elements") or [] for leaf in _leaves(child)]


CAPS_WORD = re.compile(r"[А-ЯЁӨҮ]{2,}")
LONG_CAPS_WORD = re.compile(r"[А-ЯЁӨҮ]{4,}")
FIRST_LOWER = re.compile(r"[а-яёөү]")
ABBREVIATIONS = {"ХҮ", "ЖБ", "УХ", "БХХ", "ХАА"}
CARD_LABELS = ((re.compile(r"АГААРЫН\s+ТЕМП[Е]?РАТУР"), "Агаар t⁰C"), (re.compile(r"(УСНЫ|УСЫН)\s+ТЕМП[Е]?РАТУР"), "Ус t⁰C"))


def sentence_case(text: str | None) -> str | None:
    """«НИЙТ ТООСНЫ АГУУЛАМЖ, мг/м3» → «Нийт тоосны агууламж, мг/м3». Товчилсон нэр (ХҮ, БХХ) хэвээр."""
    if not text or not LONG_CAPS_WORD.search(text):
        return text
    lowered = CAPS_WORD.sub(lambda m: m.group(0) if m.group(0) in ABBREVIATIONS else m.group(0).lower(), text)
    return FIRST_LOWER.sub(lambda m: m.group(0).upper(), lowered, count=1)


def _polish_card(w: dict) -> None:
    sections = w.get("defaultSettings") or {}
    top = (sections.get("topSection") or {}).get("textInfo")
    if top and top.get("text"):
        text = top["text"]
        for pattern, label in CARD_LABELS:
            text = pattern.sub(label, text)
        top["text"] = sentence_case(text)
    # Нэгж утгын хажууд: 3 мөр биш 2 мөрт багтаж, намхан картанд тасрахгүй
    bottom = (sections.get("bottomSection") or {}).get("textInfo")
    if bottom and re.fullmatch(r"(<[^>]+>|\s)*мг/кг(<[^>]+>|\s)*", bottom.get("text") or ""):
        w["unit"] = "мг/кг"
        bottom["text"] = ""


def _polish_chart(w: dict) -> None:
    config = w.get("chartConfig") or {}
    ds = (w.get("datasets") or [{}])[0]
    stats = ds.get("statisticDefinitions") or []
    # Дунджуудыг нэмж давхарлах нь утгагүй (температурын нийлбэр 348°), шугамтай ч харьцуулагдахгүй
    if w.get("splitBy") and (config.get("stackedType") or "").startswith("stacked") and stats and stats[0].get("statisticType") == "avg":
        config["stackedType"] = "sideBySide"
    # Байршил бүрийн нэр харагдана: тайлбарыг «+N» болгож нуухгүй
    if w.get("splitBy"):
        config["legendLines"] = 3


def env_style(dash: dict) -> None:
    """Байгаль орчны самбарын нэгдсэн загвар. Хэмжээ нь энд тавьсан харьцаагаар (автомат дүрэм газрын зурагт 50%+ өгдөг)."""
    dash["theme"] = "env"
    for w in dash["widgets"]:
        for field in ("topCaption", "caption", "title"):
            if w.get(field):
                w[field] = sentence_case(w[field])
        if w["type"] == "indicatorWidget":
            _polish_card(w)
        elif w["type"] == "serialChartWidget":
            _polish_chart(w)
        elif w["type"] == "pieChartWidget" and "чиглэл" in (_group_field(w) or "").lower():
            # Салхины чиглэл: тайлбар баруун талд, бүх чиглэл харагдана
            w.setdefault("chartConfig", {})["fullLegend"] = True

    def walk(node: dict) -> None:
        node["keepSizes"] = True
        if node.get("tabName"):
            node["tabName"] = sentence_case(node["tabName"].strip())
        for child in node.get("elements") or []:
            walk(child)

    if dash.get("layout"):
        walk(dash["layout"])


def _bars_by_place(w: dict) -> None:
    """Байршлын хооронд шугам татах нь утгагүй, урт нэр нь тасардаг: хэвтээ багана, нэр нь зүүн талд."""
    for series in w["chartConfig"]["series"]:
        series["type"] = "barSeries"
    w["chartConfig"]["rotated"] = True


def _set_sizes(node: dict, attr: str, sizes: tuple) -> None:
    for child, size in zip(node["elements"], sizes):
        child[attr] = size


# ---------------------------------------------------------------- dashboard бүр


def _monitor(dash: dict) -> None:
    monitor_layout(dash)
    env_style(dash)
    link_all(dash)


# Хөрс: ArcGIS-ийн өнгө, дараалал. ArcGIS дээр өнгө нь цувааны байрлалаар оноогддог тул график бүрт өөр болдог: нэгтгэв
SOIL_PLACES = {
    "Вокзалын орчим": "#149ece",
    "Номин агуулах орчим": "#a7c636",
    "Орхон гол": "#9e559c",
    "Тариа бригад энгэр": "#fc921f",
    "Хаягдлын аж ахуй далангийн ойролцоо": "#ffde3e",
    "Хуурай ам": "#54994d",
    "Хаягдал аж ахуй": "#b7814a",
}


def _soil(dash: dict) -> None:
    """ArcGIS шиг давхарласан багана, хэсэг бүр дотроо утгатай: цэг бүрийн утга шууд уншигдана."""
    _standard_guides(dash, SOIL_STANDARD, SOIL_GUIDES)
    _monitor(dash)
    for w in dash["widgets"]:
        if w["type"] == "serialChartWidget" and w.get("splitBy"):
            w["chartConfig"].update({"stackedType": "stacked", "segmentLabels": True, "evenTicks": True, "splitColors": SOIL_PLACES, "splitOrder": list(SOIL_PLACES)})


DUST_TAB_LABELS = {"ДЭГДЭЛТИЙН ТОО": "Тоо", "САЛХИНЫ ДУНДАЖ ХУРД": "Салхи", "АГААРЫН ДУНДАЖ ТЕМПЕРАТУР": "Температур", "АГААРЫН ДУНДАЖ ЧИЙГ": "Чийг", "АГААРЫН ДУНДАЖ РГПА": "Даралт"}


def _dust(dash: dict) -> None:
    def walk(node: dict) -> None:
        label = DUST_TAB_LABELS.get((node.get("tabName") or "").strip().upper())
        if label:
            node["tabLabel"] = label
        for child in node.get("elements") or []:
            walk(child)

    if dash.get("layout"):
        walk(dash["layout"])
    env_style(dash)
    link_all(dash)


def _plain(dash: dict) -> None:
    env_style(dash)
    link_all(dash)


def _replace_with_tabs(node: dict, item_id_prefix: str, tabs: dict) -> bool:
    for i, child in enumerate(node.get("elements") or []):
        if child.get("type") == "itemLayoutElement" and child["id"].startswith(item_id_prefix):
            node["elements"][i] = {**tabs, "width": child.get("width", 1), "height": child.get("height", 1)}
            return True
        if _replace_with_tabs(child, item_id_prefix, tabs):
            return True
    return False


def _air(dash: dict) -> None:
    dust = next((w for w in dash["widgets"] if w["id"].startswith(AIR_DUST_CHART)), None)
    if dust:
        _air_standard_charts(dash, dust)
    # Дээр картууд, дунд дугуй, газрын зураг, доор 3 график
    rows = (dash.get("layout") or {}).get("elements") or []
    if len(rows) == 3 and rows[1].get("elements") and rows[2].get("elements"):
        _set_sizes(dash["layout"], "height", (0.13, 0.43, 0.44))
        _set_sizes(rows[1], "width", (0.25, 0.45, 0.3))  # дугуй 25%: усны самбартай ижил, тайлбарт хувь багтана
        _set_sizes(rows[2], "width", (0.28, 0.42, 0.3))
    env_style(dash)
    link_all(dash)


def _air_standard_charts(dash: dict, dust: dict) -> None:
    _bars_by_place(dust)
    charts = []
    for wid, label, field, limit in AIR_CHARTS:
        w = copy.deepcopy(dust)
        title = f"{label} /дундаж/"
        w.update({"id": wid, "name": title, "topCaption": caption(title)})
        w.pop("events", None)
        w["datasets"][0]["statisticDefinitions"] = [{"onStatisticField": field, "statisticType": "avg", "outStatisticFieldName": "AVG_VALUE"}]
        for series in w["chartConfig"]["series"]:
            series["y"] = "AVG_VALUE"
        for axis in w["chartConfig"].get("axes") or []:
            axis["guides"] = []
        add_guides(w, [guide(limit, AIR_STANDARD)])
        charts.append((w, label))
    tab_items = [
        {"type": "itemLayoutElement", "id": dust["id"], "width": 1, "height": 1, "tabName": "Тоос"},
        *({"type": "itemLayoutElement", "id": w["id"], "width": 1, "height": 1, "tabName": label} for w, label in charts),
    ]
    if dash.get("layout") and _replace_with_tabs(dash["layout"], AIR_DUST_CHART, {"type": "tabsLayoutElement", "id": "emc-air-standards", "elements": tab_items}):
        dash["widgets"] = [*dash["widgets"], *(w for w, _ in charts)]


def _with_plain_points(fn):
    """Байгаль орчны зурагт firefly биш, энгийн дугуй цэг."""

    def apply(dash: dict) -> None:
        fn(dash)
        for w in dash["widgets"]:
            if w.get("type") == "mapWidget":
                w["plainPoints"] = True

    return apply


EXTRAS = {
    item: _with_plain_points(fn)
    for item, fn in {
        WATER: _monitor,
        SOIL: _soil,
        AIR: _air,
        DUST: _dust,
        RECLAMATION: _plain,
        GROVE: _plain,
        TREES: _plain,
    }.items()
}
