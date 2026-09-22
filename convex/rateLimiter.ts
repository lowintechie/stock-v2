import { RateLimiter, HOUR, MINUTE } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";

// Application rate limits (AGENTS.md: @convex-dev/rate-limiter on auth endpoints).
// "Fails closed" — if the limiter is down, requests are rejected.

const rateLimiter = new RateLimiter(components.rateLimiter, {
  // Sign-in: max 5 attempts per minute per IP — blocks brute-force.
  signIn: { kind: "fixed window", rate: 5, period: MINUTE },
  // Sign-up: max 3 per hour per IP — blocks spam registrations.
  signUp: { kind: "fixed window", rate: 3, period: HOUR },
  // Password reset: max 3 per hour per IP.
  passwordReset: { kind: "fixed window", rate: 3, period: HOUR },
  // General API: 60 requests per minute per user — generous for normal use.
  api: { kind: "token bucket", rate: 60, period: MINUTE, capacity: 10 },
});

export default rateLimiter;
