/**
 * `/admin/agents` — NASAQ Agent Workspace.
 *
 * The ONE control surface for coding agents integrated with this repository:
 * Cline (this session), Freebuff CLI (installed), OpenHands (Docker, Windows),
 * and Arena.ai (web via GitHub App).
 *
 * Every surface here is real: it reads the actual launcher state, launches
 * real commands, and never fabricates a control that does nothing.
 *
 * Access: platform administrator (`commercial`) — same gate as services and
 * vault. Every server function re-verifies its own authority.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { RefreshCw, Terminal, Globe, Monitor, Link as LinkIcon, ShieldAlert } from "lucide-react";
import { AdminGate, AdminSection } from "@/components/admin/AdminConsole";
import { ADMIN_ROUTES, ADMIN_SECTIONS } from "@/lib/site-routes";
import { agentLauncherStatusFn, agentLauncherLaunchFn } from "@/lib/agents/functions";

const section = ADMIN_SECTIONS.find((item) => item.id === "agents")!;

/**
 * `/admin/agents` — the agent control surface.
 *
 * Shows each installed agent, its availability, and how to launch or resume
 * a session. Where direct programmatic integration is unsupported (OpenHands
 * needs Docker Desktop on Windows; Arena is a web app), it shows an honest
 * launch/deep-link or documented handoff — never a fake embedded control.
 */
export const Route = createFileRoute("/admin/agents")({
  component: AgentsSection,
});

function AgentsSection() {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof agentLauncherStatusFn>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState("");

  useEffect(() => {
    let alive = true;
    void agentLauncherStatusFn()
      .then((result) => {
        if (!alive) return;
        if (result.ok) setStatus(result);
        else setError(result.error ?? "تعذّر قراءة حالة الوكلاء");
      })
      .catch(() => alive && setError("تعذّر الاتصال بخدمة الوكلاء"));
    return () => { alive = false; };
  }, []);

  const launch = async (id: string) => {
    setBusy(id); setSaved("");
    try {
      const result = await agentLauncherLaunchFn({ data: { agentId: id } });
      if (result.ok) {
        setSaved("تمّ الإطلاق");
        // Refresh status after a launch so the UI reflects reality.
        void agentLauncherStatusFn().then((r) => {
          if (r.ok) setStatus(r);
        });
      } else {
        setError(result.error ?? "فشل الإطلاق");
      }
    } catch {
      setError("فشل الاتصال بخدمة الإطلاق");
    } finally {
      setBusy(null);
    }
  };

  if (!status) {
    return (
      <AdminSection title={section.label} description={section.description}>
        <AdminGate need="commercial">
          <div className="flex h-64 items-center justify-center rounded-[12px] border border-line bg-surface p-6">
            <span className="text-[11px] text-muted">جارٍ تحميل حالة الوكلاء…</span>
          </div>
        </AdminGate>
      </AdminSection>
    );
  }

  if (error) {
    return (
      <AdminSection title={section.label} description={section.description}>
        <AdminGate need="commercial">
          <section className="rounded-[12px] border border-gold/50 bg-gold/10 p-6">
            <h2 className="text-[15px] font-extrabold text-ink">تعذّر تحميل الحالة</h2>
            <p className="mt-2 text-[12.5px] text-muted">{error}</p>
            <button
              type="button"
              onClick={() => { setError(null); void agentLauncherStatusFn().then((r) => { if (r.ok) setStatus(r); }); }}
              className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-3 text-[11px] font-bold transition hover:border-brand"
            >
              <RefreshCw className="size-3.5" aria-hidden /> إعادة المحاولة
            </button>
          </section>
        </AdminGate>
      </AdminSection>
    );
  }

  const agents = status.agents || [];

  return (
    <AdminSection title={section.label} description={section.description}>
      <AdminGate need="commercial">
        <div className="grid gap-4">
          {agents.map((agent) => (
            <section key={agent.id} className="rounded-[12px] border border-line bg-surface p-4">
              <header className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  {agent.kind === "installed" && <Terminal className="size-4 text-brand" aria-hidden />}
                  {agent.kind === "web" && <Globe className="size-4 text-brand" aria-hidden />}
                  {agent.kind === "docker" && <Monitor className="size-4 text-muted" aria-hidden />}
                  {agent.kind === "desktop" && <LinkIcon className="size-4 text-muted" aria-hidden />}
                  <span className="font-extrabold text-ink">{agent.name}</span>
                  {agent.status === "active" && (
                    <span className="inline-flex h-5 items-center gap-1 rounded-full bg-brand/10 px-2 text-[10px] font-bold text-brand">
                      <span className="size-1.5 rounded-full bg-brand" aria-hidden />
                      نشط
                    </span>
                  )}
                  {agent.status === "not-installed" && (
                    <span className="inline-flex h-5 items-center gap-1 rounded-full bg-gold/10 px-2 text-[10px] font-bold text-gold">
                      غير مثبت
                    </span>
                  )}
                  {agent.status === "web-only" && (
                    <span className="inline-flex h-5 items-center gap-1 rounded-full bg-blue/10 px-2 text-[10px] font-bold text-blue">
                      تطبيق ويب
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-bold text-muted">{agent.kind}</span>
              </header>
              <p className="mb-3 text-[11.5px] text-muted">{agent.description}</p>

              {agent.status === "active" && agent.launch && (
                <button
                  type="button"
                  disabled={busy === agent.id}
                  onClick={() => void launch(agent.id)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-navy px-3 text-[11px] font-bold text-on-brand disabled:opacity-50"
                >
                  {busy === agent.id ? "جارٍ الإطلاق…" : "تشغيل"}
                </button>
              )}

              {agent.status === "not-installed" && (
                <div className="mb-2 p-2 rounded-[8px] bg-gold/5 border border-gold/20">
                  <p className="text-[11px] text-gold font-bold">الخطوة التالية على ويندوز:</p>
                  <p className="text-[10.5px] text-muted">{agent.windowsSetup}</p>
                </div>
              )}

              {agent.status === "web-only" && (
                <div className="mb-2 p-2 rounded-[8px] bg-blue/5 border border-blue/20">
                  <p className="text-[11px] text-blue font-bold">متاح عبر المتصفّح:</p>
                  <p className="text-[10.5px] text-muted">{agent.launch}</p>
                </div>
              )}
            </section>
          ))}
          {status.unsupported && status.unsupported.length > 0 && (
            <section className="rounded-[12px] border border-line bg-surface p-4">
              <h3 className="text-[11px] font-extrabold text-muted">ملاحظات التوافق</h3>
              <ul className="mt-1 text-[11px] text-muted list-disc pl-4 space-y-1">
                {status.unsupported.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </section>
          )}
          {status.note && (
            <p className="text-[11px] text-muted mt-2">{status.note}</p>
          )}
        </div>
      </AdminGate>
    </AdminSection>
  );
}
