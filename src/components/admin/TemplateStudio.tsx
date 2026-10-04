import { useState } from "react";
import { Sparkles, Database, Layers } from "lucide-react";
import { AITemplateStudio } from "@/components/studio/AITemplateStudio";
import { AdminStudioKnowledgeBase } from "@/components/admin/AdminStudioKnowledgeBase";
import { cn } from "@/lib/utils";

type StudioTab = "generation" | "knowledge_base";

export function TemplateStudio() {
  const [activeTab, setActiveTab] = useState<StudioTab>("generation");

  return (
    <div className="grid gap-6" dir="rtl">
      {/* Studio Navigation Tabs */}
      <div className="flex border-b border-line">
        <button
          type="button"
          onClick={() => setActiveTab("generation")}
          className={cn(
            "flex items-center gap-2 border-b-2 px-5 py-3 text-[13px] font-black transition",
            activeTab === "generation"
              ? "border-brand text-brand"
              : "border-transparent text-muted hover:border-line hover:text-ink",
          )}
        >
          <Sparkles className="size-4 text-gold" />
          <span>استوديو التوليد بالذكاء الاصطناعي</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("knowledge_base")}
          className={cn(
            "flex items-center gap-2 border-b-2 px-5 py-3 text-[13px] font-black transition",
            activeTab === "knowledge_base"
              ? "border-brand text-brand"
              : "border-transparent text-muted hover:border-line hover:text-ink",
          )}
        >
          <Database className="size-4" />
          <span>إدارة قاعدة المعرفة والمراجع البصرية</span>
        </button>
      </div>

      {/* Render Active Tab */}
      {activeTab === "generation" ? (
        <AITemplateStudio />
      ) : (
        <AdminStudioKnowledgeBase />
      )}
    </div>
  );
}

export default TemplateStudio;
