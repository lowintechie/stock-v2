"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect } from "react";

import { api } from "@convex/_generated/api";
import { toastError } from "@/lib/utils";

/**
 * The signed-in staff profile (id, name, email, role) — undefined while
 * loading, null when there is no profile yet (first sign-in or the auth
 * token hasn't reached the Convex client). On first sign-in it provisions
 * the staff record once the Convex client is authenticated; the Convex
 * query then refills itself reactively.
 */
export function useCurrentUser() {
  const me = useQuery(api.users.me);
  const ensureMe = useMutation(api.users.ensureMe);
  const { isAuthenticated } = useConvexAuth();

  useEffect(() => {
    // Provision only once the Convex client has a valid token — me === null
    // means authenticated but no staff record yet (unauthenticated queries
    // return undefined, not null).
    if (me === null && isAuthenticated) {
      ensureMe().catch(toastError);
    }
  }, [me, isAuthenticated, ensureMe]);

  return me;
}
