"use client";

import { useConvexAuth, useQuery } from "convex/react";

import { api } from "@convex/_generated/api";

/**
 * The shop settings (name, currency, timezone, delivery module, …) —
 * undefined while loading, null until the first owner saves settings.
 * One shared read so every screen sees the same fresh settings.
 *
 * Skips the query when the Convex client is unauthenticated to avoid
 * triggering unnecessary token fetch attempts.
 */
export function useShop() {
  const { isAuthenticated } = useConvexAuth();
  return useQuery(api.shop.get, isAuthenticated ? {} : "skip");
}
