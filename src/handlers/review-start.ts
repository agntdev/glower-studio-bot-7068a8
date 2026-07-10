import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { registerMainMenuItem, inlineButton, inlineKeyboard, confirmKeyboard } from "../toolkit/index.js";
import { getStore } from "../storage.js";

registerMainMenuItem({ label: "✍️ Review", data: "review:start", order: 50 });

const composer = new Composer<Ctx>();

// Entry point — show completed appointments to review
composer.callbackQuery("review:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  const store = getStore();
  const apts = await store.listCompletedAppointmentsByClient(ctx.from.id);

  if (apts.length === 0) {
    await ctx.reply("You don't have any completed appointments to review yet. Book one first!", {
      reply_markup: inlineKeyboard([
        [inlineButton("📅 Book an appointment", "booking:start")],
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    });
    return;
  }

  // Check which ones already have reviews
  const reviews = await store.listReviews();
  const reviewedAptIds = new Set(reviews.map((r) => r.appointmentId));

  const unreviewed = apts.filter((a) => !reviewedAptIds.has(a.id));

  if (unreviewed.length === 0) {
    await ctx.reply("You've already reviewed all your completed appointments!", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
    });
    return;
  }

  const rows = unreviewed.map((apt) => {
    const svc = apt.serviceId; // We'll show service name if possible
    return [inlineButton(`${apt.date} at ${apt.time}`, `review:apt:${apt.id}`)];
  });
  rows.push([inlineButton("⬅️ Back to menu", "menu:main")]);

  ctx.session.step = "review_select";
  await ctx.reply("Which appointment would you like to review?", {
    reply_markup: inlineKeyboard(rows),
  });
});

// Appointment selected — show star rating
composer.callbackQuery(/^review:apt:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const aptId = ctx.match[1];
  ctx.session.reviewAppointmentId = aptId;
  ctx.session.step = "review_rating";
  ctx.session.reviewPhotos = [];

  const rows = [
    [inlineButton("⭐", "review:rate:1"), inlineButton("⭐⭐", "review:rate:2"), inlineButton("⭐⭐⭐", "review:rate:3")],
    [inlineButton("⭐⭐⭐⭐", "review:rate:4"), inlineButton("⭐⭐⭐⭐⭐", "review:rate:5")],
    [inlineButton("❌ Cancel", "review:cancel")],
  ];

  await ctx.reply("How would you rate your experience?", {
    reply_markup: inlineKeyboard(rows),
  });
});

// Star rating selected
composer.callbackQuery(/^review:rate:(\d)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const rating = parseInt(ctx.match[1], 10);
  ctx.session.reviewRating = rating;
  ctx.session.step = "review_text";

  await ctx.reply("Write your review (or tap Skip to submit without text):", {
    reply_markup: inlineKeyboard([
      [inlineButton("⏭️ Skip text", "review:skip_text")],
      [inlineButton("❌ Cancel", "review:cancel")],
    ]),
  });
});

// Skip text — go to photos
composer.callbackQuery("review:skip_text", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.reviewText = "";
  ctx.session.step = "review_photos";

  await ctx.reply("Add photos? Send them now, or tap Submit to finish.", {
    reply_markup: inlineKeyboard([
      [inlineButton("✅ Submit review", "review:submit")],
      [inlineButton("❌ Cancel", "review:cancel")],
    ]),
  });
});

// Submit review
composer.callbackQuery("review:submit", async (ctx) => {
  await ctx.answerCallbackQuery();
  const store = getStore();
  const { reviewAppointmentId, reviewRating, reviewText, reviewPhotos } = ctx.session;

  if (!reviewAppointmentId || !reviewRating) {
    await ctx.reply("Something went wrong. Let's start over.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
    });
    clearReviewSession(ctx);
    return;
  }

  const user = await store.getUser(ctx.from.id);
  const userName = user?.name ?? ctx.from.first_name ?? "Anonymous";

  await store.createReview({
    appointmentId: reviewAppointmentId,
    authorId: ctx.from.id,
    authorName: userName,
    rating: reviewRating,
    text: reviewText ?? "",
    photoFileIds: reviewPhotos ?? [],
  });

  // Notify admin chat
  const adminChatId = process.env.ADMIN_CHAT_ID;
  if (adminChatId) {
    const stars = "⭐".repeat(reviewRating);
    const msg =
      `📝 New review!\n\n` +
      `From: ${userName}\n` +
      `Rating: ${stars}\n` +
      (reviewText ? `Text: ${reviewText}\n` : "") +
      (reviewPhotos?.length ? `Photos: ${reviewPhotos.length}\n` : "");
    try {
      await ctx.api.sendMessage(parseInt(adminChatId, 10), msg);
    } catch {
      // Non-fatal
    }
  }

  clearReviewSession(ctx);

  await ctx.reply("Thanks for your review! We appreciate your feedback.", {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
  });
});

// Cancel review
composer.callbackQuery("review:cancel", async (ctx) => {
  await ctx.answerCallbackQuery();
  clearReviewSession(ctx);
  await ctx.reply("Review cancelled.", {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
  });
});

// Text input handler for review flow
composer.on("message:text", async (ctx, next) => {
  const step = ctx.session.step;
  if (!step?.startsWith("review_")) return next();

  const text = ctx.message.text.trim();

  if (step === "review_text") {
    ctx.session.reviewText = text;
    ctx.session.step = "review_photos";

    await ctx.reply("Add photos? Send them now, or tap Submit to finish.", {
      reply_markup: inlineKeyboard([
        [inlineButton("✅ Submit review", "review:submit")],
        [inlineButton("❌ Cancel", "review:cancel")],
      ]),
    });
    return;
  }

  return next();
});

// Photo handler for review flow
composer.on("message:photo", async (ctx, next) => {
  const step = ctx.session.step;
  if (step !== "review_photos") return next();

  if (!ctx.session.reviewPhotos) ctx.session.reviewPhotos = [];
  if (ctx.session.reviewPhotos.length >= 3) {
    await ctx.reply("Maximum 3 photos allowed. Tap Submit to finish.", {
      reply_markup: inlineKeyboard([
        [inlineButton("✅ Submit review", "review:submit")],
      ]),
    });
    return;
  }

  const photo = ctx.message.photo[ctx.message.photo.length - 1];
  if (photo) {
    ctx.session.reviewPhotos.push(photo.file_id);
  }

  const count = ctx.session.reviewPhotos.length;
  await ctx.reply(`Photo ${count}/3 added. Send more or tap Submit.`, {
    reply_markup: inlineKeyboard([
      [inlineButton("✅ Submit review", "review:submit")],
    ]),
  });
});

function clearReviewSession(ctx: Ctx) {
  ctx.session.step = undefined;
  ctx.session.reviewAppointmentId = undefined;
  ctx.session.reviewRating = undefined;
  ctx.session.reviewText = undefined;
  ctx.session.reviewPhotos = undefined;
}

export default composer;
