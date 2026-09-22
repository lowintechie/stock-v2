import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { authComponent, createAuth } from "./auth";
import { internal } from "./_generated/api";

const http = httpRouter();

// Rate-limited auth: wrap Better Auth's handler with IP-based rate
// limiting to block brute-force sign-in and spam sign-up.
function getIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

const rateLimitedAuth = httpAction(async (ctx, request) => {
  const ip = getIp(request);
  const url = new URL(request.url);
  const isSignIn =
    url.pathname.includes("/sign-in") || url.pathname.includes("/login");
  const isSignUp =
    url.pathname.includes("/sign-up") || url.pathname.includes("/register");
  const limitName = isSignIn ? "signIn" : isSignUp ? "signUp" : "api";
  const { ok, retryAfter } = await ctx.runMutation(
    internal.rateLimit.check,
    { name: limitName, key: ip }
  );
  if (!ok) {
    return new Response(
      JSON.stringify({
        error: "Too many requests. Try again later.",
        retryAfter,
      }),
      {
        status: 429,
        headers: {
          "content-type": "application/json",
          "retry-after": String(Math.ceil((retryAfter ?? 60000) / 1000)),
        },
      }
    );
  }
  // Forward to Better Auth's handler.
  const auth = createAuth(ctx);
  return auth.handler(request);
});

// Register auth routes manually (instead of authComponent.registerRoutes)
// so we can apply rate limiting. The .well-known redirect is also needed.
http.route({
  path: "/.well-known/openid-configuration",
  method: "GET",
  handler: httpAction(async () => {
    const url = `${process.env.CONVEX_SITE_URL}/api/auth/convex/.well-known/openid-configuration`;
    return Response.redirect(url);
  }),
});
http.route({
  pathPrefix: "/api/auth/",
  method: "GET",
  handler: rateLimitedAuth,
});
http.route({
  pathPrefix: "/api/auth/",
  method: "POST",
  handler: rateLimitedAuth,
});

// Product photos (and other stored images) are served publicly by storage id.
// Storage ids are random Convex UUIDs — unguessable, so this doubles as the
// access key (same rule as everywhere else: never expose enumerable ids).
http.route({
  path: "/api/getImage",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const storageId = new URL(request.url).searchParams.get("storageId");
    if (!storageId) return new Response(null, { status: 400 });
    const blob = await ctx.storage.get(storageId);
    if (!blob) return new Response(null, { status: 404 });
    return new Response(blob, {
      headers: {
        "content-type": blob.type,
        // Storage ids are immutable, so the browser may cache forever.
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  }),
});

export default http;
