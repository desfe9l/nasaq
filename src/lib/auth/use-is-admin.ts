import { useEffect, useState } from "react";
import { useCurrentUserState } from "./use-current-user";
import { amIAdmin } from "@/lib/commercial/admin-functions";

export function useIsAdmin() {
  const { user, isPending } = useCurrentUserState();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isPending) return;
    if (!user) {
      setIsAdmin(false);
      setLoading(false);
      return;
    }
    let cancelled = false;
    void amIAdmin()
      .then((res) => {
        if (!cancelled) {
          setIsAdmin(res.isAdmin);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setIsAdmin(false);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user, isPending]);

  return { isAdmin, loading, user, isPending };
}
