/**
 * A REAL 2D rasterizer for Node tests.
 *
 * `@napi-rs/canvas` is Skia compiled to a native module: it rasterizes, encodes
 * PNGs and decodes images for real. This harness wires it into a jsdom document
 * — `document.createElement("canvas")` returns a genuine Skia canvas, canvas
 * elements can be appended to jsdom nodes, and `Image` decodes data URLs — so
 * the editor's stroke engine can be exercised without a browser, and the
 * assertions read actual pixels out of the committed PNG instead of a stub.
 *
 * It is optional tooling, never a runtime dependency: when the module is
 * missing, `installCanvasHarness()` resolves to null and the calling suite
 * skips with a reason instead of pretending to pass.
 */
const FOREIGN = Symbol.for("nasaq.test.foreign-canvas");

export async function installCanvasHarness() {
  let skia;
  let jsdom;
  try {
    skia = await import("@napi-rs/canvas");
    jsdom = await import("jsdom");
  } catch {
    return null;
  }

  const dom = new jsdom.JSDOM("<!doctype html><html><body></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/",
  });
  const { window } = dom;
  const { Node, Element } = window;

  /** Give a native canvas the slice of the DOM surface the editor touches. */
  const decorate = (canvas) => {
    canvas[FOREIGN] = true;
    canvas.parentNode = null;
    canvas.__foreignChildren = [];
    canvas.style = {};
    canvas.className = "";
    canvas.setAttribute = (name, value) => {
      if (name === "class") canvas.className = String(value);
      canvas[name] = value;
    };
    canvas.getAttribute = (name) =>
      name === "class" ? canvas.className || null : (canvas[name] ?? null);
    canvas.removeAttribute = (name) => {
      delete canvas[name];
    };
    canvas.appendChild = (child) => {
      canvas.__foreignChildren.push(child);
      child.parentNode = canvas;
      return child;
    };
    canvas.querySelector = (selector) =>
      canvas.__foreignChildren.find((child) => matches(child, selector)) ?? null;
    canvas.querySelectorAll = (selector) =>
      canvas.__foreignChildren.filter((child) => matches(child, selector));
    canvas.remove = () => {
      const parent = canvas.parentNode;
      if (parent?.__foreignChildren) {
        const at = parent.__foreignChildren.indexOf(canvas);
        if (at >= 0) parent.__foreignChildren.splice(at, 1);
      }
      canvas.parentNode = null;
    };
    return canvas;
  };

  const matches = (node, selector) => {
    const text = String(selector).trim();
    if (!text) return false;
    if (text.startsWith(".")) {
      return String(node.className || "").split(/\s+/).includes(text.slice(1));
    }
    if (text.startsWith("#")) return node.id === text.slice(1);
    return String(node.tagName || "").toLowerCase() === text.toLowerCase();
  };

  // `document.createElement("canvas")` → a real rasterizer, not a stub.
  const realCreate = window.document.createElement.bind(window.document);
  window.document.createElement = (tag, ...rest) => {
    const element = realCreate(tag, ...rest);
    if (String(tag).toLowerCase() !== "canvas") return element;
    const canvas = decorate(skia.createCanvas(300, 150));
    canvas.tagName = "CANVAS";
    canvas.nodeName = "CANVAS";
    canvas.ownerDocument = window.document;
    return canvas;
  };

  // jsdom only accepts its own nodes as children; the Skia canvases above are
  // real canvases, so the tree has to admit them.
  const realAppendChild = Node.prototype.appendChild;
  Node.prototype.appendChild = function appendChild(child) {
    if (child?.[FOREIGN]) {
      this.__foreignChildren ||= [];
      this.__foreignChildren.push(child);
      child.parentNode = this;
      return child;
    }
    return realAppendChild.call(this, child);
  };
  const realRemoveChild = Node.prototype.removeChild;
  Node.prototype.removeChild = function removeChild(child) {
    if (child?.[FOREIGN]) {
      const list = this.__foreignChildren || [];
      const at = list.indexOf(child);
      if (at >= 0) list.splice(at, 1);
      child.parentNode = null;
      return child;
    }
    return realRemoveChild.call(this, child);
  };
  const realQuery = Element.prototype.querySelector;
  Element.prototype.querySelector = function querySelector(selector) {
    const found = (this.__foreignChildren || []).find((child) =>
      matches(child, selector),
    );
    return found ?? realQuery.call(this, selector);
  };
  const realQueryAll = Element.prototype.querySelectorAll;
  Element.prototype.querySelectorAll = function querySelectorAll(selector) {
    const found = (this.__foreignChildren || []).filter((child) =>
      matches(child, selector),
    );
    return [...found, ...realQueryAll.call(this, selector)];
  };

  globalThis.window = window;
  globalThis.document = window.document;
  // jsdom ships no CSSOM `escape`; the editor uses it to build class selectors
  // for element ids. Escape everything a bare id could contain.
  globalThis.CSS = window.CSS ?? {
    escape: (value) =>
      String(value).replace(
        /[^a-zA-Z0-9_\u00a0-\uffff-]/g,
        (char) => `\\${char}`,
      ),
  };
  window.CSS ??= globalThis.CSS;
  globalThis.HTMLCanvasElement = window.HTMLCanvasElement;
  globalThis.HTMLImageElement = window.HTMLImageElement;
  globalThis.Image = skia.Image;
  globalThis.CustomEvent = window.CustomEvent;
  globalThis.Event = window.Event;
  globalThis.Node = window.Node;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);

  const host = () => {
    const node = window.document.createElement("div");
    window.document.body.appendChild(node);
    return node;
  };

  return {
    skia,
    window,
    host,
    /** A real rasterizer filled by `paint`, handy as source artwork. */
    createImage(width, height, paint) {
      const canvas = skia.createCanvas(width, height);
      paint(canvas.getContext("2d"));
      return canvas;
    },
    /** Decode a committed data URL and read its pixels back. */
    async pixelsOf(dataUrl, width, height) {
      const image = await skia.loadImage(
        Buffer.from(String(dataUrl).split(",")[1], "base64"),
      );
      const canvas = skia.createCanvas(width, height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0, width, height);
      return {
        image,
        canvas,
        at(x, y) {
          return [...ctx.getImageData(x, y, 1, 1).data];
        },
      };
    },
  };
}
