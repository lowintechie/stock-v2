import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { assertDelta, assertQty, normalizeName, requireUser } from "./helpers";
import {
  checkIdempotency,
  recordIdempotency,
  replayStockLedgerId,
} from "./idempotency";
import { updateAvgCost, variantLabel } from "./sales";
import { variantQty } from "./stock";
import {
  adjustmentHistoryItem,
  stockLedgerDoc,
  stocktakeResult,
  stocktakeVariant,
} from "./types";

// T22 — Stock adjustments + stocktake (AGENTS.md). Both write ledger rows —
// NEVER direct qty edits: an adjustment is one signed in/out row with a
// reason note (damaged, found, giveaway…); a stocktake compares the physical
// count against the system and writes the difference. Taking stock out
// re-checks the current stock in the SAME transaction — oversell is
// impossible, and every row is signed (userId + ts + note) for the audit.

const NOTE_MAX = 500;
const STOCKTAKE_MAX_ROWS = 500;

/** Optional note: trimmed, empty string means "not set". */
function cleanNote(text: string | undefined): string {
  const trimmed = text?.trim() ?? "";
  if (trimmed.length > NOTE_MAX) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: "Note is too long.",
    });
  }
  return trimmed;
}

// Quick manual in/out: +delta in (found, counted twice…), −delta out
// (damaged, giveaway…). The reason text is required so the history always
// answers "why did this move?".
export const adjustStock = mutation({
  args: {
    idempotencyKey: v.string(),
    variantId: v.id("productVariants"),
    // signed: + in, − out. Bounded by assertDelta below (rejects NaN,
    // Infinity and anything outside ±1_000_000) before any DB use.
    delta: v.number(),
    note: v.optional(v.string()),
  },
  returns: stockLedgerDoc,
  handler: async (ctx, args) => {
    const { staff } = await requireUser(ctx);
    const { idempotencyKey, ...payload } = args;
    const idempotency = await checkIdempotency(
      ctx,
      staff._id,
      "adjustments.adjustStock",
      idempotencyKey,
      payload,
    );
    if (idempotency.replay !== null) {
      const row = await ctx.db.get(replayStockLedgerId(idempotency.replay));
      if (!row) {
        throw new ConvexError({
          code: "NOT_FOUND",
          message: "Stock movement not found.",
        });
      }
      return row;
    }
    const delta = assertDelta(args.delta);
    const note = cleanNote(args.note);
    if (!note) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Say why this stock moved.",
      });
    }
    const variant = await ctx.db.get(args.variantId);
    if (!variant) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Item not found." });
    }
    // Oversell is impossible: out-moves re-check stock in this transaction.
    if (delta < 0) {
      const current = await variantQty(ctx, args.variantId);
      if (current + delta < 0) {
        throw new ConvexError({
          code: "OUT_OF_STOCK",
          message: `Only ${current} in stock.`,
        });
      }
    }
    const rowId = await ctx.db.insert("stockLedger", {
      variantId: args.variantId,
      delta,
      reason: "adjustment",
      userId: staff._id,
      ts: Date.now(),
      note,
    });
    await recordIdempotency(
      ctx,
      staff._id,
      "adjustments.adjustStock",
      idempotencyKey,
      idempotency.hash,
      { kind: "stockLedger", id: rowId },
    );
    // Update cached avgCost since stock changed
    await updateAvgCost(ctx, [args.variantId]);
    return (await ctx.db.get(rowId))!;
  },
});

// Batch adjustment: stock in AND stock out in one transaction, multiple items.
// Each row has its own variant + signed delta; the note is shared across the
// batch so "Found 3 of X, damaged 2 of Y" is one operation in the history.
export const batchAdjust = mutation({
  args: {
    rows: v.array(
      v.object({
        variantId: v.id("productVariants"),
        delta: v.number(), // signed: +in, −out
      }),
    ),
    note: v.string(),
  },
  returns: v.number(), // number of ledger rows written
  handler: async (ctx, args) => {
    const { staff } = await requireUser(ctx);
    if (args.rows.length === 0 || args.rows.length > 100) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Add at least one item and no more than 100.",
      });
    }
    const note = cleanNote(args.note);
    if (!note) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Say why this stock moved.",
      });
    }
    const seen = new Set<string>();
    const now = Date.now();

    for (const row of args.rows) {
      if (seen.has(row.variantId)) {
        throw new ConvexError({
          code: "INVALID_INPUT",
          message: "Duplicate item in the list.",
        });
      }
      seen.add(row.variantId);
      const delta = assertDelta(row.delta);
      const variant = await ctx.db.get(row.variantId);
      if (!variant) {
        throw new ConvexError({
          code: "NOT_FOUND",
          message: "Item not found.",
        });
      }
      if (delta < 0) {
        const current = await variantQty(ctx, row.variantId);
        if (current + delta < 0) {
          throw new ConvexError({
            code: "OUT_OF_STOCK",
            message: `Only ${current} in stock for one of the items.`,
          });
        }
      }
      await ctx.db.insert("stockLedger", {
        variantId: row.variantId,
        delta,
        reason: "adjustment",
        userId: staff._id,
        ts: now,
        note,
      });
    }

    // Update cached avgCost for all affected variants
    await updateAvgCost(
      ctx,
      args.rows.map((r) => r.variantId),
    );

    return args.rows.length;
  },
});

// Full stocktake: the owner counts the physical shelf; only variants whose
// count differs from the system write a row (delta = counted − system).
// Matches write nothing — the ledger stays clean.
export const recordStocktake = mutation({
  args: {
    rows: v.array(
      v.object({
        variantId: v.id("productVariants"),
        countedQty: v.number(), // what the owner physically counted
      }),
    ),
  },
  returns: stocktakeResult,
  handler: async (ctx, args) => {
    const { staff } = await requireUser(ctx);
    if (args.rows.length === 0 || args.rows.length > STOCKTAKE_MAX_ROWS) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Check the counts.",
      });
    }
    const seen = new Set<string>();
    const changes: {
      variantId: Id<"productVariants">;
      before: number;
      after: number;
    }[] = [];
    const now = Date.now();
    for (const row of args.rows) {
      if (seen.has(row.variantId)) {
        throw new ConvexError({
          code: "INVALID_INPUT",
          message: "Duplicate item in counts.",
        });
      }
      seen.add(row.variantId);
      const counted = assertQty(row.countedQty, 0, "counted qty");
      const variant = await ctx.db.get(row.variantId);
      if (!variant) {
        throw new ConvexError({
          code: "NOT_FOUND",
          message: "Item not found.",
        });
      }
      const before = await variantQty(ctx, row.variantId);
      if (counted === before) continue; // matches the system — nothing to write
      await ctx.db.insert("stockLedger", {
        variantId: row.variantId,
        delta: counted - before,
        reason: "stocktake",
        userId: staff._id,
        ts: now,
        note: `Counted ${counted}, system had ${before}`,
      });
      changes.push({ variantId: row.variantId, before, after: counted });
    }
    // Update cached avgCost for all variants whose stock changed
    if (changes.length > 0) {
      await updateAvgCost(
        ctx,
        changes.map((c) => c.variantId),
      );
    }
    return { written: changes.length, rows: changes };
  },
});

// Every active variant with its computed stock, flat and label-joined —
// powers both the quick-adjustment picker and the stocktake count list.
// Bounded product walk (like the dashboard low-stock pass); ledger sums are
// one indexed eq-collect per variant.
export const stocktakeList = query({
  args: { search: v.optional(v.string()) },
  returns: v.array(stocktakeVariant),
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const raw = args.search?.trim().toLowerCase() ?? "";
    const term = normalizeName(raw);
    let products: Doc<"products">[] = [];
    if (!term) {
      // No search term - return all products.
      products = await ctx.db
        .query("products")
        .withIndex("by_nameLower")
        .take(1000);
    } else {
      // Try both normalized and original form for un-migrated nameLower values.
      const hyphenForm = raw.replace(/ /g, "-");
      const spaceForm = raw.replace(/-/g, " ");
      const terms = [...new Set([term, raw, hyphenForm, spaceForm])].filter(
        Boolean,
      );
      for (const t of terms) {
        const batch = await ctx.db
          .query("products")
          .withIndex("by_nameLower", (q) =>
            q.gte("nameLower", t).lt("nameLower", t + "\uffff"),
          )
          .take(1000);
        const seen = new Set(products.map((p) => p._id));
        for (const p of batch) {
          if (!seen.has(p._id)) products.push(p);
        }
      }
    }
    const out: {
      variantId: Id<"productVariants">;
      productId: Id<"products">;
      label: string;
      qty: number;
      imageStorageId?: Id<"_storage">;
    }[] = [];
    for (const product of products) {
      if (!product.active) continue;
      const variants = await ctx.db
        .query("productVariants")
        .withIndex("by_product", (q) => q.eq("productId", product._id))
        .collect();
      for (const variant of variants) {
        if (!variant.active) continue;
        out.push({
          variantId: variant._id,
          productId: product._id,
          label: variantLabel(product, variant),
          qty: await variantQty(ctx, variant._id),
          ...(product.imageStorageId
            ? { imageStorageId: product.imageStorageId }
            : {}),
        });
      }
    }
    return out;
  },
});

// The last 20 adjustment + stocktake rows across the shop, newest first,
// joined with the item label and the actor's name — the "recent changes"
// list that shows exactly what moved and why.
export const recentChanges = query({
  args: {},
  returns: v.array(adjustmentHistoryItem),
  handler: async (ctx) => {
    await requireUser(ctx);
    const [adjustments, stocktakes] = await Promise.all([
      ctx.db
        .query("stockLedger")
        .withIndex("by_reason_ts", (q) => q.eq("reason", "adjustment"))
        .order("desc")
        .take(20),
      ctx.db
        .query("stockLedger")
        .withIndex("by_reason_ts", (q) => q.eq("reason", "stocktake"))
        .order("desc")
        .take(20),
    ]);
    const rows = [...adjustments, ...stocktakes]
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 20);

    // Deduped batch joins: variants → products, users.
    const variants = await Promise.all(
      [...new Set(rows.map((r) => r.variantId))].map((id) => ctx.db.get(id)),
    );
    const variantById = new Map(
      variants.filter((v) => v !== null).map((v) => [v._id, v] as const),
    );
    const products = await Promise.all(
      [...new Set([...variantById.values()].map((v) => v.productId))].map(
        (id) => ctx.db.get(id),
      ),
    );
    const productById = new Map(
      products.filter((p) => p !== null).map((p) => [p._id, p] as const),
    );
    const users = await Promise.all(
      [...new Set(rows.map((r) => r.userId))].map((id) => ctx.db.get(id)),
    );
    const nameById = new Map(
      users.filter((u) => u !== null).map((u) => [u._id, u.name] as const),
    );

    return rows.map((row) => {
      const variant = variantById.get(row.variantId);
      return {
        row,
        label: variantLabel(
          variant ? (productById.get(variant.productId) ?? null) : null,
          variant ?? null,
        ),
        userName: nameById.get(row.userId) ?? "—",
      };
    });
  },
});
