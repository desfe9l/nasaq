import type { AppUser } from "@/lib/auth/use-current-user";
import { accountIdentity } from "@/lib/auth/identity";
import { AccountAvatar } from "./AccountAvatar";
import { AccountBadge, useAccountTier } from "./AccountBadge";

/** One identity/status composition for both headers, using server-resolved licensing. */
export function AccountControlContent({ user }: { user: AppUser }) {
  const tierResult = useAccountTier(user) as any;
  const tier = tierResult.tier || tierResult;
  const isOwner = tierResult.isOwner || false;
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
