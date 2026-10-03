#!/usr/bin/env node
/** Focused real-browser regression. Requires a running dev server and agent-browser.
 * AGENT_BROWSER=/path/to/agent-browser node scripts/test-editor-workspace.mjs
 * Browser executable/connection may be configured in agent-browser itself.
 * Only the browser's disposable local project is changed; no server project is used.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";

const cli = process.env.AGENT_BROWSER || "agent-browser";
// Never reuse an author's browser profile when seeding disposable test artwork.
const session = process.env.EDITOR_TEST_SESSION || "nasaq-workspace-qa";
const base = process.env.EDITOR_TEST_URL || "http://127.0.0.1:8080/editor";
const out = "screenshots/editor-focused";
mkdirSync(out, { recursive: true });
const results = [];
function browser(...args) {
  const result = JSON.parse(
    execFileSync(cli, ["--session", session, "--json", ...args], {
      encoding: "utf8",
      timeout: 30000,
    }),
  );
  if (!result.success) throw new Error(JSON.stringify(result));
  return result.data;
}
const evaluate = (js) => browser("eval", js).result;
const state = (body) =>
  evaluate(
    `(async()=>{const url=performance.getEntriesByType("resource").find(x=>/\\/src\\/lib\\/editor\\/store.ts/.test(x.name))?.name;if(!url)throw Error("Dev store module not found");const {useEditor}=await import(url);const s=useEditor.getState();${body}})()`,
  );
const settle = () =>
  evaluate(
    "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
  );
function check(name, run) {
  run();
  results.push(name);
  console.log(`PASS ${name}`);
}
const click = (selector) => {
  browser("click", selector);
  settle();
};
const key = (key) => {
  evaluate("document.activeElement?.blur()");
  browser("press", key);
  settle();
};
const sizes = () =>
  evaluate(
    `[".editor-toolbar",".editor-page-rail",".studio-tool-dock"].map(sel=>{const r=document.querySelector(sel).getBoundingClientRect();return [r.width,r.height]})`,
  );
const ids = () => state("return s.selectedIds");
const geometry = () =>
  state("return JSON.stringify(s.pages.map(p=>p.elements))");
const menuItem = (text) => {
  browser(
    "find",
    "role",
    ["داكن", "فاتح"].includes(text) ? "radio" : "menuitem",
    "click",
    "--name",
    text,
    "--exact",
  );
  settle();
};

browser("errors", "--clear");
browser("open", base);
browser("wait", ".report-page");
evaluate("new Promise(r=>setTimeout(r,500))");
browser("set", "viewport", "1440", "1000");
evaluate('localStorage.setItem("nasaq.onboarding.v1", "done")');
// Dismiss the existing tour if this is a new disposable browser profile.
evaluate(
  '[...document.querySelectorAll("button")].find(x=>x.textContent.includes("تخطي الجولة"))?.click()',
);
state(`const el=(id,x,y)=>({id,name:id,type:"shape",x,y,w:20,h:15,z:1,rotation:0,opacity:1,style:{fill:"#658498",shapeId:"rect"}});
useEditor.setState({pages:[{id:"qa-p1",name:"لوحة أولى",w:210,h:297,bg:"#ffffff",elements:[el("qa-a",20,30),el("qa-b",70,60),el("qa-c",135,100)]},{id:"qa-p2",name:"لوحة ثانية",w:100,h:120,bg:"#fff5e8",elements:[]},{id:"qa-p3",name:"لوحة ثالثة",w:210,h:297,bg:"#ffffff",elements:[]}],activePageId:"qa-p1",selectedIds:[],selectedId:null,enteredGroupId:null,editingId:null,previewAll:true,artboardGridCols:2,leftOpen:true,rightOpen:true,bubbleEnabled:false,zoom:.5});s.commit();`);
settle();
check("RTL page order without mirroring document geometry", () => {
  const [a, b] = evaluate(
    '[...document.querySelectorAll(".report-page")].map(x=>x.getBoundingClientRect().x)',
  );
  assert.ok(a > b);
  assert.equal(
    evaluate(
      'getComputedStyle(document.querySelector(".page-frame-content")).direction',
    ),
    "ltr",
  );
});
key("Control+a");
check("Ctrl+A selects all artwork, not artboard labels", () =>
  assert.deepEqual(ids(), ["qa-a", "qa-b", "qa-c"]),
);
const selected = ids();
click('button[aria-label="المحاذاة والتوزيع (Alignment & Distribution)"]');
menuItem("محاذاة للأعلى");
check("Align preserves multi-selection and actual alignment", () => {
  assert.deepEqual(ids(), selected);
  assert.equal(
    new Set(state("return s.pages[0].elements.map(e=>e.y)")).size,
    1,
  );
});
// The existing alignment menu stays open for repeated operations.
menuItem("توزيع أفقي متساوٍ");
check("Distribute preserves selection and equal spacing", () => {
  assert.deepEqual(ids(), selected);
  const xs = state("return s.pages[0].elements.map(e=>e.x)");
  assert.ok(Math.abs(xs[1] - xs[0] - (xs[2] - xs[1])) < 0.02);
});
click('button[aria-label="المحاذاة والتوزيع (Alignment & Distribution)"]');
const before = geometry(),
  chrome = sizes();
for (const zoom of [0.2, 0.4, 1, 2]) {
  state(`s.setZoom(${zoom})`);
  settle();
  check(
    `Zoom ${zoom}: constant UI, exact document coordinates and visible handles`,
    () => {
      assert.equal(geometry(), before);
      assert.deepEqual(sizes(), chrome);
      assert.equal(
        evaluate('document.querySelectorAll(".selection-frame").length'),
        3,
      );
      assert.equal(evaluate('document.querySelectorAll(".handle").length'), 8);
      assert.ok(
        evaluate(
          '(()=>{const p=document.querySelector(".report-page").getBoundingClientRect();const c=document.querySelector(".artboard-cell").getBoundingClientRect();return Math.abs(c.height-p.height-36)<1})()',
        ),
      );
    },
  );
}
key("Control+0");
check("Fit Artboard keeps selection and includes the name", () => {
  assert.deepEqual(ids(), selected);
  assert.ok(
    evaluate(
      '(()=>{const s=document.querySelector(".editor-canvas-stage").getBoundingClientRect(),p=document.querySelector(".artboard-cell").getBoundingClientRect();return p.top>=s.top-1&&p.bottom<=s.bottom+1&&p.left>=s.left-1&&p.right<=s.right+1})()',
    ),
  );
});
const zoomBefore = state("return s.zoom");
key("Control+=");
check("keyboard zoom affects canvas only", () => {
  assert.ok(state("return s.zoom") > zoomBefore);
  assert.equal(geometry(), before);
});
key("Meta+a");
check("macOS Cmd+A matches Ctrl+A", () => assert.deepEqual(ids(), selected));
state("s.select(null)");
evaluate(
  'window.dispatchEvent(new KeyboardEvent("keydown",{key:"ش",code:"KeyA",ctrlKey:true,bubbles:true,cancelable:true}))',
);
check("Arabic physical-key Ctrl+A remains bound", () =>
  assert.deepEqual(ids(), selected),
);
key("Control+0");
click(".artboard-cell:first-child .artboard-name");
check("artboard name selects independently of contents", () =>
  assert.equal(ids().length, 0),
);
browser("dblclick", ".artboard-cell:first-child .artboard-name");
browser("fill", '[aria-label="اسم لوحة الرسم"]', "لوحة عربية طويلة للاختبار");
browser("press", "Enter");
settle();
check("renaming does not mutate elements", () =>
  assert.equal(geometry(), before),
);
click('button[aria-label="عرض"]');
menuItem("مظهر المحرر…");
check("appearance accessible without sign-in; one exclusive choice", () =>
  assert.equal(
    evaluate(
      'document.querySelectorAll("[role=radio][aria-checked=true]").length',
    ),
    1,
  ),
);
const pageColors = state("return s.pages.map(p=>p.bg)");
for (const mode of ["داكن", "فاتح"]) {
  menuItem(mode);
  check(`${mode}: synchronized theme and unchanged design`, () => {
    assert.equal(state("return s.dark"), mode === "داكن");
    assert.equal(
      evaluate('document.documentElement.classList.contains("dark")'),
      mode === "داكن",
    );
    assert.deepEqual(state("return s.pages.map(p=>p.bg)"), pageColors);
    assert.equal(geometry(), before);
    assert.equal(
      evaluate(
        'document.querySelectorAll("[role=radio][aria-checked=true]").length',
      ),
      1,
    );
  });
}
click('[aria-label="إغلاق الإعدادات"]');
key("Control+k");
browser("fill", ".editor-command-menu input", "تبديل المظهر");
browser("press", "Enter");
settle();
check("appearance command reachable through existing Cmd/Ctrl+K", () =>
  assert.equal(state("return s.dark"), true),
);
key("Control+a");
key("Control+g");
check("Group preserves children", () =>
  assert.equal(state("return s.pages[0].elements[0].children.length"), 3),
);
state("s.enterGroup(s.selectedId)");
key("Control+a");
check("Select All within a group selects children", () =>
  assert.equal(ids().length, 3),
);
state("s.enterGroup(null);s.select(s.pages[0].elements[0].id)");
key("Control+Shift+g");
check("Ungroup restores elements", () =>
  assert.equal(state("return s.pages[0].elements.length"), 3),
);
state('s.select("qa-a");s.toggleLock()');
key("Control+a");
check("Select All excludes locked elements", () =>
  assert.equal(ids().length, 2),
);
click('.editor-page-rail button[aria-label="لوحة ثانية 2"]');
check(
  "page switching clears old selection and exposes requested artboard",
  () => {
    assert.equal(state("return s.activePageId"), "qa-p2");
    assert.equal(ids().length, 0);
  },
);
click('.editor-page-rail button[aria-label="لوحة عربية طويلة للاختبار 1"]');
key("Control+0");
const originalName = state("return s.name");
browser("fill", '[aria-label="اسم المشروع"]', "vtr");
browser("press", "Control+a");
check("typing fields keep native selection, not canvas shortcuts", () =>
  assert.equal(ids().length, 0),
);
browser("fill", '[aria-label="اسم المشروع"]', originalName);
evaluate("document.activeElement.blur()");
state('s.updateElement("qa-c",{w:1,h:1},true);s.select("qa-c");s.setZoom(.2)');
settle();
check("tiny selected objects retain exact bounds at 20%", () => {
  const size = state('return s.pages[0].elements.find(e=>e.id==="qa-c").w');
  assert.ok(
    evaluate(
      `(()=>{const r=document.querySelector(".selection-frame").getBoundingClientRect();return Math.abs(r.width-${size}*96/25.4*.2)<.1&&Math.abs(r.height-${size}*96/25.4*.2)<.1})()`,
    ),
  );
});
state('s.updateElement("qa-c",{w:20,h:15},true);s.select(null)');
key("Control+0");
state('s.select("qa-a");s.toggleLock();s.select(null);s.setDark(false)');
settle();
// Native mouse drag, through the same pointer owner used by touch.
state('s.selectMany(["qa-a","qa-b","qa-c"]);s.commit()');
key("Control+0");
const dragBefore = geometry();
const dragPoint = evaluate(
  '(()=>{const r=document.querySelector(".canvas-el[data-el-id=qa-b]").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()',
);
browser(
  "mouse",
  "move",
  String(Math.round(dragPoint.x)),
  String(Math.round(dragPoint.y)),
);
browser("mouse", "down");
browser(
  "mouse",
  "move",
  String(Math.round(dragPoint.x + 24)),
  String(Math.round(dragPoint.y + 18)),
);
browser("mouse", "up");
settle();
check("mouse drag moves the multi-selection together", () => {
  assert.equal(ids().length, 3);
  assert.notEqual(geometry(), dragBefore);
  const els = state("return s.pages[0].elements");
  assert.ok(Math.abs(els[1].x - els[0].x - 57.5) < 0.1);
});
key("Control+z");
check("Undo restores a multi-element drag in one step", () =>
  assert.equal(geometry(), dragBefore),
);
state("s.select(null)");
settle();
browser("screenshot", `${out}/desktop-light.png`);
state("s.setDark(true)");
settle();
browser("screenshot", `${out}/desktop-dark.png`);

const railHeight = evaluate(
  'document.querySelector(".editor-page-rail").getBoundingClientRect().height',
);
state(
  'useEditor.setState({pages:[...s.pages,...Array.from({length:27},(_,i)=>({id:"many-"+i,name:"صفحة "+(i+4),w:210,h:297,bg:"#fff",elements:[]}))]});s.setActivePage("many-26")',
);
settle();
check("30 pages stay one compact scrollable row", () => {
  assert.equal(
    evaluate(
      'document.querySelector(".editor-page-rail").getBoundingClientRect().height',
    ),
    railHeight,
  );
  assert.ok(
    evaluate(
      '(()=>{const ul=document.querySelector(".editor-page-rail ul");return ul.scrollWidth>ul.clientWidth})()',
    ),
  );
  assert.ok(
    evaluate(
      '(()=>{const ul=document.querySelector(".editor-page-rail ul").getBoundingClientRect(),r=document.querySelector(".page-rail-item.is-active").getBoundingClientRect();return r.left>=ul.left-1&&r.right<=ul.right+1})()',
    ),
  );
});
state('useEditor.setState({pages:s.pages.slice(0,3),activePageId:"qa-p1"})');
settle();

// Native Chromium touch emulation, shared with the CLI-controlled page.
const { cdpUrl } = browser("get", "cdp-url");
const socket = new WebSocket(cdpUrl);
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});
let seq = 0;
const pending = new Map();
socket.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (pending.has(m.id)) {
    const [resolve, reject] = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) reject(new Error(JSON.stringify(m.error)));
    else resolve(m.result);
  }
};
const cdp = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, [resolve, reject]);
    socket.send(
      JSON.stringify({
        id,
        method,
        params,
        ...(sessionId ? { sessionId } : {}),
      }),
    );
  });
const { targetInfos } = await cdp("Target.getTargets");
const target = targetInfos.find((t) => t.type === "page" && t.url === base);
const { sessionId } = await cdp("Target.attachToTarget", {
  targetId: target.targetId,
  flatten: true,
});
await cdp(
  "Emulation.setTouchEmulationEnabled",
  { enabled: true, maxTouchPoints: 5 },
  sessionId,
);
settle();
check("native coarse-pointer emulation is active", () =>
  assert.equal(evaluate('matchMedia("(any-pointer:coarse)").matches'), true),
);
for (const [w, h] of [
  [768, 1024],
  [820, 1180],
  [1024, 768],
  [1180, 820],
  [1366, 1024],
]) {
  browser("set", "viewport", String(w), String(h));
  settle();
  state("s.closeFloatingPanels();s.select(null)");
  key("Control+0");
  check(`iPad ${w}x${h}: compact rail and bounded workspace`, () => {
    assert.ok(evaluate("document.documentElement.scrollWidth<=innerWidth"));
    assert.ok(
      evaluate(
        'document.querySelector(".editor-page-rail").getBoundingClientRect().height<=144',
      ),
    );
    assert.ok(
      evaluate(
        '[...document.querySelectorAll(".page-rail-actions button")].every(b=>b.getBoundingClientRect().width>=44)',
      ),
    );
  });
  state('s.setLeftTab("pages");useEditor.setState({leftCollapsed:false})');
  settle();
  evaluate("new Promise(r=>setTimeout(r,250))");
  check(`iPad ${w}x${h}: tabs and close button remain reachable`, () => {
    assert.ok(
      evaluate(
        '(()=>{const b=document.querySelector(".editor-panel-collapse"),r=b.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()',
      ),
    );
    assert.ok(
      evaluate(
        '[...document.querySelectorAll(".editor-panel-tabs [role=tab]")].every(b=>b.getBoundingClientRect().width>=44)',
      ),
    );
  });
  browser("screenshot", `${out}/ipad-${w}x${h}.png`);
  click('[aria-label="طي لوحة العناصر"]');
  state('s.setRightTab("layers")');
  settle();
  check(`iPad ${w}x${h}: touch properties open above canvas`, () => {
    assert.ok(
      evaluate(
        '(()=>{const b=document.querySelector(".touch-properties-sheet"),r=b.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth})()',
      ),
    );
  });
  click('[aria-label="إغلاق لوحة الخصائص"]');
}
browser("set", "viewport", "820", "1180");
evaluate("new Promise(r=>setTimeout(r,400))");
state('s.setActivePage("qa-p1");s.select(null)');
key("Control+0");
evaluate("new Promise(r=>setTimeout(r,350))");
const center = evaluate(
  '(()=>{const r=document.querySelector(".canvas-el[data-el-id=qa-b]").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()',
);
evaluate(
  'window.touchTrace=[];["pointerdown","pointerup","pointercancel"].forEach(type=>document.addEventListener(type,e=>window.touchTrace.push({type,x:e.clientX,y:e.clientY,target:e.target.outerHTML.slice(0,200)}),true))',
);
const touch = (type, points) =>
  cdp("Input.dispatchTouchEvent", { type, touchPoints: points }, sessionId);
await touch("touchStart", [
  { id: 1, ...center, radiusX: 4, radiusY: 4, force: 1 },
]);
await new Promise((r) => setTimeout(r, 90));
await touch("touchEnd", []);
settle();
check("native touch selects an element", () =>
  assert.ok(
    ids().includes("qa-b"),
    JSON.stringify({
      center,
      trace: evaluate("window.touchTrace"),
      ids: ids(),
    }),
  ),
);
const beforePinch = geometry(),
  prev = state("return s.zoom");
await touch("touchStart", [
  { id: 1, x: 350, y: 400 },
  { id: 2, x: 450, y: 400 },
]);
await touch("touchMove", [
  { id: 1, x: 320, y: 400 },
  { id: 2, x: 480, y: 400 },
]);
settle();
await touch("touchEnd", []);
settle();
check("native two-finger pinch zooms canvas, not document geometry", () => {
  assert.ok(state("return s.zoom") > prev);
  assert.equal(geometry(), beforePinch);
});
socket.close();
check("no uncaught browser errors", () =>
  assert.deepEqual(browser("errors").errors, []),
);
writeFileSync(
  `${out}/results.json`,
  JSON.stringify({ passed: results.length, checks: results }, null, 2),
);
console.log(`${results.length} browser checks passed`);
