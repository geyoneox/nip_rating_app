/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { useGetIdentity } from "@refinedev/core";
import { callFn } from "../../lib/nip";
import { useNipAccess } from "../../lib/useNipAccess";

/**
 * First sign-in: a person with no NIP role gets `nip_user`. The server function
 * only ever gives the caller that one role, so this cannot raise anyone's access.
 * It asks once per browser session. If it assigns the role, the page reloads so
 * the new role is picked up.
 */
export const EnsureNipRole = ({ children }: { children: ReactNode }) => {
  const { data: identity, isLoading } = useGetIdentity<any>();
  const { isAdmin, isReviewer, hasAnyRole } = useNipAccess();
  const asked = useRef(false);

  useEffect(() => {
    if (isLoading || !identity?.id || asked.current) return;
    if (isAdmin || isReviewer || hasAnyRole) return;
    const key = `nip_role_check_${identity.id}`;
    if (sessionStorage.getItem(key)) return;
    asked.current = true;
    sessionStorage.setItem(key, "1");
    callFn<{ assigned?: boolean }>("nip_ensure_role", {})
      .then((out) => {
        if (out?.assigned) window.location.reload();
      })
      .catch(() => {
        // An admin can still assign the role by hand. Nothing else to do here.
      });
  }, [isLoading, identity?.id, isAdmin, isReviewer, hasAnyRole]);

  return <>{children}</>;
};
