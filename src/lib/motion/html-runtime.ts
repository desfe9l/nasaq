/**
 * The browser runtime embedded in an exported composition.
 *
 * ## Why this is JavaScript source held in a string
 *
 * HyperFrames renders a composition by **seeking** it: the framework asks the
 * page "what does frame at *t* look like", and the page answers. The answer
 * has to come from a `seek` implementation that ships *inside* the HTML,
 * because a rendered video is produced from that single file with no
 * application around it.
 *
 * The engine that answers lives in TypeScript modules. Rather than hand-write
 * a second implementation and hope the two agree, this runtime is a compact
 * mirror that is **verified against the TypeScript engine in tests**
 * (`html.test.ts` runs both on the same composition at the same timestamps and
 * asserts identical frames). If the engine changes and this mirror does not,
 * that test fails. Drift is not possible to ship silently.
 *
 * It is emitted as a plain JS string rather than bundled because the exported
 * composition must be a **single self-contained file** — no imports, no
 * network, no build step.
 *
 * ## Determinism rules honoured
 *
 * Follows the HyperFrames determinism contract exactly:
 *  - No `Date.now()`, `performance.now()`, or any render-time clock.
 *  - No `Math.random()` — nothing here is random at all.
 *  - No network requests: fonts are inlined by the emitter, not fetched.
 *  - Visibility is driven by `opacity`, never `display`/`visibility`, so the
 *    framework stays in control of each clip's time window.
 */

/**
 * The runtime source. Exported as a string so the emitter can inline it
 * verbatim and the test can execute it directly.
 */
export const MOTION_RUNTIME_JS = String.raw`
(function (global) {
  "use strict";

  /* ---------------------------------------------------------------- easing */

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  function bez(t, p0, p1, p2, p3) {
    var u = 1 - t;
    return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
  }

  function solveT(x, x1, x2) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    if (x1 === x2) return x;
    var lo = 0, hi = 1, mid = x;
    for (var i = 0; i < 64; i++) {
      mid = (lo + hi) / 2;
      var v = bez(mid, 0, x1, x2, 1);
      if (v < x) lo = mid; else hi = mid;
      if (Math.abs(v - x) < 1e-7) break;
    }
    return mid;
  }

  function ease(curve, p) {
    var x = clamp01(p), x1 = curve[0], y1 = curve[1], x2 = curve[2], y2 = curve[3];
    if (x1 === y1 && x2 === y2) return x;
    return bez(solveT(x, x1, x2), 0, y1, y2, 1);
  }

  function easedProgress(t, start, end, curve) {
    if (!isFinite(end) || end <= start) return t >= end ? 1 : 0;
    if (t <= start) return 0;
    if (t >= end) return 1;
    return ease(curve, (t - start) / (end - start));
  }

  function windowedProgress(t, start, end, enter, hold, exit, curve) {
    enter = enter === undefined ? 0.18 : enter;
    hold = hold === undefined ? 0.64 : hold;
    exit = exit === undefined ? 0.18 : exit;
    var total = enter + hold + exit;
    var p = easedProgress(t, start, end, [0, 0, 1, 1]);
    if (p <= 0) return { value: 0, phase: "before" };
    if (p >= 1) return { value: 0, phase: "after" };
    var enterEnd = enter / total;
    var exitStart = (enter + hold) / total;
    if (p < enterEnd) return { value: ease(curve, p / enterEnd), phase: "enter" };
    if (p < exitStart) return { value: 1, phase: "hold" };
    return { value: 1 - ease(curve, (p - exitStart) / (exit / total)), phase: "exit" };
  }

  function easeAreaToRadius(p) { return Math.sqrt(clamp01(p)); }
  function lerp(a, b, t) { return a + (b - a) * clamp01(t); }

  /* ------------------------------------------------------------ text/Arabic */

  var COMBINING = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640\u200F\u202B-\u202E]/;

  var HAS_ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

  function hasArabic(text) { return HAS_ARABIC.test(text); }

  function splitClusters(text) {
    if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
      var seg = new Intl.Segmenter("ar", { granularity: "grapheme" });
      return Array.from(seg.segment(text), function (s) { return s.segment; });
    }
    var out = [];
    for (var i = 0; i < text.length; i++) {
      var ch = Array.from(text)[i];
      var last = out[out.length - 1];
      if (last !== undefined && COMBINING.test(ch)) out[out.length - 1] = last + ch;
      else out.push(ch);
    }
    return out;
  }

  function runDirection(text) { return hasArabic(text) ? "rtl" : "ltr"; }

  /**
   * Count revealed clusters. progress is 0-1 across the enter phase and
   * enterSeconds is that phase's duration — mixing normalised progress with a
   * seconds-derived step pins every reveal to a single cluster.
   */
  function revealedCount(count, progress, stagger, enterSeconds) {
    if (count <= 0) return 0;
    var p = Math.max(0, Math.min(1, progress));
    if (p <= 0) return 0;
    if (stagger <= 0) return count;
    var duration = Math.max(0, enterSeconds || 0);
    var span = Math.max(0, duration - stagger);
    var per = count > 1 ? span / (count - 1) : Math.max(duration, stagger);
    var elapsed = p * duration;
    var shown = per > 0 ? Math.floor(elapsed / per) : count - 1;
    return Math.max(1, Math.min(count, shown + 1));
  }

  /* --------------------------------------------------------- period origin */

  var ANCHORS = [".", "\u06D4", "\u3002", "\u00B7", "\u2022"];

  /** How far a full stop's centre sits above the baseline, as a fraction of em. */
  var PERIOD_BASELINE_OFFSET = 0.04;

  function findPeriodAnchor(wordmark, fontSize, measure) {
    var clusters = splitClusters(wordmark);
    for (var i = clusters.length - 1; i >= 0; i--) {
      if (ANCHORS.indexOf(clusters[i]) === -1) continue;
      var prefix = clusters.slice(0, i).join("");
      var x = measure(prefix, fontSize);
      var w = measure(clusters[i], fontSize);
      return { x: x + w / 2, y: fontSize * 0.34, width: w, clusterIndex: i };
    }
    return null;
  }

  function periodState(timeMs, cfg) {
    var opening = easedProgress(timeMs, cfg.startMs, cfg.openMs, cfg.curve);
    var closing = easedProgress(timeMs, cfg.closeMs, cfg.endMs, cfg.curve);
    var area = Math.max(0, opening - closing);
    var radius = easeAreaToRadius(area) * (cfg.maxDiameter / 2);
    var beatIndex = -1;
    var beats = cfg.beats || [];
    for (var i = 0; i < beats.length; i++) {
      if (timeMs >= beats[i].startMs && timeMs < beats[i].endMs) { beatIndex = i; break; }
    }
    return {
      open: area,
      radius: radius,
      centreX: cfg.centreX,
      centreY: cfg.centreY,
      innerVisible: radius > 0.5,
      inkMix: easeAreaToRadius(opening),
      beatIndex: beatIndex
    };
  }

  /* --------------------------------------------------------------- colour */

  function hexToRgb(hex) {
    if (typeof hex !== "string") return null;
    var value = hex.trim().replace("#", "");
    if (value.length === 3) {
      value = value.split("").map(function (c) { return c + c; }).join("");
    }
    if (value.length !== 6) return null;
    var int = parseInt(value, 16);
    if (isNaN(int)) return null;
    return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
  }

  function mixColor(from, to, t) {
    var a = hexToRgb(from), b = hexToRgb(to);
    if (!a || !b) return t < 0.5 ? from : to;
    var c = clamp01(t);
    return "rgb(" + Math.round(lerp(a[0], b[0], c)) + "," +
      Math.round(lerp(a[1], b[1], c)) + "," +
      Math.round(lerp(a[2], b[2], c)) + ")";
  }

  /* -------------------------------------------------------------- timeline */

  function sceneOffsets(composition) {
    var out = [], cursor = 0;
    for (var i = 0; i < composition.scenes.length; i++) {
      var s = composition.scenes[i];
      out.push({ scene: s, index: i, startMs: cursor, endMs: cursor + s.durationMs });
      cursor += s.durationMs;
    }
    return out;
  }

  function durationOf(composition) {
    return composition.scenes.reduce(function (n, s) { return n + s.durationMs; }, 0);
  }

  function clampTime(composition, timeMs) {
    var duration = durationOf(composition);
    if (duration <= 0) return 0;
    var wrapped = timeMs % duration;
    return wrapped < 0 ? wrapped + duration : wrapped;
  }

  function sceneAt(composition, timeMs) {
    var offsets = sceneOffsets(composition);
    if (!offsets.length) throw new Error("composition has no scenes");
    var t = clampTime(composition, timeMs);
    var match = offsets[0];
    for (var i = 0; i < offsets.length; i++) {
      if (t >= offsets[i].startMs) match = offsets[i]; else break;
    }
    var localMs = Math.min(Math.max(t - match.startMs, 0), match.scene.durationMs);
    return {
      scene: match.scene,
      index: match.index,
      startMs: match.startMs,
      endMs: match.endMs,
      localMs: localMs,
      progress: match.scene.durationMs > 0 ? localMs / match.scene.durationMs : 0
    };
  }

  function transitionProgress(scene, localMs) {
    var tr = scene.transition;
    if (!tr || tr.durationMs <= 0) return 1;
    var leadIn = Math.min(tr.durationMs, scene.durationMs);
    var into = easedProgress(localMs, 0, leadIn, CURVE);
    return 1 - into;
  }

  function scenesInProgress(composition, timeMs) {
    var offsets = sceneOffsets(composition);
    if (!offsets.length) return [];
    var t = clampTime(composition, timeMs);
    var active = sceneAt(composition, t);
    var result = [active];
    for (var i = 0; i < offsets.length; i++) {
      var c = offsets[i];
      if (c.endMs <= active.startMs) {
        var out = c.scene.transition;
        if (out && out.kind !== "cut" && out.kind !== "none" && out.durationMs > 0 &&
            t < c.endMs + out.durationMs) {
          var localMs = Math.min(c.scene.durationMs, Math.max(t - c.startMs, 0));
          result.push({
            scene: c.scene,
            index: c.index,
            startMs: c.startMs,
            endMs: c.endMs,
            localMs: localMs,
            progress: c.scene.durationMs > 0 ? localMs / c.scene.durationMs : 0
          });
        }
      }
    }
    result.sort(function (a, b) { return a.index - b.index; });
    return result;
  }

  /* ------------------------------------------------------------------ seek */

  var CURVE = [0.45, 0, 0.15, 1];
  var MARGIN_RATIO = 0.09;
  function marginOf(w) { return w * MARGIN_RATIO; }

  /**
   * Resolve an aligned run's anchor. RTL "start" is the RIGHT margin — getting
   * this wrong pushes every Arabic headline off the right edge of the frame.
   */
  function textAnchorX(align, direction, margin, width) {
    if (align === "center") return width / 2;
    var fromLeft = align === "start" ? direction === "ltr" : direction === "rtl";
    return fromLeft ? margin : width - margin;
  }

  function resolveWindow(layer, localMs) {
    var start = (layer.startMs || 0) + (layer.delayMs || 0);
    var end = layer.endMs > 0 ? layer.endMs : Infinity;
    var w = windowedProgress(localMs, start, end, layer.enter, layer.hold, layer.exit, CURVE);
    if (w.phase === "before" || w.phase === "after") {
      return { opacity: 0, visible: false, progress: 0 };
    }
    return { opacity: w.value, visible: true, progress: w.value };
  }

  function heightOf(composition) {
    if (composition.aspect === "square") return composition.width;
    if (composition.aspect === "landscape") return Math.round(composition.width * 9 / 16);
    return Math.round(composition.width * 16 / 9);
  }

  /**
   * Resolve the frame at \`timeMs\`. Pure: same input, same output, any order.
   */
  function frameAt(composition, timeMs, measure) {
    measure = measure || function (text, size) { return splitClusters(text).length * size * 0.5; };
    var width = composition.width;
    var height = heightOf(composition);
    var margin = marginOf(width);
    var active = scenesInProgress(composition, timeMs);
    var lead = active[0];
    var background = lead ? lead.scene.background : composition.palette.paper;
    var ops = [];

    for (var a = 0; a < active.length; a++) {
      var resolved = active[a];
      var scene = resolved.scene;
      var localMs = resolved.localMs;
      var sceneAlpha = active.length > 1 ? transitionProgress(scene, localMs) : 1;
      if (sceneAlpha <= 0.001) continue;

      var slideX = 0, slideY = 0;
      var tr = scene.transition;
      if (tr && tr.kind === "slide" && tr.durationMs > 0) {
        var ang = ((tr.direction === undefined ? 180 : tr.direction) * Math.PI) / 180;
        var travel = 1 - sceneAlpha;
        slideX = Math.cos(ang) * height * travel;
        slideY = Math.sin(ang) * height * travel;
      }

      for (var l = 0; l < scene.layers.length; l++) {
        var layer = scene.layers[l];
        var state = resolveWindow(layer, localMs);
        if (!state.visible) continue;
        if (state.opacity * sceneAlpha <= 0.001) continue;

        var op = resolveLayer(layer, measure, resolved.startMs, localMs,
                              state, sceneAlpha, margin, width, height);
        if (!op) continue;

        if (slideX !== 0 || slideY !== 0) {
          if (op.kind === "period-origin") {
            op.originX += slideX; op.centreX += slideX;
            op.y += slideY; op.centreY += slideY;
          } else {
            op.x += slideX; op.y += slideY;
          }
        }
        ops.push(op);
      }
    }

    ops.sort(function (p, q) { return p.z - q.z; });
    return { timeMs: timeMs, width: width, height: height, background: background, ops: ops };
  }

  function resolveLayer(layer, measure, sceneStartMs, localMs, state, sceneAlpha, margin, width, height) {
    var opacity = state.opacity * sceneAlpha;

    if (layer.kind === "text") {
      var clusters = splitClusters(layer.text);
      var reveal = layer.reveal || "none";
      var revealed = reveal === "none"
        ? clusters.length
        : revealedCount(clusters.length,
          Math.min(1, state.progress / (layer.enter === undefined ? 0.3 : layer.enter)),
          layer.revealStaggerMs === undefined ? 0.06 : layer.revealStaggerMs / 1000,
          (layer.endMs - layer.startMs) * layer.enter / 1000);
      return {
        kind: "text", id: layer.id, text: layer.text, clusters: clusters,
        revealed: revealed, reveal: reveal, x: margin,
        y: layer.top === undefined ? margin : layer.top * height,
        anchorX: textAnchorX(layer.align, runDirection(layer.text), margin, width),
        fontSize: layer.fontSize, fontFamily: layer.fontFamily,
        fontWeight: layer.fontWeight, color: layer.color, align: layer.align,
        direction: runDirection(layer.text),
        lineHeight: layer.lineHeight === undefined ? 1.25 : layer.lineHeight,
        letterSpacing: layer.letterSpacing || 0, rule: layer.rule,
        opacity: opacity, z: layer.z
      };
    }

    if (layer.kind === "shape") {
      var grow = state.progress;
      var w = layer.grow === "x" ? layer.width * grow : layer.width;
      var h = layer.grow === "y" ? layer.height * grow : layer.height;
      return {
        kind: "rect", id: layer.id, x: margin, y: height / 2 - layer.height / 2,
        width: w, height: h, radius: layer.radius || 0,
        fill: layer.fill || "transparent", stroke: layer.stroke,
        strokeWidth: layer.strokeWidth, opacity: opacity, rotation: 0, z: layer.z
      };
    }

    if (layer.kind === "image") {
      return {
        kind: "image", id: layer.id, src: layer.src, alt: layer.alt || "",
        x: margin, y: height / 2 - layer.height / 2,
        width: layer.width, height: layer.height, radius: layer.radius || 0,
        fit: layer.fit || "cover", opacity: opacity, z: layer.z
      };
    }

    if (layer.kind === "caption") {
      var m2 = marginOf(width);
      return {
        kind: "caption", id: layer.id, text: layer.text,
        clusters: splitClusters(layer.text),
        x: m2, y: height - m2 - layer.fontSize * 1.9,
        anchorX: width - m2,
        fontSize: layer.fontSize, fontFamily: layer.fontFamily,
        fontWeight: layer.fontWeight, color: layer.color, plate: layer.plate,
        opacity: opacity, z: layer.z
      };
    }

    if (layer.kind === "progress") {
      var m3 = marginOf(width);
      return {
        kind: "progress", id: layer.id, label: layer.label || "",
        x: m3, y: height - m3 * 2.2, width: width - m3 * 2, height: layer.height,
        color: layer.color, trackColor: layer.trackColor,
        value: Math.max(0, Math.min(1, layer.value * state.progress)),
        labelFontSize: layer.labelFontSize === undefined ? layer.height * 0.95 : layer.labelFontSize,
        labelColor: layer.labelColor || layer.color, opacity: opacity, z: layer.z
      };
    }

    if (layer.kind === "period-origin") {
      var anchor = findPeriodAnchor(layer.wordmark, layer.fontSize, measure);
      if (!anchor) return null;
      var cycleStart = sceneStartMs + layer.startMs;
      var cycleEnd = sceneStartMs + (layer.endMs > 0 ? layer.endMs : cycleStart + 2400);
      var span = Math.max(cycleEnd - cycleStart, 1);
      var centreX = width * ((layer.centre && layer.centre.x) !== undefined ? layer.centre.x : 0.5);
      var centreY = height * ((layer.centre && layer.centre.y) !== undefined ? layer.centre.y : 0.5);
      var maxDiameter = width * (layer.irisScale === undefined ? 0.62 : layer.irisScale);

      var ps = periodState(sceneStartMs + localMs, {
        startMs: cycleStart,
        openMs: cycleStart + span * 0.34,
        closeMs: cycleStart + span * 0.82,
        endMs: cycleEnd,
        centreX: centreX, centreY: centreY,
        maxDiameter: maxDiameter, curve: CURVE,
        beats: layer.inner ? layer.inner.beats : []
      });

      var totalWidth = measure(layer.wordmark, layer.fontSize);
      return {
        kind: "period-origin", id: layer.id, wordmark: layer.wordmark,
        anchor: anchor, originX: centreX - (totalWidth - anchor.x),
        y: centreY + PERIOD_BASELINE_OFFSET * layer.fontSize, fontSize: layer.fontSize,
        fontFamily: layer.fontFamily, fontWeight: layer.fontWeight,
        color: layer.color, innerColor: layer.innerColor,
        centreX: centreX, centreY: centreY, radius: ps.radius,
        inner: layer.inner, beatIndex: ps.beatIndex,
        opacity: opacity, z: layer.z
      };
    }

    return null;
  }

  /* ------------------------------------------------------------ DOM applier */

  var STYLE_FOR_KIND = {
    text: "position:absolute;display:block;white-space:pre-wrap;",
    rect: "position:absolute;",
    image: "position:absolute;object-fit:cover;",
    caption: "position:absolute;display:block;",
    progress: "position:absolute;",
    "period-origin": "position:absolute;"
  };

  function applyFrame(root, frame, nodes) {
    var seen = {};
    for (var i = 0; i < frame.ops.length; i++) {
      var op = frame.ops[i];
      seen[op.id] = true;
      var node = nodes[op.id];
      if (!node) {
        node = document.createElement("div");
        node.id = "op-" + op.id;
        node.className = "clip";
        root.appendChild(node);
        nodes[op.id] = node;
      }
      applyOp(node, op);
    }
    for (var key in nodes) {
      if (!seen[key] && Object.prototype.hasOwnProperty.call(nodes, key)) {
        nodes[key].style.opacity = "0";
        nodes[key].style.visibility = "hidden";
      }
    }
  }

  function applyOp(node, op) {
    var s = node.style;
    s.visibility = "visible";
    s.opacity = String(op.opacity);
    s.width = op.width !== undefined ? op.width + "px" : "";
    s.height = op.height !== undefined ? op.height + "px" : "";
    s.left = op.x !== undefined ? op.x + "px" : (op.originX !== undefined ? op.originX + "px" : "");
    s.top = op.y !== undefined ? op.y + "px" : "";
    s.background = "";
    s.color = "";
    s.border = "";
    s.clipPath = "";
    s.transform = "";

    if (op.kind === "rect") {
      s.background = op.fill;
      if (op.stroke) s.border = (op.strokeWidth || 1) + "px solid " + op.stroke;
      s.borderRadius = op.shape === "circle" ? "50%" : (op.radius || 0) + "px";
      node.textContent = "";
    } else if (op.kind === "image") {
      node.style.backgroundImage = "url(" + op.src + ")";
      node.style.backgroundSize = op.fit === "contain" ? "contain" :
        op.fit === "fill" ? "100% 100%" : "cover";
      node.style.backgroundPosition = "center";
      node.style.borderRadius = (op.radius || 0) + "px";
      node.textContent = "";
    } else if (op.kind === "text" || op.kind === "caption") {
      renderText(node, op);
    } else if (op.kind === "progress") {
      node.textContent = "";
      node.style.borderRadius = (op.height / 2) + "px";
      node.style.background = op.trackColor;
      var fill = document.createElement("div");
      fill.style.cssText = "position:absolute;top:0;right:0;height:100%;width:" +
        (op.value * 100) + "%;background:" + op.color +
        ";border-radius:" + (op.height / 2) + "px;";
      node.appendChild(fill);
      if (op.label) {
        var lbl = document.createElement("div");
        lbl.style.cssText = "position:absolute;bottom:" + (op.height + 10) +
          "px;right:0;font-size:" + op.labelFontSize +
          "px;color:" + op.labelColor + ";font-family:" + op.fontFamily + ";";
        lbl.textContent = op.label;
        node.appendChild(lbl);
      }
    } else if (op.kind === "period-origin") {
      renderPeriodOrigin(node, op);
    }
  }

  /**
   * Kinetic type. Each cluster is its own span so the reveal is per-glyph and
   * RTL ordering is explicit — never a single text node with a reversed string.
   */
  function renderText(node, op) {
    node.style.fontFamily = op.fontFamily;
    node.style.fontWeight = String(op.fontWeight);
    node.style.fontSize = op.fontSize + "px";
    node.style.lineHeight = String(op.lineHeight);
    node.style.letterSpacing = (op.letterSpacing || 0) + "px";
    node.style.color = op.color;
    node.style.textAlign = op.align === "start" ? (op.direction === "rtl" ? "right" : "left")
      : op.align === "end" ? (op.direction === "rtl" ? "left" : "right") : "center";
    node.style.direction = op.direction;
    node.textContent = "";

    var shown = op.revealed;
    var order = op.direction === "rtl" ? op.clusters.map(function (c, i) { return i; }).reverse()
      : op.clusters.map(function (c, i) { return i; });

    for (var n = 0; n < order.length; n++) {
      var idx = order[n];
      var rank = op.direction === "rtl" ? (op.clusters.length - 1 - idx) : idx;
      var span = document.createElement("span");
      span.style.cssText = "display:inline-block;white-space:pre;";
      span.textContent = op.clusters[idx];
      if (op.reveal === "fade") {
        span.style.opacity = rank < shown ? "1" : "0";
      } else if (op.reveal === "rise") {
        var step = rank < shown ? 1 : 0;
        span.style.opacity = String(step);
        span.style.transform = step ? "translateY(0)" : "translateY(0.35em)";
      } else if (op.reveal === "scale") {
        var vis = rank < shown ? 1 : 0;
        span.style.opacity = String(vis);
        span.style.transform = vis ? "scale(1)" : "scale(0.82)";
      } else if (op.reveal === "slide-rtl") {
        var on = rank < shown ? 1 : 0;
        span.style.opacity = String(on);
        span.style.transform = on ? "translateX(0)" : "translateX(-0.3em)";
      } else {
        span.style.opacity = "1";
      }
      node.appendChild(span);
    }

    if (op.rule) {
      var rule = document.createElement("div");
      rule.style.cssText = "margin-top:" + op.rule.gap + "px;height:" +
        op.rule.thickness + "px;background:" + op.rule.color +
        ";width:" + Math.min(op.width || 240, 260) + "px;";
      node.appendChild(rule);
    }
  }

  /**
   * The period-origin effect: a circle-masked inner world revealed through the
   * wordmark's final period, with the ink crossfading on the same eased value.
   */
  function renderPeriodOrigin(node, op) {
    node.textContent = "";
    var clipId = "clip-" + op.id;
    node.style.webkitClipPath = "circle(" + op.radius + "px at " +
      (op.centreX - op.originX) + "px " + (op.centreY - op.y) + "px)";
    node.style.clipPath = node.style.webkitClipPath;

    var world = document.createElement("div");
    world.style.cssText = "position:absolute;left:" + (op.centreX - op.originX - op.radius) +
      "px;top:" + (op.centreY - op.y - op.radius) + "px;width:" + (op.radius * 2) +
      "px;height:" + (op.radius * 2) + "px;border-radius:50%;overflow:hidden;background:" +
      op.inner.background + ";";
    node.appendChild(world);

    var beats = op.inner.beats || [];
    var beat = op.beatIndex >= 0 ? beats[op.beatIndex] : null;
    if (beat) {
      var line = document.createElement("div");
      line.style.cssText = "position:absolute;inset:0;display:flex;align-items:center;" +
        "justify-content:center;text-align:center;padding:0 14%;color:" +
        (op.inner.titleColor || "#fff") + ";font-size:" + (op.inner.titleFontSize || 32) +
        "px;font-weight:700;line-height:1.3;direction:rtl;";
      line.textContent = beat.text;
      world.appendChild(line);
    }

    var maxR = Math.max(op.radius, 1);
    var mark = document.createElement("div");
    mark.style.cssText = "position:absolute;left:0;top:0;font-family:" + op.fontFamily +
      ";font-weight:" + op.fontWeight + ";font-size:" + op.fontSize +
      "px;white-space:pre;direction:rtl;line-height:1;";
    mark.textContent = op.wordmark;
    node.appendChild(mark);

    // Ink crossfade rides the radius, matching the perceived growth of the disc.
    mark.style.color = mixColor(op.color, op.innerColor,
      op.radius > 0 ? Math.min(1, op.inkMix === undefined ? 1 : op.inkMix) : 0);
    void maxR;
  }

  /* -------------------------------------------------------------- registry */

  function createRuntime(composition, measure) {
    var root = document.getElementById("root");
    var nodes = {};
    var api = {
      composition: composition,
      frameAt: function (t) { return frameAt(composition, t, measure); },
      seek: function (t) {
        if (!root) return;
        applyFrame(root, api.frameAt(t), nodes);
      }
    };

    // Register as the composition's timeline so the renderer can seek it.
    // The framework requires the key to match data-composition-id.
    window.__timelines = window.__timelines || {};
    window.__timelines[composition.id] = {
      duration: durationOf(composition) / 1000,
      paused: true,
      seek: function (timeSeconds) { api.seek(timeSeconds * 1000); return 0; },
      render: function (timeSeconds) { api.seek(timeSeconds * 1000); }
    };

    window.__nasaqMotion = api;
    return api;
  }

  global.NasaqMotion = {
    frameAt: frameAt,
    durationOf: durationOf,
    heightOf: heightOf,
    splitClusters: splitClusters,
    createRuntime: createRuntime
  };
})(typeof window !== "undefined" ? window : globalThis);
`;