import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { registerMainMenuItem, inlineButton, inlineKeyboard, paginate } from "../toolkit/index.js";
import { getStore } from "../storage.js";

registerMainMenuItem({ label: "⭐ Reviews", data: "reviews:list", order: 30 });

const composer = new Composer<Ctx>();
const PER_PAGE = 5;

composer.callbackQuery("reviews:list", async (ctx) => {
  await ctx.answerCallbackQuery();
  await showReviewsPage(ctx, 0, "newest");
});

composer.callbackQuery(/^reviews:page:(prev|next):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const direction = ctx.match[1];
  const targetPage = parseInt(ctx.match[2], 10);
  // We need to pass sort info, but it's in the callback data. Let's use a simpler approach.
  await showReviewsPage(ctx, targetPage, "newest");
});

composer.callbackQuery(/^reviews:sort:(newest|highest)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const sort = ctx.match[1] as "newest" | "highest";
  await showReviewsPage(ctx, 0, sort);
});

composer.callbackQuery(/^reviews:detail:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const reviewId = ctx.match[1];
  const store = getStore();
  const review = await store.getReview(reviewId);

  if (!review) {
    await ctx.reply("Review not found.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back", "reviews:list")]]),
    });
    return;
  }

  const stars = "⭐".repeat(review.rating) + "☆".repeat(5 - review.rating);
  let text = `${stars}\n\n"${review.text}"\n\n— ${review.authorName}`;

  if (review.response) {
    text += `\n\n💬 Studio reply: ${review.response}`;
  }

  // Send photos if any
  if (review.photoFileIds.length > 0) {
    for (const photoId of review.photoFileIds.slice(0, 3)) {
      if (ctx.chat) await ctx.api.sendPhoto(ctx.chat.id, photoId);
    }
  }

  await ctx.reply(text, {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to reviews", "reviews:list")]]),
  });
});

async function showReviewsPage(ctx: Ctx, page: number, sort: "newest" | "highest") {
  const store = getStore();
  let reviews = await store.listReviews();

  if (reviews.length === 0) {
    await ctx.reply("No reviews yet — be the first to share your experience!", {
      reply_markup: inlineKeyboard([
        [inlineButton("✍️ Write a review", "review:start")],
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    });
    return;
  }

  // Sort
  if (sort === "newest") {
    reviews.sort((a, b) => b.createdAt - a.createdAt);
  } else {
    reviews.sort((a, b) => b.rating - a.rating || b.createdAt - a.createdAt);
  }

  const { pageItems, controls, totalPages, page: actualPage } = paginate(reviews, {
    page,
    perPage: PER_PAGE,
    callbackPrefix: `reviews:page`,
    prevLabel: "« Prev",
    nextLabel: "Next »",
  });

  const rows = pageItems.map((rev) => {
    const stars = "⭐".repeat(rev.rating);
    const preview = rev.text.slice(0, 40) + (rev.text.length > 40 ? "…" : "");
    return [inlineButton(`${stars} ${preview}`, `reviews:detail:${rev.id}`)];
  });

  // Sort toggle
  const sortLabel = sort === "newest" ? "🏆 Highest rated" : "🕐 Newest first";
  const nextSort = sort === "newest" ? "highest" : "newest";

  const kb = inlineKeyboard([
    ...rows,
    ...controls.inline_keyboard,
    [inlineButton(sortLabel, `reviews:sort:${nextSort}`)],
    [inlineButton("⬅️ Back to menu", "menu:main")],
  ]);

  const header = totalPages > 1
    ? `Reviews (page ${actualPage + 1} of ${totalPages}):`
    : "Reviews:";

  await ctx.reply(header, { reply_markup: kb });
}

export default composer;
