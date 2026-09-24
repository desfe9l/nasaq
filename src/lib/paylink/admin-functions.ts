import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { requireAdmin } from "@/lib/commercial/admin.server";
import { listPaylinkTransactionsForAdmin } from "@/lib/paylink/transactions.server";

export const getAdminPaylinkTransactions = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await requireAdmin(sql, context.userId);
    return listPaylinkTransactionsForAdmin(sql);
  });
