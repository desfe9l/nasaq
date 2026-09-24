export type VaultSection =
  | "accounts"
  | "apis"
  | "projects"
  | "payments"
  | "deployment"
  | "database"
  | "ai"
  | "authentication"
  | "domain"
  | "webhooks"
  | "services";

export type VaultSensitivity = "secret" | "sensitive" | "public";
export type VaultOrigin = "runtime" | "source" | "default" | "missing";

export type VaultChangeGuide = {
  providerAction: string;
  providerUrl: string | null;
  nasaqLocation: string;
  environments: string;
  redeploy: string;
  webhook: string;
  revoke: string;
};

export type VaultEntry = {
  id: string;
  section: VaultSection;
  service: string;
  account: string;
  label: string;
  variable: string | null;
  value: string | null;
  ownerReadable: boolean;
  configured: boolean;
  origin: VaultOrigin;
  sensitivity: VaultSensitivity;
  loginUrl: string | null;
  dashboardUrl: string | null;
  apiUrl: string | null;
  purpose: string;
  configurationLocation: string;
  exposedInSource: boolean;
  changeGuide: VaultChangeGuide;
};

export type OwnerRouteInfo = {
  label: string;
  path: string;
  status: "active" | "not_found" | "internal";
  purpose: string;
};

export type OwnerVaultFinding = {
  severity: "high" | "medium" | "info";
  title: string;
  detail: string;
  action: string;
};

export type OwnerVaultInventory = {
  generatedAt: string;
  environment: string;
  ownerConfigured: boolean;
  entries: VaultEntry[];
  routes: OwnerRouteInfo[];
  findings: OwnerVaultFinding[];
};

export const VAULT_SECTION_LABELS: Record<VaultSection, string> = {
  accounts: "الحسابات",
  apis: "واجهات APIs",
  projects: "المشاريع والمعرّفات",
  payments: "الدفع والتراخيص",
  deployment: "النشر والاستضافة",
  database: "قواعد البيانات",
  ai: "الذكاء الاصطناعي",
  authentication: "المصادقة وOAuth",
  domain: "النطاق وDNS",
  webhooks: "Webhooks",
  /**
   * Non-blocking by design: the platform ships without email/analytics/object
   * storage/monitoring, so this section reports honest "not needed yet" status
   * plus the free-tier option to pick IF the feature is ever requested — never
   * a red "غير مهيأ" error.
   */
  services: "خدمات اختيارية (غير مطلوبة حاليًا)",
};

export function maskVaultValue(value: string | null): string {
  if (!value) return "غير مهيأ";
  if (value.length <= 8) return `${value.slice(0, 2)}••••${value.slice(-2)}`;
  return `${value.slice(0, 4)}••••••••${value.slice(-4)}`;
}

export function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function inventoryToCsv(inventory: OwnerVaultInventory): string {
  const header = [
    "Section",
    "Service",
    "Account",
    "Label",
    "Variable",
    "Value",
    "Origin",
    "Environment",
    "Purpose",
    "Configuration location",
    "Change location",
    "Redeploy",
  ];
  const rows = inventory.entries.map((entry) => [
    VAULT_SECTION_LABELS[entry.section],
    entry.service,
    entry.account,
    entry.label,
    entry.variable,
    entry.value,
    entry.origin,
    inventory.environment,
    entry.purpose,
    entry.configurationLocation,
    entry.changeGuide.providerAction,
    entry.changeGuide.redeploy,
  ]);
  return [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
}

export function downloadTextFile(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
