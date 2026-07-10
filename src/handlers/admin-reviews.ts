import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { getStore, isAdmin } from "../storage.js";

const composer = new Composer<Ctx>();

// ── Back to admin ─────────────────────────────────────────────────────────

composer.callbackQuery("admin:back", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await ctx.answerCallbackQuery();
  await ctx.reply("🔧 Admin Panel", {
    reply_markup: inlineKeyboard([
      [inlineButton("💅 Manage Services", "admin:services"), inlineButton("🖼️ Manage Gallery", "admin:gallery")],
      [inlineButton("📝 Manage Reviews", "admin:reviews"), inlineButton("📅 View Appointments", "admin:appointments")],
    ]),
  });
});

// ── Review list ───────────────────────────────────────────────────────────

composer.callbackQuery("admin:reviews", async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.answerCallbackQuery({ text: "No access" });
    return;
  }
  await ctx.answerCallbackQuery();
  await showReviewList(ctx, "pending");
});

composer.callbackQuery(/^admin:revs:view:(pending|all)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await ctx.answerCallbackQuery();
  await showReviewList(ctx, ctx.match[1] as "pending" | "all");
});

// ── Review detail ─────────────────────────────────────────────────────────

composer.callbackQuery(/^admin:rev:detail:(.+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await ctx.answerCallbackQuery();
  const reviewId = ctx.match[1];
  const store = getStore();
  const review = await store.getReview(reviewId);

  if (!review) {
    await ctx.reply("Review not found.");
    return;
  }

  const stars = "⭐".repeat(review.rating) + "☆".repeat(5 - review.rating);
  let text =
    `${stars}\n\n` +
    `"${review.text}"\n\n` +
    `— ${review.authorName}\n` +
    `Status: ${review.status}`;

  if (review.response) {
    text += `\n\n💬 Studio reply: ${review.response}`;
  }

  // Show photos
  if (review.photoFileIds.length > 0) {
    for (const photoId of review.photoFileIds.slice(0, 3)) {
      if (ctx.chat) await ctx.api.sendPhoto(ctx.chat.id, photoId);
    }
  }

  const rows: ReturnType<typeof inlineButton>[][] = [];
  if (review.status === "pending") {
    rows.push([inlineButton("💬 Reply to review", `admin:rev:reply:${review.id}`)]);
  }
  rows.push([inlineButton("⬅️ Back to reviews", "admin:reviews")]);

  await ctx.reply(text, {
    reply_markup: inlineKeyboard(rows),
  });
});

// ── Reply to review ───────────────────────────────────────────────────────

composer.callbackQuery(/^admin:rev:reply:(.+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await ctx.answerCallbackQuery();
  const reviewId = ctx.match[1];
  ctx.session.step = "admin_review_reply";
  ctx.session.reviewAppointmentId = reviewId; // Reuse for storing the reply review ID

  await ctx.reply("Type your reply to this review:", {
    reply_markup: inlineKeyboard([[inlineButton("❌ Cancel", "admin:reviews")]]),
  });
});

// ── Text input handler ────────────────────────────────────────────────────

composer.on("message:text", async (ctx, next) => {
  if (!isAdmin(ctx.from.id)) return next();
  const step = ctx.session.step;
  if (step !== "admin_review_reply") return next();

  const text = ctx.message.text.trim();
  const reviewId = ctx.session.reviewAppointmentId;
  if (!reviewId) return next();

  const store = getStore();
  await store.respondToReview(reviewId, text, ctx.from.id);

  // Notify the review author
  const review = await store.getReview(reviewId);
  if (review) {
    try {
      await ctx.api.sendMessage(
        review.authorId,
        `💬 The studio replied to your review:\n\n"${text}"`,
      );
    } catch {
      // User may have blocked the bot — non-fatal
    }
  }

  ctx.session.step = undefined;
  ctx.session.reviewAppointmentId = undefined;
  await ctx.reply("Reply sent!");
  await showReviewList(ctx, "pending");
});

// ── Helpers ───────────────────────────────────────────────────────────────

async function showReviewList(ctx: Ctx, filter: "pending" | "all") {
  const store = getStore();
  const reviews = filter === "pending" ? await store.listPendingReviews() : await store.listReviews();

  if (reviews.length === 0) {
    const msg = filter === "pending" ? "No pending reviews." : "No reviews yet.";
    await ctx.reply(msg, {
      reply_markup: inlineKeyboard([
        [inlineButton("🔄 View all reviews", "admin:revs:view:all"), inlineButton("📝 Pending only", "admin:revs:view:pending")],
        [inlineButton("⬅️ Back to admin", "admin:back")],
      ]),
    });
    return;
  }

  const rows = reviews.slice(0, 10).map((rev) => {
    const stars = "⭐".repeat(rev.rating);
    const preview = rev.text.slice(0, 25) + (rev.text.length > 25 ? "…" : "");
    const status = rev.status === "pending" ? "📩" : "✅";
    return [inlineButton(`${status} ${stars} ${preview}`, `admin:rev:detail:${rev.id}`)];
  });

  rows.push([
    inlineButton("🔄 View all", "admin:revs:view:all"),
    inlineButton("📝 Pending", "admin:revs:view:pending"),
  ]);
  rows.push([inlineButton("⬅️ Back to admin", "admin:back")]);

  await ctx.reply(`${filter === "pending" ? "Pending" : "All"} reviews (${reviews.length}):`, {
    reply_markup: inlineKeyboard(rows),
  });
}

export default composer;
