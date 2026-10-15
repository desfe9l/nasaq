/**
 * NASAQ Agent Launcher — نقطة تشغيل الوكلاء (محلي فقط)
 *
 * يُظهر حالة كل وكيل وكيفية تشغيله أو استئناف جلسته.
 * لا يُنفّذ أوامر تدميرية ولا يعرّض أي أسرار.
 *
 * ملاحظة: هذا السكريبت مخصّص للتطوير المحلي فقط. لا يستخدمه أي كود خادم (server function)
 * في بيئة الإنتاج. جميع منطق الوكلاء للخادم موجود في src/lib/agents/functions.ts.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const ROOT = process.cwd();

function sh(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: "pipe" }).trim();
  } catch (e) {
    return "";
  }
}

function isInstalled(cmd) {
  return sh(`which ${cmd} 2>/dev/null || true`).length > 0;
}

const AGENTS = [
  {
    id: "cline",
    name: "Cline",
    kind: "installed",
    status: isInstalled("node") ? "active" : "unknown",
    description: "وكيل البرمجةurrent الذي يشغّل هذه الجلسة",
    home: join(ROOT, ".cline-home"),
    launch: "ما.session مفتوحة حالياً عبر واجهة المحادثة",
    windowsSetup: "تثبيت إضافة Cline من سوق إضافة VS Code",
  },
  {
    id: "freebuff",
    name: "Freebuff CLI",
    kind: "installed",
    status: isInstalled("freebuff") ? "active" : "not-installed",
    description: "وكيل برمجة سطر أوامر مجاني (طبقة استخدام مجانية)",
    home: ROOT,
    launch: "freebuff --cwd <مسار-المشروع>",
    windowsSetup: "npm install -g freebuff ثم freebuff login",
  },
  {
    id: "arena",
    name: "Arena.ai Agent Mode",
    kind: "web",
    status: "web-only",
    description: "وكيل ويب يربط بحساب GitHub ويعمل في وضع Agent Mode",
    home: "https://arena.ai",
    launch: "افتح arena.ai في المتصفّح وفعّل Agent Mode",
    windowsSetup: "اربط حساب GitHub عبر https://github.com/apps/arena-ai-coding-agent",
  },
  {
    id: "openhands",
    name: "OpenHands",
    kind: "docker",
    status: "not-installed",
    description: "وكيل يُشغل عبر حاوية دوكير على سطح مكتب ويندوز",
    home: "https://github.com/OpenHands/OpenHands",
    launch: "docker run -it --rm -p 127.0.0.1:8000:8000 ...",
    windowsSetup: "تثبيت Docker Desktop ثم تشغيل الأمر في README.windows.md",
  },
  {
    id: "freebuff-desktop",
    name: "Freebuff Desktop",
    kind: "desktop",
    status: "not-installed",
    description: "تطبيق سطح مكتب Freebuff لويندوز/ماك/لينكس",
    home: "https://freebuff.com/desktop",
    launch: "تنزيل وتشغيل من موقع Freebuff",
    windowsSetup: "تنزيل تطبيق سطح المكتب من freebuff.com/desktop",
  },
];

const AGENT_BY_ID = new Map(AGENTS.map((a) => [a.id, a]));

export function status() {
  const out = {
    agents: AGENTS,
    branch: sh("git branch --show-current"),
    root: ROOT,
  };
  console.log(JSON.stringify(out));
}

export function launch(id) {
  const a = AGENT_BY_ID.get(id);
  if (!a) {
    console.error(`لم يتم العثور على الوكيل: ${id}`);
    console.log("الوكلاء المتوفّرون: " + AGENTS.map((x) => x.id).join(", "));
    process.exit(1);
  }

  if (a.status === "not-installed") {
    console.error(`الوكيل ${a.name} غير مثبت. خطوات الإعداد على ويندوز:`);
    console.error(`  ${a.windowsSetup}`);
    process.exit(1);
  }

  if (a.kind === "web") {
    console.log(`افتح في المتصفّح: ${a.home}`);
    return;
  }

  if (id === "freebuff" && isInstalled("freebuff")) {
    console.log("تشغيل Freebuff في الدليل الجذر...");
    execSync("freebuff --cwd .", { stdio: "inherit" });
    return;
  }

  console.log(`لا يمكن تشغيل ${a.name} تلقائياً من هذه البيئة.`);
  console.log(`الطريقة اليدوية: ${a.launch}`);
}

const cmd = process.argv[2];
const arg = process.argv[3];

if (cmd === "status") {
  status();
} else if (cmd === "launch" && arg) {
  launch(arg);
} else {
  console.log("الاستخدام: node scripts/agent-launcher.mjs [status|launch <id>]");
  console.log("");
  console.log("الوكلاء: " + AGENTS.map((x) => x.id).join(", "));
}
