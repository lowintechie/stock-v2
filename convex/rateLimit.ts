import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { MINUTE, HOUR } from "@convex-dev/ratelimiter";
import rateLimiter from "./rateLimiter";

// Internal rate limit check — called from HTTP actions. The rate limiter
// component handles storage and window logic; this function just proxies
// the check so HTTP actions can use ctx.runMutation.

const LIMITS: Record<string, { kind: "fixed window"; rate: number; period: number }> = {
  signIn: { kind: "fixed window", rate: 5, period: MINUTE },
  signUp: { kind: "fixed window", rate: 3, period: HOUR },
  passwordReset: { kind: "fixed window", rate: 3, period: HOUR },
  api: { kind: "fixed window", rate: 60, period: MINUTE },
};

export const check = internalMutation({
  args: {
    name: v.string(),
    key: v.optional(v.string()),
  },
  returns: v.object({
    ok: v.boolean(),
    retryAfter: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const config = LIMITS[args.name] ?? LIMITS.api;
    return rateLimiter.limit(ctx, args.name, { key: args.key, config });
  },
});
