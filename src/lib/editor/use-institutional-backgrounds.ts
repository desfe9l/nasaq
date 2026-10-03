import { useCallback, useEffect, useState } from "react";
import { listInstitutionalBackgroundsFn } from "@/lib/institutional/functions";
import {
  INSTITUTIONAL_CHANGED,
  type InstitutionalBackground,
} from "./institutional-backgrounds";

export function useInstitutionalBackgrounds() {
  const [items, setItems] = useState<InstitutionalBackground[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await listInstitutionalBackgroundsFn();
      if (!result.ok) {
        setError(result.error);
        setItems([]);
        setCanManage(false);
        return;
      }
      setError(null);
      setCanManage(result.canManage);
      setUpdatedAt(result.updatedAt);
      setItems(result.items);
    } catch {
      setError("تعذر قراءة خلفيات مؤسسية");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onChange = () => void refresh();
    window.addEventListener(INSTITUTIONAL_CHANGED, onChange);
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => {
      window.removeEventListener(INSTITUTIONAL_CHANGED, onChange);
      window.clearInterval(timer);
    };
  }, [refresh]);

  return { items, canManage, updatedAt, error, refresh };
}

export function notifyInstitutionalBackgrounds() {
  window.dispatchEvent(new Event(INSTITUTIONAL_CHANGED));
}

export async function readBackgroundFile(file: File): Promise<{ src: string; w: number; h: number }> {
  if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type) && !/\.(png|jpe?g|webp|svg)$/i.test(file.name)) {
    throw new Error("المقبول صورة PNG أو JPG أو WEBP أو SVG.");
  }
  const src = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("تعذر قراءة الصورة"));
    reader.readAsDataURL(file);
  });
  if (file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg")) {
    const b64 = btoa(unescape(encodeURIComponent(await file.text())));
    return { src: `data:image/svg+xml;base64,${b64}`, w: 1600, h: 900 };
  }
  const sized = await new Promise<{ src: string; w: number; h: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
      const w = Math.max(1, Math.round(image.width * scale));
      const h = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve({ src, w: image.width, h: image.height });
        return;
      }
      ctx.drawImage(image, 0, 0, w, h);
      resolve({ src: canvas.toDataURL("image/jpeg", 0.86), w, h });
    };
    image.onerror = () => reject(new Error("تعذر تجهيز الصورة"));
    image.src = src;
  });
  if (sized.src.length > 2_400_000) throw new Error("الصورة أكبر من الحد بعد الضغط.");
  return sized;
}
