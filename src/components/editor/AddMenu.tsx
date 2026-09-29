import {
  BadgePercent,
  FileCode2,
  FilePlus2,
  FolderPlus,
  Heading1,
  ImagePlus,
  Plus,
  ClipboardList,
  Minus,
  SeparatorHorizontal,
  Table2,
  Type,
  SquareDashedMousePointer,
  Shapes,
  Waypoints,
} from "lucide-react";
import { useEditor, type LeftTab } from "@/lib/editor/store";
import { AnchorMenu, MenuGroup, MenuRow } from "./ui/AnchorMenu";
import { IconButton } from "./ui/IconButton";

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
  onAddLibrary: () => void;
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
  onHeadingGenerator,
  onReportTools,
  onDrawText,
  onOpenLeft,
  className,
}: AddMenuProps) {
  const addElement = useEditor((s) => s.addElement);
  const addPage = useEditor((s) => s.addPage);
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
      <MenuGroup title="نصوص وأشكال" />
      {/* No key cap here: «T» is already printed on the dock's text tool, and
          the same shortcut in two places competes with the tool itself. */}
      <MenuRow
        icon={<Type className="size-4" />}
        label="نص بالرسم"
        hint="اسحب على الصفحة لتحديد موضعه وحجمه"
        onSelect={onDrawText}
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
        icon={<Table2 className="size-4" />}
        label="جدول أو استيراد Excel/CSV"
        onSelect={() => openTablePicker()}
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
        icon={<ImagePlus className="size-4" />}
        label="إضافة عنصر إلى المكتبة"
        onSelect={() => onUpload("library")}
      />
      <MenuGroup title="مستندات" />
      <MenuRow
        icon={<FilePlus2 className="size-4" />}
        label="صفحة جديدة"
        onSelect={() => addPage()}
      />
      <MenuRow
        icon={<FolderPlus className="size-4" />}
        label="مكتبة جديدة"
        onSelect={onAddLibrary}
      />
      <MenuRow
        icon={<Heading1 className="size-4" />}
        label="مولد عناوين الفقرات"
        onSelect={onHeadingGenerator}
      />
      <MenuRow
        icon={<ClipboardList className="size-4" />}
        label="أدوات التقرير"
        onSelect={onReportTools}
      />
    </AnchorMenu>
  );
}
