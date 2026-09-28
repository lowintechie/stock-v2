"use client";

import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { authClient } from "@/lib/auth-client";
import { setServerLang } from "@/lib/utils";
import type { Language } from "@/config/labels";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

// Minimum ms between token fetch attempts after a failure.  Prevents the
// Convex client from hammering the endpoint when the session is invalid or
// the rate limiter has kicked in.
const TOKEN_BACKOFF_MS = 5_000;

/**
 * Stable auth hook — replaces @convex-dev/better-auth's internal hook.
 *
 * Fixes:
 * 1. Ref-based dedup — concurrent calls share one in-flight request.
 * 2. Backoff on failure — a 401/429 backs off for TOKEN_BACKOFF_MS.
 * 3. Token stored in a ref — fetchAccessToken identity is stable; doesn't
 *    churn on every cachedToken state update.
 */
function useStableAuth(initialToken?: string | null) {
  const { data: session, isPending: isSessionPending } = authClient.useSession();
  const sessionId = session?.session?.id;

  const tokenRef = useRef<string | null>(initialToken ?? null);
  const [cachedToken, setCachedToken] = useState<string | null>(initialToken ?? null);
  const pendingRef = useRef<Promise<string | null> | null>(null);
  const lastFailRef = useRef(0);
  // Track session existence in a ref so the stable fetchAccessToken callback
  // can read it without being a dependency.
  const hasSessionRef = useRef(Boolean(session?.session));
  useEffect(() => {
    hasSessionRef.current = Boolean(session?.session);
  }, [session]);

  // When the session is lost, clear the cached token so isAuthenticated
  // flips to false.  Uses a setTimeout callback (allowed by the lint rule)
  // to avoid calling setState synchronously in the effect body.
  useEffect(() => {
    if (!session && !isSessionPending) {
      tokenRef.current = null;
      setTimeout(() => setCachedToken(null), 0);
    }
  }, [session, isSessionPending]);

  // Stable callback — reads token from ref, so identity doesn't depend on
  // cachedToken state.
  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken = false } = {}) => {
      // If there is no session the cookie won't be present — the token
      // endpoint would return 401 every time.  Return null immediately
      // instead of spamming the endpoint.
      if (!hasSessionRef.current && !forceRefreshToken) {
        console.log("[TOKEN] skip — no session");
        return null;
      }

      if (tokenRef.current && !forceRefreshToken) return tokenRef.current;
      if (!forceRefreshToken && pendingRef.current) return pendingRef.current;
      if (
        !forceRefreshToken &&
        lastFailRef.current > 0 &&
        Date.now() - lastFailRef.current < TOKEN_BACKOFF_MS
      ) {
        console.log("[TOKEN] skip — backoff");
        return null;
      }

      console.log("[TOKEN] fetching…");
      pendingRef.current = authClient.convex
        .token({ fetchOptions: { throw: false } })
        .then(({ data }) => {
          const token = data?.token || null;
          console.log("[TOKEN] result:", token ? "ok" : "null");
          tokenRef.current = token;
          setCachedToken(token);
          lastFailRef.current = 0;
          return token;
        })
        .catch((err) => {
          console.log("[TOKEN] error:", err);
          tokenRef.current = null;
          setCachedToken(null);
          lastFailRef.current = Date.now();
          return null;
        })
        .finally(() => {
          pendingRef.current = null;
        });

      return pendingRef.current;
    },
    // fetchAccessToken identity is intentionally stable — never changes.
    [],
  );

  return {
    isLoading: isSessionPending && !cachedToken,
    isAuthenticated: Boolean(session?.session) || cachedToken !== null,
    fetchAccessToken,
    sessionId,
  };
}

/**
 * Verify the one-time-token (cross-domain auth flow) on mount — same logic
 * as the upstream ConvexBetterAuthProvider.
 */
function useVerifyOneTimeToken() {
  const verified = useRef(false);
  useEffect(() => {
    if (verified.current || typeof window === "undefined") return;
    verified.current = true;
    const url = new URL(window.location.href);
    const ott = url.searchParams.get("ott");
    if (!ott) return;
    url.searchParams.delete("ott");
    window.history.replaceState({}, "", url);
    interface CrossDomainResult {
      data?: { session?: { token: string } };
    }
    const client = authClient as unknown as {
      crossDomain?: {
        oneTimeToken: {
          verify: (args: { token: string }) => Promise<CrossDomainResult>;
        };
      };
      getSession: (opts: {
        fetchOptions: { headers: { Authorization: string } };
      }) => Promise<void>;
      updateSession?: () => void;
    };
    client.crossDomain?.oneTimeToken
      .verify({ token: ott })
      .then(async (result) => {
        const sess = result.data?.session;
        if (sess) {
          await client.getSession({
            fetchOptions: { headers: { Authorization: `Bearer ${sess.token}` } },
          });
          client.updateSession?.();
        }
      })
      .catch(() => {});
  }, []);
}

export function ConvexClientProvider({
  children,
  initialToken,
  lang,
}: {
  children: ReactNode;
  initialToken?: string | null;
  lang: Language;
}) {
  setServerLang(lang);
  useVerifyOneTimeToken();

  // useAuth must be a named function (Rules of Hooks). It captures
  // initialToken from the closure — the value is constant per request
  // (set once in the server layout), so this is safe.
  function useAuth() {
    return useStableAuth(initialToken);
  }

  return (
    <ConvexProviderWithAuth client={convex} useAuth={useAuth}>
      {children}
    </ConvexProviderWithAuth>
  );
}
