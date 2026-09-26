---
name: convex-dev-rate-limiter
description: Define and use application-layer rate limits. Type-safe, transactional, fair, safe, and configurable sharding to scale. Use this skill whenever working with Rate Limiter or related Convex component functionality.
version: 0.4.0
---

> Agents: read this skill fully before writing code that uses Rate Limiter. Follow the installation and configuration steps exactly.

# Rate Limiter

## Instructions

Provides type-safe, transactional application-layer rate limiting for Convex apps. Supports both fixed window and token bucket algorithms with configurable sharding for high-throughput scenarios. Features include capacity reservation to prevent starvation, fairness guarantees, and React hooks for client-side rate limit checking.

### Installation

```bash
npm install @convex-dev/rate-limiter
```

Current npm version: `@convex-dev/rate-limiter@0.4.0`

## Use cases

- **Prevent API abuse** - Limit user actions like free trial signups or message sending to deter bots and abuse
- **Protect external API quotas** - Rate limit LLM token consumption and requests to stay within third-party service limits
- **Implement progressive restrictions** - Apply stricter rate limits after failed login attempts or other suspicious activity
- **Handle burst traffic** - Use token bucket strategy to allow short bursts while maintaining long-term consumption limits
- **Scale high-throughput operations** - Shard rate limits across multiple buckets to handle thousands of requests per minute without contention

## How it works

You define rate limits by creating a `RateLimiter` instance with named configurations specifying algorithm type (fixed window or token bucket), rate, period, and optional capacity or sharding parameters. Each rate limit can be global or keyed by user ID, session, or other identifiers.

The core API uses `rateLimiter.limit(ctx, "limitName", options)` within Convex mutations or actions, returning success status and retry timing. Advanced features include `reserve: true` for capacity reservation to prevent request starvation, and configurable sharding to distribute load across multiple database documents for high-throughput scenarios.

The component includes React hooks via `rateLimiter.hookAPI()` for client-side rate limit checking, and utilities like `reset()` for clearing limits and `getValue()` for inspecting current capacity. All operations are transactional and will roll back if the containing Convex function fails.

## When NOT to use

- When a simpler built-in solution exists for your specific use case
- If you are not using Convex as your backend
- When the functionality provided by Rate Limiter is not needed

## Resources

- [npm package](https://www.npmjs.com/package/%40convex-dev%2Frate-limiter)
- [GitHub repository](https://github.com/get-convex/rate-limiter)
- [Convex Components Directory](https://www.convex.dev/components/rate-limiter)
- [Convex documentation](https://docs.convex.dev)