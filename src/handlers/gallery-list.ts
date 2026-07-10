import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { registerMainMenuItem, inlineButton, inlineKeyboard, paginate } from "../toolkit/index.js";
import { getStore } from "../storage.js";

registerMainMenuItem({ label: "🖼️ Gallery", data: "gallery:list", order: 20 });

const composer = new Composer<Ctx>();
const PER_PAGE = 5;

composer.callbackQuery("gallery:list", async (ctx) => {
  await ctx.answerCallbackQuery();
  await showGalleryPage(ctx, 0);
});

composer.callbackQuery(/^gallery:prev:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await showGalleryPage(ctx, parseInt(ctx.match[1], 10));
});

composer.callbackQuery(/^gallery:next:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await showGalleryPage(ctx, parseInt(ctx.match[1], 10));
});

composer.callbackQuery(/^gallery:detail:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const itemId = ctx.match[1];
  const store = getStore();
  const item = await store.getGalleryItem(itemId);

  if (!item) {
    await ctx.reply("Photo not found.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back", "gallery:list")]]),
    });
    return;
  }

  let caption = `📷 ${item.caption}`;
  if (item.tags.length > 0) {
    caption += `\n\nTags: ${item.tags.join(", ")}`;
  }

  if (ctx.chat) {
    await ctx.api.sendPhoto(ctx.chat.id, item.photoFileId, {
      caption,
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to gallery", "gallery:list")]]),
    });
  }
});

async function showGalleryPage(ctx: Ctx, page: number) {
  const store = getStore();
  const items = await store.listGalleryItems();

  if (items.length === 0) {
    await ctx.reply("No photos yet — our gallery is being curated!", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
    });
    return;
  }

  const { pageItems, controls, totalPages, page: actualPage } = paginate(items, {
    page,
    perPage: PER_PAGE,
    callbackPrefix: "gallery",
    prevLabel: "« Prev",
    nextLabel: "Next »",
  });

  const rows = pageItems.map((item) => [
    inlineButton(`📷 ${item.caption.slice(0, 30)}`, `gallery:detail:${item.id}`),
  ]);

  const kb = inlineKeyboard([...rows, ...controls.inline_keyboard, [inlineButton("⬅️ Back to menu", "menu:main")]]);

  const header = totalPages > 1
    ? `Gallery (page ${actualPage + 1} of ${totalPages}):`
    : "Gallery:";

  await ctx.reply(header, { reply_markup: kb });
}

export default composer;
