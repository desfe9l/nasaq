import { useEditor } from "./store";

/**
 * QR-code insertion, in one place.
 *
 * The code element is reachable from two surfaces — the element palette and the
 * «إضافة» menu — and both used to be a candidate for drifting apart, because
 * the whole flow (ask for the payload, encode it, fall back to a frame when the
 * payload cannot be encoded) lived inline in the palette. It lives here now, so
 * adding a QR frame is the same three lines everywhere and there is exactly one
 * place to fix an encoding bug.
 *
 * The QR library is imported dynamically: `qrcode` is only needed the first
 * time an author actually inserts a code, and it must not sit in the editor's
 * startup bundle.
 */
export async function addQrElement(prompt: (message: string, initial: string) => string | null) {
  const text = (prompt("رابط أو نص الرمز", "https://") || "").trim();
  if (!text) return;
  try {
    const QRCode = (await import("qrcode")).default;
    const src = await QRCode.toDataURL(text, {
      margin: 1,
      width: 512,
      color: { dark: "#006c35", light: "#ffffff" },
    });
    useEditor.getState().addElement("qr", { content: text, src });
  } catch {
    // Encoding failures (an over-long payload) still leave a usable frame: the
    // element renders its own fallback matrix, so the author keeps the slot and
    // can retype a shorter payload.
    useEditor.getState().addElement("qr", { content: text });
  }
}

/**
 * The browser-`prompt` variant used by both call sites.
 *
 * `window.prompt` is deliberately synchronous and modal, which is what makes it
 * safe here: no panel, no focus trap, and the returned value is the author's
 * answer before anything is inserted.
 */
export function promptForQr(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  return addQrElement((message, initial) => window.prompt(message, initial));
}
