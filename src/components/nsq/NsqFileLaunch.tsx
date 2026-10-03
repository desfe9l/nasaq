import { useEffect } from "react";
/** Global PWA OS-file entry point, including launches into an already-open editor. */
export function NsqFileLaunch() {
  useEffect(() => {
    const queue = (
      window as Window & {
        launchQueue?: {
          setConsumer(
            fn: (params: { files?: { getFile(): Promise<File> }[] }) => void,
          ): void;
        };
      }
    ).launchQueue;
    let active = true;
    queue?.setConsumer((params) => {
      const first = params.files?.[0];
      if (!first || !active) return;
      void (async () => {
        const { receiveAndContinueInEditor } = await import("@/lib/nsq/intake");
        const file = await first.getFile();
        if (active) await receiveAndContinueInEditor(file);
      })().catch(async () => {
        const { toast } = await import("sonner");
        toast.error("تعذر قراءة الملف من الجهاز. افتحه من قائمة ملف المشروع.");
      });
    });
    return () => {
      active = false;
    };
  }, []);
  return null;
}
