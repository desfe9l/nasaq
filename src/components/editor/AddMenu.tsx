import {
  BadgePercent,
  Copy,
  FileCode2,
  FilePlus2,
  FolderOpen,
  FolderPlus,
  Gauge,
  Heading1,
  ImagePlus,
  PaintBucket,
  Plus,
  ClipboardList,
  Minus,
  QrCode,
  SeparatorHorizontal,
  Stamp,
  Table2,
  Type,
  SquareDashedMousePointer,
  Shapes,
  Waypoints,
} from "lucide-react";
import { useEditor, type LeftTab } from "@/lib/editor/store";
import { promptForQr } from "@/lib/editor/qr";
import { AnchorMenu, MenuGroup, MenuRow } from "./ui/AnchorMenu";
import { IconButton } from "./ui/IconButton";
import { OPEN_NEW_PAGE_EVENT } from "./NewPageDialog";

/**
 * «إضافة» — the ONE insert menu of the studio.
 *
 * Images, logos, uploads, libraries, headings, report tools, tables, lines and
 * pages used to own permanent buttons spread across the header, the tool rail
 * and the panels' footers — the same capability shown three times. They now
 * live here, behind one compact control, which is what lets the canvas have
 * the space back. Nothing was removed: every action is the same store call or
 * the same callback the button used to fire.
 */
export interface AddMenuProps {
  onUpload: (kind: "image" | "logo" | "library") => void;
  onUploadSvg: () => void;
  /** Open the existing folder/file import dialog for the asset library. */
  onAddLibrary: () => void;
  /** Open the Library tab's existing create-folder dialog. */
  onCreateLibraryFolder?: () => void;
  onHeadingGenerator: () => void;
  /** Opens «أدوات التقرير» inside the properties panel. */
  onReportTools: () => void;
  /** Draw tool, armed exactly like the keyboard shortcut (T). */
  onDrawText: () => void;
  onOpenLeft: (tab: LeftTab) => void;
  className?: string;
}

export function AddMenu({
  onUpload,
  onUploadSvg,
  onAddLibrary,
  onCreateLibraryFolder,
  onHeadingGenerator,
  onReportTools,
  onDrawText,
  onOpenLeft,
  className,
}: AddMenuProps) {
  const addElement = useEditor((s) => s.addElement);
  const duplicatePage = useEditor((s) => s.duplicatePage);
  const openTablePicker = useEditor((s) => s.openTablePicker);

  return (
    <AnchorMenu
      label="إضافة عنصر"
      align="start"
      width={264}
      trigger={({ ref, ...props }) => (
        <IconButton
          {...props}
          ref={ref}
          label="إضافة"
          hint="صورة، شعار، نص، أشكال، جدول أو صفحة"
          icon={<Plus className="size-4" strokeWidth={2} />}
          tipSide="top"
          className={className}
          data-tour="add"
        />
      )}
    >
      <MenuRow
        icon={<PaintBucket className="size-4" />}
        label="خلفية الصفحة · Page Background"
        hint="لون أو تدرّج يغطي الصفحة كاملة"
        onSelect={() => {
          const state = useEditor.getState();
          const page = state.pages.find((p) => p.id === state.activePageId);
          if (!page || page.locked) return;
          if (!page.bg || page.bg === "transparent")
            state.setPageBackground(page.id, { bg: "#ffffff" });
          state.select(null);
          state.setRightTab("properties");
        }}
      />
      <MenuGroup title="نصوص وأشكال" />
      <MenuRow
        icon={<Type className="size-4" />}
        label="نص بالرسم"
        hint="T · اسحب على الصفحة لتحديد موضعه وحجمه"
        onSelect={onDrawText}
      />
      <MenuRow
        icon={<Heading1 className="size-4" />}
        label="مولد عناوين الفقرات"
        onSelect={onHeadingGenerator}
      />
      <MenuRow
        icon={<SquareDashedMousePointer className="size-4" />}
        label="مربع محتوى"
        onSelect={() => addElement("box")}
      />
      <MenuRow
        icon={<Shapes className="size-4" />}
        label="مكتبة الأشكال"
        onSelect={() => onOpenLeft("shapes")}
      />
      <MenuRow
        icon={<Minus className="size-4" />}
        label="خط مستقيم"
        onSelect={() => addElement("line")}
      />
      <MenuRow
        icon={<SeparatorHorizontal className="size-4" />}
        label="فاصل"
        onSelect={() => addElement("divider")}
      />
      <MenuRow
        icon={<Waypoints className="size-4" />}
        label="الموصلات والخطوط"
        onSelect={() => onOpenLeft("shapes")}
      />
      <MenuGroup title="جداول وإحصاءات" />
      <MenuRow
        icon={<Table2 className="size-4" />}
        label="جدول أو استيراد Excel/CSV"
        onSelect={() => openTablePicker()}
      />
      <MenuRow
        icon={<BadgePercent className="size-4" />}
        label="بطاقة رقم"
        onSelect={() => addElement("stat")}
      />
      <MenuRow
        icon={<Gauge className="size-4" />}
        label="شريط تقدم"
        onSelect={() => addElement("progress")}
      />
      <MenuRow
        icon={<Stamp className="size-4" />}
        label="ختم"
        onSelect={() => addElement("stamp")}
      />
      <MenuGroup title="وسائط" />
      <MenuRow
        icon={<ImagePlus className="size-4" />}
        label="إضافة صورة"
        hint="أو أفلت الصورة مباشرة على الصفحة"
        onSelect={() => onUpload("image")}
      />
      <MenuRow
        icon={<BadgePercent className="size-4" />}
        label="إضافة شعار"
        onSelect={() => onUpload("logo")}
      />
      <MenuRow
        icon={<FileCode2 className="size-4" />}
        label="استيراد SVG"
        onSelect={onUploadSvg}
      />
      <MenuRow
        icon={<QrCode className="size-4" />}
        label="رمز QR"
        hint="رابط أو نص يُولَّد كصورة"
        onSelect={() => void promptForQr()}
      />
      <MenuGroup title="المكتبة" />
      <MenuRow
        icon={<ImagePlus className="size-4" />}
        label="إضافة عنصر إلى المكتبة"
        onSelect={() => onUpload("library")}
      />
      <MenuRow
        icon={<FolderOpen className="size-4" />}
        label="فتح المكتبة"
        hint="عناصرك المحفوظة ومجلداتك"
        onSelect={() => onOpenLeft("library")}
      />
      <MenuRow
        icon={<FolderPlus className="size-4" />}
        label="مجلد جديد"
        onSelect={() =>
          onCreateLibraryFolder
            ? onCreateLibraryFolder()
            : onOpenLeft("library")
        }
      />
      <MenuRow
        icon={<FolderOpen className="size-4" />}
        label="استيراد مجلد أو ملفات"
        onSelect={onAddLibrary}
      />
      <MenuGroup title="مستندات" />
      <MenuRow
        icon={<FilePlus2 className="size-4" />}
        label="صفحة جديدة"
        hint="اختر نفس المقاس أو مقاسًا جديدًا — دون نسخ المحتوى"
        onSelect={() => window.dispatchEvent(new CustomEvent(OPEN_NEW_PAGE_EVENT))}
      />
      <MenuRow
        icon={<Copy className="size-4" />}
        label="تكرار الصفحة الحالية كنسخة مطابقة"
        hint="ينسخ إعدادات الصفحة وعناصرها إلى صفحة مستقلة"
        onSelect={() => duplicatePage()}
      />
      <MenuRow
        icon={<ClipboardList className="size-4" />}
        label="أدوات التقرير"
        onSelect={onReportTools}
      />
    </AnchorMenu>
  );
}
