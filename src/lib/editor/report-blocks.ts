import type { ReportDraft } from "../ai/contract.ts";
import {
  createElement,
  createGroupFrom,
  type CanvasEl,
  type Theme,
  type ThemeId,
  THEMES,
} from "./model.ts";
import { kpiCard, signatureZone, type KpiKind } from "./report-tools.ts";

export type ReportBlockId =
  | "executive-summary"
  | "findings"
  | "recommendations"
  | "kpi-strip"
  | "data-table"
  | "approval";

export interface ReportBlockDef {
  id: ReportBlockId;
  label: string;
  hint: string;
}

export const REPORT_BLOCKS: ReportBlockDef[] = [
  {
    id: "executive-summary",
    label: "ملخص تنفيذي",
    hint: "عنوان، ملخص، وثلاث نقاط قابلة للتعديل",
  },
  {
    id: "findings",
    label: "النتائج الرئيسية",
    hint: "ثلاث بطاقات نتائج مع مساحة للأثر",
  },
  {
    id: "recommendations",
    label: "التوصيات",
    hint: "توصيات مرتبة مع مالك وموعد مستهدف",
  },
  {
    id: "kpi-strip",
    label: "شريط مؤشرات",
    hint: "ثلاث بطاقات أرقام قابلة للتحرير",
  },
  {
    id: "data-table",
    label: "جدول بيانات",
    hint: "عنوان وجدول رسمي قابل للتحرير",
  },
  {
    id: "approval",
    label: "اعتماد وتوقيع",
    hint: "منطقة اعتماد وختم جاهزة للتخصيص",
  },
];

export interface ReportBlockOptions {
  x?: number;
  y?: number;
  title?: string;
  summary?: string;
  items?: string[];
}

const DEFAULT_ITEMS = [
  "النتيجة أو النقطة الأساسية",
  "الأثر على المستفيدين أو التشغيل",
  "الدليل أو المؤشر المرتبط",
];

function text(
  theme: Theme,
  over: Partial<CanvasEl>,
  style: CanvasEl["style"] = {},
): CanvasEl {
  return createElement(
    "text",
    {
      ...over,
      style: {
        fontFamily: "Cairo",
        color: theme.ink,
        textAlign: "right",
        lineHeight: 1.55,
        textFit: "shrink",
        ...style,
      },
    },
    theme,
  );
}

function box(
  theme: Theme,
  over: Partial<CanvasEl>,
  style: CanvasEl["style"] = {},
): CanvasEl {
  return createElement(
    "box",
    {
      ...over,
      style: {
        fontFamily: "Cairo",
        fontSize: 11,
        color: theme.ink,
        fill: theme.surface,
        borderColor: theme.line,
        borderWidth: 0.35,
        radius: 4,
        textAlign: "right",
        lineHeight: 1.6,
        textFit: "shrink",
        padding: 4,
        ...style,
      },
    },
    theme,
  );
}

function group(
  elements: CanvasEl[],
  name: string,
  origin: Pick<ReportBlockOptions, "x" | "y"> = {},
): CanvasEl | null {
  const result = createGroupFrom(elements, name);
  if (!result) return null;
  result.x = origin.x ?? 0;
  result.y = origin.y ?? 0;
  return result;
}

function cardStack(
  theme: Theme,
  title: string,
  items: string[],
  prefix: string,
  label: string,
): CanvasEl | null {
  const elements: CanvasEl[] = [
    text(
      theme,
      {
        name: title,
        x: 0,
        y: 0,
        w: 170,
        h: 11,
        content: title,
      },
      { fontFamily: "Tajawal", fontSize: 17, fontWeight: 800, color: theme.primary },
    ),
  ];

  items.slice(0, 4).forEach((item, index) => {
    const y = 16 + index * 29;
    elements.push(
      box(theme, {
        name: `${label} ${index + 1}`,
        x: 0,
        y,
        w: 170,
        h: 24,
        content: `${prefix}${index + 1}  ·  ${item}`,
      }),
    );
  });

  return group(elements, label);
}

function buildExecutiveSummary(
  theme: Theme,
  options: ReportBlockOptions,
): CanvasEl | null {
  const items = options.items?.length ? options.items : DEFAULT_ITEMS;
  const elements: CanvasEl[] = [
    text(
      theme,
      { name: "عنوان الملخص التنفيذي", x: 0, y: 0, w: 170, h: 11, content: options.title || "ملخص تنفيذي" },
      { fontFamily: "Tajawal", fontSize: 17, fontWeight: 800, color: theme.primary },
    ),
    box(theme, {
      name: "ملخص التقرير",
      x: 0,
      y: 15,
      w: 170,
      h: 30,
      content: options.summary || "اكتب هنا الرسالة الأساسية للتقرير والنتيجة التي يحتاج القارئ إلى معرفتها.",
    }),
  ];
  items.slice(0, 3).forEach((item, index) => {
    elements.push(
      text(
        theme,
        {
          name: `نقطة الملخص ${index + 1}`,
          x: 0,
          y: 50 + index * 11,
          w: 170,
          h: 9,
          content: `• ${item}`,
        },
        { fontSize: 10.5, fontWeight: 700 },
      ),
    );
  });
  return group(elements, "كتلة ملخص تنفيذي", options);
}

function buildKpiStrip(themeId: ThemeId, options: ReportBlockOptions): CanvasEl | null {
  const theme = THEMES[themeId];
  const elements: CanvasEl[] = [
    text(
      theme,
      { name: "عنوان شريط المؤشرات", x: 0, y: 0, w: 170, h: 10, content: options.title || "المؤشرات الرئيسية" },
      { fontFamily: "Tajawal", fontSize: 16, fontWeight: 800, color: theme.primary },
    ),
  ];
  const kinds: KpiKind[] = ["badge", "badge", "badge"];
  const captions = options.items?.length ? options.items : ["نسبة الإنجاز", "المبادرات", "رضا المستفيدين"];
  kinds.forEach((kind, index) => {
    elements.push(
      ...kpiCard(kind, themeId, {
        x: index * 59,
        y: 15,
        caption: captions[index] || `مؤشر ${index + 1}`,
        value: [94, 18, 87][index],
      }),
    );
  });
  return group(elements, "كتلة شريط المؤشرات", options);
}

function buildDataTable(theme: Theme, options: ReportBlockOptions): CanvasEl | null {
  return group(
    [
      text(
        theme,
        { name: "عنوان جدول البيانات", x: 0, y: 0, w: 170, h: 11, content: options.title || "جدول البيانات" },
        { fontFamily: "Tajawal", fontSize: 17, fontWeight: 800, color: theme.primary },
      ),
      createElement(
        "table",
        {
          name: "جدول تقرير قابل للتحرير",
          x: 0,
          y: 15,
          w: 170,
          h: 64,
          content: JSON.stringify([
            ["المحور", "المستهدف", "المتحقق"],
            ["المحور الأول", "100%", "—"],
            ["المحور الثاني", "100%", "—"],
            ["المحور الثالث", "100%", "—"],
          ]),
          style: {
            cols: 3,
            rows: 4,
            fontSize: 10,
            fontFamily: "Cairo",
            headerBg: theme.primary,
            headerColor: "#ffffff",
            tableBg: "#ffffff",
            borderColor: theme.line,
            cellAlign: "right",
          },
        },
        theme,
      ),
    ],
    "كتلة جدول البيانات",
    options,
  );
}

function buildApproval(theme: Theme, options: ReportBlockOptions): CanvasEl | null {
  const zone = signatureZone(theme, { x: 0, y: 15, width: 170 });
  return group(
    [
      text(
        theme,
        { name: "عنوان الاعتماد", x: 0, y: 0, w: 170, h: 11, content: options.title || "الاعتماد والتوقيع" },
        { fontFamily: "Tajawal", fontSize: 17, fontWeight: 800, color: theme.primary },
      ),
      zone,
    ],
    "كتلة الاعتماد والتوقيع",
    options,
  );
}

export function buildReportBlock(
  id: ReportBlockId,
  themeId: ThemeId,
  options: ReportBlockOptions = {},
): CanvasEl | null {
  const theme = THEMES[themeId];
  switch (id) {
    case "executive-summary":
      return buildExecutiveSummary(theme, options);
    case "findings":
      return cardStack(theme, options.title || "النتائج الرئيسية", options.items?.length ? options.items : DEFAULT_ITEMS, "النتيجة ", "كتلة النتائج الرئيسية");
    case "recommendations":
      return cardStack(theme, options.title || "التوصيات", options.items?.length ? options.items : DEFAULT_ITEMS, "التوصية ", "كتلة التوصيات");
    case "kpi-strip":
      return buildKpiStrip(themeId, options);
    case "data-table":
      return buildDataTable(theme, options);
    case "approval":
      return buildApproval(theme, options);
  }
}

export function buildReportDraftBlock(
  themeId: ThemeId,
  draft: ReportDraft,
  origin: Pick<ReportBlockOptions, "x" | "y"> = {},
): CanvasEl | null {
  const theme = THEMES[themeId];
  const elements: CanvasEl[] = [
    text(
      theme,
      { name: "عنوان مسودة التقرير", x: 0, y: 0, w: 170, h: 12, content: draft.title },
      { fontFamily: "Tajawal", fontSize: 19, fontWeight: 800, color: theme.primary },
    ),
    box(theme, {
      name: "ملخص المسودة",
      x: 0,
      y: 16,
      w: 170,
      h: 31,
      content: draft.summary || "لم يقدّم الموجز ملخصاً مستقلاً؛ راجع الأقسام التالية قبل الاعتماد.",
    }),
  ];

  draft.sections.forEach((section, index) => {
    const y = 51 + index * 34;
    elements.push(
      box(theme, {
        name: `قسم التقرير ${index + 1}`,
        x: 0,
        y,
        w: 170,
        h: 30,
        content: [section.body, ...section.bullets.map((item) => `• ${item}`)]
          .filter(Boolean)
          .join("\n"),
      }),
      text(
        theme,
        {
          name: `عنوان قسم التقرير ${index + 1}`,
          x: 5,
          y: y + 2,
          w: 160,
          h: 7,
          content: section.heading,
        },
        { fontSize: 10.5, fontWeight: 800, color: theme.primary },
      ),
    );
  });

  if (draft.nextSteps.length) {
    const y = 51 + draft.sections.length * 34;
    elements.push(
      box(theme, {
        name: "الخطوات التالية",
        x: 0,
        y,
        w: 170,
        h: 29,
        content: ["الخطوات التالية", ...draft.nextSteps.map((step) => `• ${step}`)].join("\n"),
      }),
    );
  }

  return group(elements, "مسودة تقرير منظمة", origin);
}
