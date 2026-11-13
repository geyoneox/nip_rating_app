/* eslint-disable @typescript-eslint/no-explicit-any */
import { useGetIdentity } from "@refinedev/core";
import type { NipRun } from "./nip";

/**
 * Roles are only used to HIDE controls. The access policies on the server are
 * the real guard, so a wrong guess here can never grant access.
 */
function roleNames(identity: any): string[] {
  const out: string[] = [];
  for (const r of identity?.roles ?? []) {
    if (typeof r === "string") out.push(r);
    else if (r && typeof r === "object") {
      if (r.name) out.push(String(r.name));
      if (r.slug) out.push(String(r.slug));
    }
  }
  return out;
}

/** Roles allowed to see driver licence numbers and dates of birth. Change here if the rule changes. */
export const SENSITIVE_VISIBLE_ROLES = ["nip_user", "nip_reviewer", "nip_admin"];

export function useNipAccess() {
  const { data: identity, isLoading } = useGetIdentity<any>();
  const names = roleNames(identity);
  const has = (r: string) => names.includes(r) || names.includes(`nip_rating-${r}`);

  const isAdmin = has("nip_admin") || Boolean(identity?.is_superuser);
  const isReviewer = has("nip_reviewer");
  const isUser = has("nip_user") || (!isAdmin && !isReviewer && names.length === 0);
  const userId: string | undefined = identity?.id ? String(identity.id) : undefined;

  const canSeeSensitive = SENSITIVE_VISIBLE_ROLES.some((r) => has(r)) || isAdmin;

  /** Owner (or admin) of this run may change it. Reviewers never may. */
  const canEditRun = (run?: Pick<NipRun, "owner_id"> | null) =>
    Boolean(run) && (isAdmin || (isUser && run!.owner_id === userId));

  return { identity, isLoading, userId, isAdmin, isReviewer, isUser, canSeeSensitive, canEditRun };
}
