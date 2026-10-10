import type { AppUser } from "@/lib/auth/use-current-user";
import { accountIdentity } from "@/lib/auth/identity";
import { AccountAvatar } from "./AccountAvatar";
import { AccountBadge, useAccountTier } from "./AccountBadge";

/** One identity/status composition for both headers, using server-resolved licensing. */
export function AccountControlContent({ user }: { user: AppUser }) {
  const { tier, isOwner } = useAccountTier(user);
  const { label } = accountIdentity(user);
  return (
    <span className="account-control-content">
      <span className="account-control-identity">
        <AccountAvatar user={user} size={20} />
        <span className="account-control-name" title={label}>{label}</span>
      </span>
      <AccountBadge tier={tier} isOwner={isOwner} compact />
    </span>
  );
}
