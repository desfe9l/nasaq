import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  FilePlus2,
  Files,
  FolderOpen,
  House,
  KeyRound,
  LogIn,
  LogOut,
  Settings2,
  UserRound,
} from "lucide-react";
import { authEnabled, signOut } from "@/lib/auth/client";
import { useCurrentUserState, type AppUser } from "@/lib/auth/use-current-user";
import { accountIdentity } from "@/lib/auth/identity";
import { AccountControlContent } from "@/components/site/AccountControlContent";
import { useAccountTier } from "@/components/site/AccountBadge";
import {
  ADMIN_ROUTES,
  OWNER_VAULT_ROUTE,
  PROJECTS_ROUTE,
  projectPathFor,
  templatesFilterPathFor,
} from "@/lib/site-routes";
import {
  AccountMenuPanel,
  AccountMenuRowSlot,
  accountMenuItemClass,
  accountMenuItemMutedClass,
  accountMenuLayerClass,
  useAccountMenuDismiss,
  useAccountMenuPlacement,
} from "@/components/site/AccountMenuPanel";
import { AccountSubscriptionCard } from "@/components/site/AccountSubscriptionCard";
import { cn } from "@/lib/utils";
import { OPEN_EDITOR_SETTINGS_EVENT } from "@/lib/editor/ui-state";
import { NewDocumentDialog } from "@/components/site/NewDocumentDialog";
import { useEditor } from "@/lib/editor/store";
import { configFromPage } from "@/lib/editor/new-document";
import { requestLeave } from "@/lib/editor/leave-controller";

/**
 * The editor's account area: who is signed in, and the door to their settings.
 *
 * Identity comes from the verified session (`useCurrentUserState` → Better
 * Auth) through the same resolver the site chrome uses (`accountIdentity`), so
 * the editor and the account area can never name the same person differently.
 * Licence state is the server's too — `useAccountTier` → `getLicenseStatusFn` —
 * and is displayed, never decided, here.
 *
 * Deliberately compact: an avatar plus the account name. The toolbar keeps the
 * status chip; the expanded card adds full identity, the account/subscription
 * details and the actions. The card itself is shared with the site chrome
 * (`AccountMenuPanel`) — geometry and dismissal included — and is portalled to
 * `<body>` on the dropdown layer, measured from the TOOLBAR's bottom edge, so a
 * wrapped toolbar row can never end up under the card and the card can never
 * cover a tool.
 *
 * Opening and closing are the part that used to fight the author, so they are
 * stated once here: the chip toggles, a press outside the card or Escape leaves
 * it, and NOTHING else does. A scroll of the toolbar strip, a rotation, the
 * keyboard sliding up on a tablet or a re-measure of the chip repositions the
 * card instead of closing it — and the layer it floats on is pointer-transparent
 * except for the card, so the workspace behind it stays usable.
 */

/**
 * «مستند جديد» — opens the new-document configuration without leaving the
 * workspace (the same dialog the licensed Home uses).
 *
 * Licensed accounts only (administrators included): the tier is the server's
 * (`useAccountTier` → `getLicenseStatusFn`), and the store's own entitlement
 * ceiling still applies underneath (`createDocument`), so the item can never
 * widen free-tier access. Its own component so `useAccountTier` mounts only
 * while the card is open for a real session.
 */
function AdminEditorLinks({ user }: { user: AppUser }) {
  const { tier } = useAccountTier(user);
  // A row that appears when the answer arrives moves every row under it, so the
  // slot is held open until the tier is known.
  if (tier === "LOADING") return <AccountMenuRowSlot />;
  if (tier !== "ADMIN") return null;
  return (
    <>
      <a href={ADMIN_ROUTES.dashboard} role="menuitem" className={accountMenuItemClass}>لوحة الإدارة</a>
      <a href={ADMIN_ROUTES.templates} role="menuitem" className={accountMenuItemClass}>إدارة القوالب</a>
      <a href={ADMIN_ROUTES.licenses} role="menuitem" className={accountMenuItemClass}>إدارة التراخيص</a>
      <a href={OWNER_VAULT_ROUTE} role="menuitem" className={accountMenuItemClass}>إعدادات المالك</a>
    </>
  );
}

function MyTemplatesLink({ user }: { user: AppUser }) {
  const { tier } = useAccountTier(user);
  if (tier === "LOADING") return <AccountMenuRowSlot />;
  if (tier !== "LICENSED" && tier !== "ADMIN") return null;
  return (
    <a href={templatesFilterPathFor({ pill: "custom" })} role="menuitem" className={accountMenuItemClass}>
      <FilePlus2 className="size-4 opacity-70" aria-hidden />
      قوالبي
    </a>
  );
}
function NewDocumentMenuItem({ user, onRequest }: { user: AppUser; onRequest: () => void }) {
  const { tier } = useAccountTier(user);
  if (tier === "LOADING") return <AccountMenuRowSlot />;
  if (tier !== "LICENSED" && tier !== "ADMIN") return null;
  return (
    <button type="button" role="menuitem" onClick={onRequest} className={accountMenuItemClass}>
      <FilePlus2 className="size-4 opacity-70" aria-hidden />
      مستند جديد
    </button>
  );
}

export function EditorAccountMenu({
  homeHref,
  onNavigateHome,
}: {
  /** Where «مساحة العمل» goes (the licensed Home, otherwise the site). */
  homeHref: string;
  /** Lets the shell finish a pending save before the page unloads. */
  onNavigateHome: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  const { user, isPending } = useCurrentUserState();
  /* The open document, so its own page is one click away from inside it. */
  const openProjectId = useEditor((s) => s.id);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [newDocOpen, setNewDocOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const { placement, place, reset } = useAccountMenuPlacement({ triggerRef: buttonRef });

  /** Closing forgets the measurement too, so a stale card can never reopen. */
  const closeMenu = useCallback(() => {
    setOpen(false);
    reset();
  }, [reset]);

  /*
   * Escape and a press outside the card. Deliberately NOT: a `scroll` listener
   * (the toolbar strip and the card itself both scroll — closing on scroll threw
   * the card away the moment the author scrolled inside it), a `resize` listener
   * (a tablet rotating, or a phone's URL bar collapsing, is a resize), or a
   * full-viewport layer that swallows every press in the workspace.
   */
  useAccountMenuDismiss({ open, panelRef, triggerRef: buttonRef, onClose: closeMenu });

  // Same rule as the site chrome: nothing renders until the session resolves,
  // so a signed-in author never sees a sign-in prompt flash on reload.
  if (!authEnabled || isPending) return null;

  /*
   * The divider travels with the control (rather than sitting in the toolbar)
   * so a header without an account area has no orphan separator in it.
   */
  const divider = <span className="mx-0.5 h-6 w-px shrink-0 bg-line" aria-hidden />;

  if (!user) {
    return (
      <>
        {divider}
        <a
          href="/login"
          title="تسجيل الدخول / إنشاء حساب"
          aria-label="تسجيل الدخول / إنشاء حساب"
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[8px] border border-line px-2 text-[12px] font-extrabold transition hover:border-navy-2 hover:text-navy-2"
        >
          <LogIn className="size-4" aria-hidden />
        </a>
      </>
    );
  }

  const identity = accountIdentity(user);

  /** Measure first, then open: the card's first paint is already placed. */
  const openMenu = () => {
    if (!place()) return;
    setOpen(true);
  };

  return (
    <>
      {divider}
      {/*
       * The chip: last item on the toolbar strip, so the account sits at the
       * far edge of the RTL header where it is expected and never between the
       * author and a tool.
       */}
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`حساب ${identity.label}`}
        onClick={() => (open ? closeMenu() : openMenu())}
        title={identity.label}
        className={cn(
          "account-control shrink-0",
          open ? "border-navy-2 text-brand-hover" : "border-line hover:border-navy-2",
        )}
      >
        <AccountControlContent user={user} />
        <ChevronDown className="size-3 shrink-0 opacity-70" aria-hidden />
      </button>

      {open &&
        placement &&
        createPortal(
          /*
           * The card floats on the shared dropdown layer: full-viewport but
           * pointer-transparent, so the workspace behind it keeps working and no
           * toolbar row, drawer or panel can clip it. Outside presses fall
           * THROUGH to the page and are answered by `useAccountMenuDismiss`
           * (containment), not by an invisible sheet laid over the editor.
           */
          <div className={accountMenuLayerClass}>
            <AccountMenuPanel
              user={user}
              label="قائمة الحساب"
              className="account-menu-panel-floating"
              panelRef={panelRef}
              onClose={closeMenu}
              style={{
                insetInlineEnd: placement.insetInlineEnd,
                top: placement.top,
                maxWidth: placement.maxWidth,
                maxHeight: placement.maxHeight,
              }}
            >
              <AccountSubscriptionCard user={user} variant="menu" />
              <NewDocumentMenuItem
                user={user}
                onRequest={() => {
                  void requestLeave().then((ok) => {
                    if (!ok) return;
                    closeMenu();
                    setNewDocOpen(true);
                  });
                }}
              />
              <button
                type="button"
                role="menuitem"
                className={accountMenuItemClass}
                onClick={() => {
                  closeMenu();
                  window.dispatchEvent(new CustomEvent(OPEN_EDITOR_SETTINGS_EVENT, { detail: "account" }));
                }}
              >
                <Settings2 className="size-4 opacity-70" aria-hidden />
                الإعدادات
              </button>
              {/* Leaving the workspace is navigation, not a document action, so
                  it lives with the account rather than on the toolbar itself. */}
              <a
                href={homeHref}
                role="menuitem"
                className={accountMenuItemClass}
                onClick={onNavigateHome}
              >
                <House className="size-4 opacity-70" aria-hidden />
                مساحة العمل
              </a>
              {openProjectId && (
                <a
                  href={projectPathFor(openProjectId)}
                  role="menuitem"
                  className={accountMenuItemClass}
                >
                  <FolderOpen className="size-4 opacity-70" aria-hidden />
                  صفحة المشروع
                </a>
              )}
              <a href={PROJECTS_ROUTE} role="menuitem" className={accountMenuItemClass}>
                <Files className="size-4 opacity-70" aria-hidden />
                المشاريع
              </a>
              <a href="/account" role="menuitem" className={accountMenuItemClass}>
                <UserRound className="size-4 opacity-70" aria-hidden />
                حسابي والاشتراك
              </a>
              <MyTemplatesLink user={user} />
              <AdminEditorLinks user={user} />
              <a href="/license" role="menuitem" className={accountMenuItemClass}>
                <KeyRound className="size-4 opacity-70" aria-hidden />
                ترخيصي وتفعيله
              </a>
              <button
                type="button"
                role="menuitem"
                disabled={signingOut}
                onClick={() => {
                  void requestLeave().then((ok) => {
                    if (!ok) return;
                    setSigningOut(true);
                    void signOut("/").catch(() => setSigningOut(false));
                  });
                }}
                className={accountMenuItemMutedClass}
              >
                <LogOut className="size-4 opacity-70" aria-hidden />
                {signingOut ? "جارٍ الخروج…" : "تسجيل الخروج"}
              </button>
            </AccountMenuPanel>
          </div>,
          document.body,
        )}

      {/*
       * The store applies the new project in place — no navigation, no reload.
       * Portaled to <body>: the toolbar is its own stacking context, so a
       * dialog left inside it would sit under the side drawers on a tablet.
       */}
      {newDocOpen &&
        createPortal(
          <NewDocumentDialog
            submitLabel="إنشاء المستند"
            initial={configFromPage(
              (() => {
                const state = useEditor.getState();
                return (
                  state.pages.find((page) => page.id === state.activePageId) ??
                  state.pages[0]
                );
              })(),
            )}
            onClose={() => setNewDocOpen(false)}
            onCreated={() => setNewDocOpen(false)}
          />,
          document.body,
        )}
    </>
  );
}
