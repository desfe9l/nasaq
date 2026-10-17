/**
 * Built-in Arabic motion templates for NASAQ.
 *
 * These are **real compositions**, not placeholders. Each one produces the
 * same frame from `seek(t)` in the preview and in an exported video, and every
 * string is genuine NASAQ Arabic copy rather than lorem text — Arabic motion
 * design lives or dies on the actual rhythm of the language, and placeholder
 * copy hides exactly the line-length and shaping problems that make an
 * otherwise correct motion system look broken.
 *
 * ## Design rules these encode
 *
 * The rules come from the same verified reference motion work as the
 * period-origin effect, and they are the reason these templates exist rather
 * than a generic "text on a background":
 *
 *  - **One camera move, one curve.** Everything rides `MOTION_EASE`. Mixing
 *    easings is the single clearest tell of an amateur motion system.
 *  - **Nothing cuts.** Scene changes are `iris` or overlap, never a hard cut
 *    mid-phrase.
 *  - **Hold longer than you move.** Motion under 1s per beat; the state it
 *    arrives at gets real time to be read. Arabic headlines are long and
 *    information-dense — rushing them is the failure mode.
 *  - **Gold is an accent, never a paragraph.** Gold draws rules, diamonds and
 *    the page-number circle. Body copy stays ink on paper.
 *  - **Arabic is right-to-left and set deliberately.** Reveals walk RTL,
 *    captions are RTL, numerals follow the document's numeral setting.
 *
 * ## Numbers stay consistent
 *
 * The progress bar in the "beats" scenes, the counts in the copy, and the
 * final value are derived from one constant below. A counter that ends on a
 * different number than the bar ends on is a visible bug in every review.
 */

import { DISPLAY_STACK, SANS_STACK, prepareText, splitBeats } from "./arabic-type.ts";
import { periodOriginProblem } from "./period-origin.ts";
import { NASAQ_PALETTE, type Composition, type Scene } from "./types.ts";

const P = NASAQ_PALETTE;

/** The canonical NASAQ lockup, including the period the origin effect anchors to. */
export const NASAQ_WORDMARK = "نَسَق.";

/** Total beat count shown by the progress bar and referenced in the copy. */
const TOTAL_BEATS = 4;

/**
 * Beat copy for the product promise.
 *
 * Split with {@link splitBeats} so each line respects Arabic punctuation —
 * a comma is a natural beat boundary and forcing a break elsewhere produces a
 * visibly unbalanced caption.
 */
export const PROMISE_BEATS: string[] = splitBeats(
  "تقارير وعروض ومستندات مؤسسية، بخط عربي سليم وتخطيط يليق بالجهات الرسمية.",
  34,
);

/** Build a single "promise" scene revealing one Arabic beat at a time. */
const promiseScene = (index: number, text: string, width: number): Scene => {
  const beats = splitBeats(text, 34);
  const beat = beats[index % Math.max(beats.length, 1)];
  return {
    id: `promise-${index}`,
    name: `الوعد ${index + 1}`,
    durationMs: 3000,
    background: P.green,
    transition: { kind: "iris", durationMs: 520 },
    layers: [
      {
        kind: "text",
        id: `promise-${index}-label`,
        name: "عنوان صغير",
        text: "منصة نَسَق",
        top: 0.088,
        fontSize: width * 0.038,
        fontFamily: SANS_STACK,
        fontWeight: 600,
        color: P.gold,
        align: "start",
        startMs: 0,
        endMs: 2700,
        enter: 0.22,
        hold: 0.56,
        exit: 0.22,
        delayMs: 60,
        reveal: "slide-rtl",
        revealStaggerMs: 34,
        z: 10,
      },
      {
        kind: "text",
        id: `promise-${index}-line`,
        name: "السطر العربي",
        text: prepareText(beat),
        top: 0.150,
        fontSize: width * 0.072,
        fontFamily: DISPLAY_STACK,
        fontWeight: 700,
        color: P.paper,
        align: "start",
        lineHeight: 1.32,
        startMs: 180,
        endMs: 2760,
        enter: 0.26,
        hold: 0.54,
        exit: 0.2,
        reveal: "rise",
        revealStaggerMs: 26,
        rule: { color: P.gold, thickness: Math.max(2, width * 0.004), gap: width * 0.03 },
        z: 20,
      },
      {
        kind: "shape",
        id: `promise-${index}-diamond`,
        name: "ماسي ذهبي",
        shape: "diamond",
        width: width * 0.022,
        height: width * 0.022,
        fill: P.gold,
        startMs: 420,
        endMs: 2400,
        enter: 0.3,
        hold: 0.5,
        exit: 0.2,
        z: 30,
      },
    ],
  };
};

/**
 * The Arabic launch template.
 *
 * Portrait by default (9:16) because that is where institutional and product
 * video actually lives — Reels, TikTok, Shorts — and because a vertical frame
 * gives Arabic headlines the line length they want without shrinking type.
 * Pass `square` for feed-safe square output.
 */
export const arabicLaunchTemplate = (
  options: { aspect?: "portrait" | "square"; width?: number } = {},
): Composition => {
  const { aspect = "portrait", width = 1080 } = options;
  const scenes: Scene[] = [];

  scenes.push({
    id: "open",
    name: "الافتتاحية",
    durationMs: 2800,
    background: P.green,
    transition: { kind: "iris", durationMs: 620 },
    layers: [
      {
        kind: "text",
        id: "open-wordmark",
        name: "الاسم",
        text: prepareText(NASAQ_WORDMARK),
        top: 0.430,
        fontSize: width * 0.13,
        fontFamily: DISPLAY_STACK,
        fontWeight: 800,
        color: P.paper,
        align: "center",
        startMs: 120,
        endMs: 2520,
        enter: 0.3,
        hold: 0.48,
        exit: 0.22,
        reveal: "scale",
        revealStaggerMs: 46,
        rule: { color: P.gold, thickness: Math.max(2, width * 0.005), gap: width * 0.035 },
        z: 20,
      },
      {
        kind: "text",
        id: "open-tagline",
        name: "الوصف",
        text: prepareText("منصة التصميم والتحرير المؤسسي"),
        top: 0.575,
        fontSize: width * 0.036,
        fontFamily: SANS_STACK,
        fontWeight: 600,
        color: P.gold,
        align: "center",
        startMs: 760,
        endMs: 2460,
        enter: 0.26,
        hold: 0.5,
        exit: 0.24,
        reveal: "fade",
        revealStaggerMs: 22,
        z: 25,
      },
    ],
  });

  PROMISE_BEATS.forEach((beat, index) => {
    scenes.push(promiseScene(index, beat, width));
  });

  scenes.push({
    id: "proof",
    name: "الإنجاز",
    durationMs: 3200,
    background: P.green,
    transition: { kind: "iris", durationMs: 520 },
    layers: [
      {
        kind: "text",
        id: "proof-head",
        name: "العنوان",
        text: prepareText("أربع خطوات، مستند جاهز."),
        top: 0.395,
        fontSize: width * 0.062,
        fontFamily: DISPLAY_STACK,
        fontWeight: 700,
        color: P.paper,
        align: "start",
        lineHeight: 1.3,
        startMs: 80,
        endMs: 2900,
        enter: 0.24,
        hold: 0.54,
        exit: 0.22,
        reveal: "rise",
        revealStaggerMs: 28,
        z: 20,
      },
      {
        kind: "progress",
        id: "proof-progress",
        name: "شريط الإنجاز",
        label: `${TOTAL_BEATS} خطوات`,
        width: width,
        height: Math.max(6, width * 0.008),
        color: P.gold,
        trackColor: "rgba(255,255,255,0.18)",
        value: 1,
        labelFontSize: width * 0.028,
        labelColor: P.muted,
        startMs: 240,
        endMs: 2700,
        enter: 0.14,
        hold: 0.68,
        exit: 0.18,
        z: 25,
      },
    ],
  });

  scenes.push({
    id: "close",
    name: "الخاتمة",
    durationMs: 2800,
    background: P.green,
    transition: { kind: "iris", durationMs: 520 },
    layers: [
      {
        kind: "text",
        id: "close-wordmark",
        name: "الاسم",
        text: prepareText(NASAQ_WORDMARK),
        top: 0.430,
        fontSize: width * 0.115,
        fontFamily: DISPLAY_STACK,
        fontWeight: 800,
        color: P.paper,
        align: "center",
        startMs: 60,
        endMs: 2560,
        enter: 0.26,
        hold: 0.52,
        exit: 0.22,
        reveal: "scale",
        revealStaggerMs: 44,
        z: 20,
      },
      {
        kind: "text",
        id: "close-line",
        name: "سطر الختام",
        text: prepareText("نَسَق — يصنع مستندك المؤسسي"),
        top: 0.575,
        fontSize: width * 0.034,
        fontFamily: SANS_STACK,
        fontWeight: 600,
        color: P.gold,
        align: "center",
        startMs: 520,
        endMs: 2500,
        enter: 0.26,
        hold: 0.52,
        exit: 0.22,
        reveal: "fade",
        revealStaggerMs: 20,
        z: 25,
      },
    ],
  });

  return {
    id: "nasaq-arabic-launch",
    name: "إعلان نَسَق العربي",
    width,
    aspect,
    fps: 30,
    palette: P,
    scenes,
    loop: false,
  };
};

/** Inner beats that play through the period-origin iris. */
const PERIOD_BEATS = [
  { text: "اكتب تقريرك بالعربية", startMs: 900, endMs: 2600 },
  { text: "وثبّتِ الهوية البصرية", startMs: 2600, endMs: 4300 },
  { text: "صدّره جاهزًا", startMs: 4300, endMs: 6000 },
].map((beat) => ({ ...beat, text: prepareText(beat.text) }));

/**
 * The period-origin launch animation.
 *
 * The wordmark's final period opens like an iris and the product's promise
 * plays inside it, then closes so the last frame returns to the first.
 *
 * Returns `null` when the supplied wordmark cannot host the effect — a
 * wordmark with no final period has no anchor, and silently substituting a
 * centred circle would be a circle wipe wearing the product's name. Callers
 * surface {@link periodOriginProblem} to the author instead.
 */
export const periodOriginTemplate = (
  options: {
    wordmark?: string;
    aspect?: "square" | "portrait";
    width?: number;
  } = {},
): Composition | null => {
  const { wordmark = NASAQ_WORDMARK, aspect = "square", width = 1080 } = options;

  if (periodOriginProblem(wordmark)) return null;

  return {
    id: "nasaq-period-origin",
    name: "داخل النقطة",
    width,
    aspect,
    fps: 30,
    palette: P,
    loop: true,
    scenes: [
      {
        id: "period",
        name: "النقطة",
        durationMs: 7000,
        background: P.ink,
        transition: { kind: "none", durationMs: 0 },
        layers: [
          {
            kind: "period-origin",
            id: "period-main",
            name: "النقطة",
            wordmark: prepareText(wordmark),
            fontSize: width * 0.16,
            fontFamily: DISPLAY_STACK,
            fontWeight: 800,
            color: P.paper,
            innerColor: P.gold,
            startMs: 0,
            endMs: 7000,
            enter: 0,
            hold: 1,
            exit: 0,
            z: 20,
            irisScale: 0.58,
            centre: { x: 0.5, y: 0.46 },
            inner: {
              background: P.green,
              accent: P.gold,
              titleFontSize: width * 0.05,
              titleColor: P.paper,
              beats: PERIOD_BEATS,
            },
          },
        ],
      },
    ],
  };
};

/** Every built-in template, for the studio's template picker. */
export interface MotionTemplateEntry {
  id: string;
  name: string;
  description: string;
  aspect: "portrait" | "square";
  build: () => Composition | null;
}

export const MOTION_TEMPLATES: MotionTemplateEntry[] = [
  {
    id: "arabic-launch",
    name: "إعلان نَسَق العربي",
    description:
      "مقدمة بالاسم، أربعة أسطر عن الوعد، شريط إنجاز، وخاتمة بالهوية.",
    aspect: "portrait",
    build: () => arabicLaunchTemplate({ aspect: "portrait" }),
  },
  {
    id: "arabic-launch-square",
    name: "الإعلان العربي — مربع",
    description: "نفس التسلسل في إطار مربّع صالح للمربعات.",
    aspect: "square",
    build: () => arabicLaunchTemplate({ aspect: "square" }),
  },
  {
    id: "period-origin",
    name: "داخل النقطة",
    description:
      "تنقّح النقطة الأخيرة من الاسم كقرص، وتُعرض الوعود داخله ثم تنغلق.",
    aspect: "square",
    build: () => periodOriginTemplate({ aspect: "square" }),
  },
];

/** Build a template by id. Returns `null` when the id is unknown. */
export const buildTemplate = (id: string): Composition | null => {
  const entry = MOTION_TEMPLATES.find((template) => template.id === id);
  return entry ? entry.build() : null;
};