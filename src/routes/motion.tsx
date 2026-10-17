import { createFileRoute } from "@tanstack/react-router";
import { MotionStudio } from "@/components/motion/MotionStudio";
import { SiteFooter, SiteHeader } from "@/components/site/SiteChrome";

export const Route = createFileRoute("/motion")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "استوديو الحركة العربية | نَسَق" },
      {
        name: "description",
        content:
          "أنشئ فيديوهات عربية مؤسسية بحركة متحركة حقيقية داخل نَسَق، مع قوالب ونقطة الانطلاق.",
      },
    ],
  }),
  component: MotionStudioPage,
});

function MotionStudioPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-[var(--color-page)]">
      <SiteHeader current="/motion" />
      <main className="flex-1">
        <MotionStudio />
      </main>
      <SiteFooter />
    </div>
  );
}