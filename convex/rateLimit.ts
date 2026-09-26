import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import rateLimiter from "./rateLimiter";

// Internal rate limit check — called from HTTP actions.

export const check = internalMutation({
  args: {
    name: v.string(),
    key: v.string(),
  },
  returns: v.object({
    ok: v.boolean(),
    retryAfter: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    return rateLimiter.limit(ctx, args.name as "signIn", { key: args.key });
  },
});
