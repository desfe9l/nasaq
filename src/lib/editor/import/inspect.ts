/**
 * Smart import inspector.
 *
 * A compact, product-facing readout of an imported document: pages, elements
 * by kind, groups, fonts, dimensions and the problems the repair engine can
 * see. Numbers only an author cares about — no provider names, no paths, no
 * developer jargon.
 */

import type { CanvasEl, Project } from "../model.ts";
import { pageSize } from "../model.ts";
import { detectImportProblems, type ImportProblem, type RepairOptions } from "./repair.ts";

export interface InspectionFont {
  family: string;
  elements: number;
}

export interface InspectionPage {
  name: string;
  w: number;
  h: number;
  elements: number;
}

export interface ImportInspection {
  pages: InspectionPage[];
  elements: number;
  groups: number;
  texts: number;
  images: number;
  shapes: number;
  tables: number;
  svgs: number;
  other: number;
  hidden: number;
  fonts: InspectionFont[];
  /** True when at least one element carries imported geometry to repair with. */
  hasOriginData: boolean;
  /** Content bounding box in mm, page 1 (null when the page is empty). */
  contentBounds: { x: number; y: number; w: number; h: number } | null;
  problems: ImportProblem[];
}

export function inspectProject(project: Project, options: RepairOptions = {}): ImportInspection {
  const fonts = new Map<string, number>();
  let elements = 0;
  let groups = 0;
  let texts = 0;
  let images = 0;
  let shapes = 0;
  let tables = 0;
  let svgs = 0;
  let other = 0;
  let hidden = 0;
  let hasOriginData = false;

  const walk = (els: CanvasEl[]): void => {
    for (const el of els) {
      elements += 1;
      if (el.hidden) hidden += 1;
      if (el.source?.origin) hasOriginData = true;
      switch (el.type) {
        case "group":
          groups += 1;
          break;
        case "text":
        case "box":
        case "stat":
          texts += 1;
          if (el.style.fontFamily) {
            fonts.set(el.style.fontFamily, (fonts.get(el.style.fontFamily) || 0) + 1);
          }
          break;
        case "image":
        case "logo":
          images += 1;
          break;
        case "shape":
        case "line":
        case "divider":
          shapes += 1;
          break;
        case "table":
          tables += 1;
          break;
        case "svg":
          svgs += 1;
          break;
        default:
          other += 1;
      }
      if (el.children?.length) walk(el.children);
    }
  };

  const pages: InspectionPage[] = [];
  let contentBounds: ImportInspection["contentBounds"] = null;
  project.pages.forEach((page, index) => {
    walk(page.elements);
    const { w, h } = pageSize(page);
    pages.push({ name: page.name || `صفحة ${index + 1}`, w, h, elements: page.elements.length });
    if (index === 0) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      const box = (els: CanvasEl[], dx: number, dy: number): void => {
        for (const el of els) {
          if (el.hidden) continue;
          minX = Math.min(minX, el.x + dx);
          minY = Math.min(minY, el.y + dy);
          maxX = Math.max(maxX, el.x + dx + el.w);
          maxY = Math.max(maxY, el.y + dy + el.h);
          if (el.children?.length) box(el.children, el.x + dx, el.y + dy);
        }
      };
      box(page.elements, 0, 0);
      if (Number.isFinite(minX)) {
        contentBounds = {
          x: Math.round(minX * 10) / 10,
          y: Math.round(minY * 10) / 10,
          w: Math.round((maxX - minX) * 10) / 10,
          h: Math.round((maxY - minY) * 10) / 10,
        };
      }
    }
  });

  return {
    pages,
    elements,
    groups,
    texts,
    images,
    shapes,
    tables,
    svgs,
    other,
    hidden,
    fonts: [...fonts.entries()]
      .map(([family, count]) => ({ family, elements: count }))
      .sort((a, b) => b.elements - a.elements || a.family.localeCompare(b.family)),
    hasOriginData,
    contentBounds,
    problems: detectImportProblems(project, options),
  };
}
