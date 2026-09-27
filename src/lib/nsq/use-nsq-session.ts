import { useEditor } from "@/lib/editor/store";
import { ANON_OWNER } from "@/lib/editor/storage-owner";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

/**
 * True once a real session owns the editor library — the user is known AND
 * `hydrate()` has re-pinned storage to them, so an imported project lands in
 * their own library. (With auth disabled the dev user satisfies both.)
 */
export function useNsqSignedIn(): { signedIn: boolean; resolving: boolean } {
  const { user, isPending } = useCurrentUserState();
  const owner = useEditor((s) => s.sessionOwner);
  const hydrated = useEditor((s) => s.hydrated);
  return {
    signedIn:
      Boolean(user) &&
      hydrated &&
      !!owner &&
      owner !== ANON_OWNER &&
      owner === user?.id,
    resolving: isPending || !hydrated || (Boolean(user) && owner !== user?.id),
  };
}
