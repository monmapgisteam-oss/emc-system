// ArcGIS Dashboard (desktopView) JSON-ын бидэнд хэрэгтэй хэсгүүд

export type DataSource = { type: string; itemId?: string; layerId?: string | number };

export type Dataset = {
  type: string;
  name: string;
  dataSource?: DataSource;
  groupByFields?: string[];
  orderByFields?: string[];
  statisticDefinitions?: { onStatisticField: string; statisticType: string; outStatisticFieldName: string }[];
  outFields?: string[];
  maxFeatures?: number;
};

export type Target = {
  targetId: string;
  by: "whereClause" | "geometry";
  fieldMap?: { sourceName: string; targetName: string }[];
};

export type WidgetEvent = { type: string; actions?: { targets?: Target[] }[] };

export type NumberFormat = {
  style?: string;
  useGrouping?: boolean;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  valuePrefix?: string;
  valueSuffix?: string;
};

export type ChartSeries = {
  type: string; // columnSeries | barSeries | lineSeries | pieSeries ...
  id: string;
  name: string;
  x?: string;
  y?: string;
  color?: string; // нэмсэн графикт цувааны өнгө
  dataLabels?: { visible?: boolean };
  fillSymbol?: { color?: number[] };
  lineSymbol?: { color?: number[] };
};

export type Widget = {
  id: string;
  type: string;
  name?: string;
  topCaption?: string;
  bottomCaption?: string;
  caption?: string;
  title?: string;
  label?: string;
  datasets?: Dataset[];
  events?: WidgetEvent[];
  itemId?: string;
  /** Газрын зураг: давхарга бүрт объект дээр дарахад шүүх талбар */
  clickFields?: Record<string, string>;
  /** Газрын зураг: цэгийг энэ өнгийн ArcGIS Firefly тэмдгээр зурна, суурь зураг нь Firefly */
  firefly?: "cyan" | "water" | "purple" | "white";
  /** Газрын зураг: цэг, шошго товчны доор, зургийн захаар тасрахгүй */
  labelsInside?: boolean;
  // indicator
  defaultSettings?: {
    topSection?: { textInfo?: { text?: string } };
    middleSection?: { textInfo?: { text?: string } };
    bottomSection?: { textInfo?: { text?: string } };
  };
  valueFormat?: NumberFormat;
  labelFormat?: NumberFormat;
  valueType?: string;
  valueConversion?: { factor?: number; offset?: number };
  icon?: string; // тооны өмнөх дүрс; байвал тоо жижиг
  iconWide?: boolean; // нарийн картанд дүрсийг нууж тоонд зай өгнө
  unit?: string; // тооны ард жижиг бичих нэгж
  // charts
  categoryType?: "groupByValues" | "features" | "fields";
  category?: { fieldName?: string; labelOverrides?: { key: string; label: string }[]; nullLabel?: string; blankLabel?: string; byFieldsLabel?: string };
  // Хуучин (amCharts 3) хэлбэрийн график: цуваа нь chartConfig биш graphs-д
  graphs?: { type?: string; valueField?: string; title?: string }[];
  rotate?: boolean;
  valueAxis?: { stackType?: string };
  splitBy?: { fieldName?: string };
  // Нэмсэн график: нэг ангиллаар олон давхаргын бүтцийг харьцуулна
  colors?: Record<string, string>;
  otherColor?: string;
  statRows?: { label: string; unit: string; note?: string; widget: Widget }[]; // нэг картанд олон үзүүлэлт
  monoShades?: boolean; // донат: нэг өнгийн түвшнүүд, бөглөөгүй мөр хувьд орохгүй тусад нь
  leadRow?: boolean; // эзлэх хувийн картад: хамгийн их нь дээр тодоор, үлдсэнийг өөр хооронд нь харьцуулна
  sources?: { label: string; widget: Widget }[];
  parseDates?: boolean;
  chartConfig?: {
    rotated?: boolean;
    columns?: boolean; // он жил мэт дараалалтай ангиллыг босоо баганаар
    alignBars?: boolean; // интервалын графикийг зэргэлдээ хэвтээ баганатай ижил мөрөөр зурна
    remainder?: { key: string; total: string; parts: string[] }; // нийт дүнгээс хэсгүүдэд задраагүй үлдэгдэл
    valueDigits?: number; // тэнхлэг, шошгын аравтын орон (маш бага утгад)
    splitColors?: Record<string, string>; // splitBy: утга бүрийн тогтмол өнгө; бүгд зурагдаж, нэрээр эрэмбэлэгдэнэ
    legendLines?: number; // тайлбарын дээд мөр (олон цуваатай график)
    segmentLabels?: boolean; // давхарласан баганын хэсэг бүрийн дотор утга, доор нь тоон тэнхлэг
    fullLegend?: boolean; // дугуй: тайлбар үргэлж баруун талд, бүх утга нэг бүрчлэн харагдана
    splitOrder?: string[]; // цувааны тогтмол дараалал
    plainLines?: boolean; // олон шугамтай: дүүргэлтгүй, төгсгөлийн тоогүй, тайлбар бүтэн
    allRows?: boolean; // хэвтээ багана: бүх мөрийг гүйлгэж харуулна, их утгатайгаар таслахгүй
    tightBars?: boolean; // хэвтээ багана: 0 биш утгын мужаас эхэлнэ (өндөршил зэрэг)
    solidBars?: boolean; // багана хүрээгүй, тод дүүргэлттэй
    evenTicks?: boolean; // утгын тэнхлэгийн тоо жигд алхамтай
    yearBin?: boolean; // огноог он болгон нэгтгэнэ
    peakLabels?: boolean; // шугамын тоог зөвхөн оргилд бичнэ
    wideColumns?: boolean; // босоо багана өргөн, цөөн ангилалд ч панелиа дүүргэнэ
    wrapCats?: boolean; // босоо баганын нэр хэвтээ, мөрөөр хуваагдана; багтахгүй бол босоо
    catAxisHeight?: number; // босоо бичсэн нэрийн тэнхлэгийн өндөр, px
    wholeValues?: boolean; // тоог «64.2 мян» биш «64,187» гэж бүхлээр
    endLabelInside?: boolean; // шугамын сүүлийн тоо захаас гарахгүй
    stagedSplit?: boolean; // splitBy нь дараалсан үе: 1, 2, 3... тайлбар дарааллаар, шугам залгаатай
    ratio?: { key: string; num: string; den: string; factor: number }; // тооцсон утга: num / den * factor
    stackRuns?: string; // интервалыг гүнээр биш, энэ талбарын уртаар дараалуулж зурна (давхцахгүй)
    maxRows?: number; // интервалын мөрийн дээд тоо
    hideZero?: boolean; // утгагүй ангиллыг харуулахгүй
    nullIsValue?: boolean; // хоосон утга нэртэй ангилал (category.nullLabel) — бусадтай адил
    stackedType?: "sideBySide" | "stacked" | "stacked100";
    series?: ChartSeries[];
    chartRenderer?: { field1?: string; uniqueValueInfos?: { value: unknown; label?: string; symbol?: { color?: number[] } }[] };
    legend?: { visible?: boolean };
    // Тэнхлэгийн заагч шугам/муж (жишээ нь стандартын зөвшөөрөгдөх хязгаар)
    axes?: {
      valueFormat?: { type?: string };
      guides?: {
        start?: number | null;
        end?: number | null;
        visible?: boolean;
        style?: { color?: number[] };
        label?: { text?: string; horizontalAlignment?: string };
      }[];
    }[];
  };
  // selectors
  selection?: { type?: "single" | "multiple"; operator?: string; allowNone?: boolean };
  showFilter?: boolean;
  datePickerOption?: { selectionType?: string };
  // list / details / rich text
  itemText?: string;
  text?: string;
  maxItems?: number;
  // gauge
  minValue?: number | { value?: number };
  maxValue?: number | { value?: number };
  // table
  fieldsToDisplay?: { field?: string; name?: string; label?: string }[];
  columnSettings?: { title?: string; fieldName?: string; outStatisticFieldName?: string; valueFormat?: NumberFormat }[];
};

export type LayoutElement = {
  type: "stackLayoutElement" | "tabsLayoutElement" | "groupLayoutElement" | "itemLayoutElement";
  id: string;
  width: number;
  height: number;
  orientation?: "row" | "col";
  tabName?: string;
  tabLabel?: string; // табын товчны богино нэр; гарчиг, tooltip нь tabName-аар
  keepSizes?: boolean; // автомат дүрэм биш, энд заасан width/height-аар
  elements?: LayoutElement[];
};

export type DashboardDef = {
  id: string;
  title: string;
  modified?: number;
  access?: string;
  theme?: string; // загварын нэр: .dw-<theme>
  linksComplete?: boolean; // сервер холбоосыг бэлдсэн: frontend зургийн давхаргад талбар таамаглахгүй
  header?: { title?: string; selectors?: Widget[] };
  leftPanel?: { title?: string; selectors?: Widget[] };
  layout?: LayoutElement;
  widgets: Widget[];
};

export type Field = { name: string; alias: string; type: string; domain: Record<string, string> | null };

export type QueryResult = { rows: Record<string, unknown>[]; fields: Field[]; layer?: string; total?: number | null; ignored_filters?: number };

export type RuntimeFilter = { field: string; op: "in" | "between" | "contains"; values: unknown[] };

/** Сонголт хийсэн виджет (эх үүсвэр) → түүний сонгосон утгууд */
export type Selection = { field: string; op: "in" | "between" | "contains"; values: unknown[]; shown?: unknown[] };
