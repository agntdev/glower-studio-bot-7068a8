import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, confirmKeyboard } from "../toolkit/index.js";
import { getStore, isAdmin } from "../storage.js";

const composer = new Composer<Ctx>();

// ── Gallery list ──────────────────────────────────────────────────────────

composer.callbackQuery("admin:gallery", async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.answerCallbackQuery({ text: "No access" });
    return;
  }
  await ctx.answerCallbackQuery();
  await showGalleryList(ctx);
});

// ── Add photo flow ────────────────────────────────────────────────────────

composer.callbackQuery("admin:gal:add", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await ctx.answerCallbackQuery();
  ctx.session.adminGalleryStep = "photo";
  await ctx.reply("Send me a photo to add to the gallery:", {
    reply_markup: inlineKeyboard([[inlineButton("❌ Cancel", "admin:gal:cancel")]]),
  });
});

// ── Delete photo ──────────────────────────────────────────────────────────

composer.callbackQuery(/^admin:gal:del:(.+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await ctx.answerCallbackQuery();
  const itemId = ctx.match[1];
  await ctx.reply("Delete this photo?", {
    reply_markup: confirmKeyboard(`admin:gal:delconfirm:${itemId}`),
  });
});

composer.callbackQuery(/^admin:gal:delconfirm:(.+):yes$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await ctx.answerCallbackQuery();
  const itemId = ctx.match[1];
  const store = getStore();
  await store.deleteGalleryItem(itemId);
  await ctx.reply("Photo deleted.");
  await showGalleryList(ctx);
});

composer.callbackQuery(/^admin:gal:delconfirm:(.+):no$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await ctx.answerCallbackQuery();
  await ctx.reply("Cancelled.");
  await showGalleryList(ctx);
});

// ── Cancel ────────────────────────────────────────────────────────────────

composer.callbackQuery("admin:gal:cancel", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await ctx.answerCallbackQuery();
  ctx.session.adminGalleryStep = undefined;
  ctx.session.adminGalleryPhotoId = undefined;
  ctx.session.adminGalleryCaption = undefined;
  ctx.session.adminGalleryTags = undefined;
  ctx.session.adminGalleryServiceId = undefined;
  await showGalleryList(ctx);
});

// ── Photo handler ─────────────────────────────────────────────────────────

composer.on("message:photo", async (ctx, next) => {
  if (!isAdmin(ctx.from.id)) return next();
  const step = ctx.session.adminGalleryStep;
  if (step !== "photo") return next();

  const photo = ctx.message.photo[ctx.message.photo.length - 1];
  if (!photo) return next();

  ctx.session.adminGalleryPhotoId = photo.file_id;
  ctx.session.adminGalleryStep = "caption";

  await ctx.reply("Got it! Now enter a caption for this photo:", {
    reply_markup: inlineKeyboard([[inlineButton("❌ Cancel", "admin:gal:cancel")]]),
  });
});

// ── Text input handler ────────────────────────────────────────────────────

composer.on("message:text", async (ctx, next) => {
  if (!isAdmin(ctx.from.id)) return next();
  const step = ctx.session.adminGalleryStep;
  if (!step) return next();

  const text = ctx.message.text.trim();
  const store = getStore();

  if (step === "caption") {
    ctx.session.adminGalleryCaption = text;
    ctx.session.adminGalleryStep = "tags";

    await ctx.reply("Add tags (comma-separated) or skip:", {
      reply_markup: inlineKeyboard([
        [inlineButton("Skip tags", "admin:gal:skip_tags")],
        [inlineButton("❌ Cancel", "admin:gal:cancel")],
      ]),
    });
    return;
  }

  if (step === "tags") {
    const tags = text
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    ctx.session.adminGalleryTags = tags;

    // Check if we have services to associate
    const services = await store.listServices();
    if (services.length > 0) {
      ctx.session.adminGalleryStep = "service";
      const rows = services.map((svc) => [
        inlineButton(svc.name, `admin:gal:svc:${svc.id}`),
      ]);
      rows.push([inlineButton("Skip association", "admin:gal:skip_svc")]);
      rows.push([inlineButton("❌ Cancel", "admin:gal:cancel")]);

      await ctx.reply("Associate with a service?", {
        reply_markup: inlineKeyboard(rows),
      });
    } else {
      // No services — save without association
      await saveGalleryItem(ctx, store);
    }
    return;
  }

  return next();
});

// ── Skip tags ─────────────────────────────────────────────────────────────

composer.callbackQuery("admin:gal:skip_tags", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await ctx.answerCallbackQuery();
  ctx.session.adminGalleryTags = [];

  const store = getStore();
  const services = await store.listServices();
  if (services.length > 0) {
    ctx.session.adminGalleryStep = "service";
    const rows = services.map((svc) => [
      inlineButton(svc.name, `admin:gal:svc:${svc.id}`),
    ]);
    rows.push([inlineButton("Skip association", "admin:gal:skip_svc")]);
    rows.push([inlineButton("❌ Cancel", "admin:gal:cancel")]);

    await ctx.reply("Associate with a service?", {
      reply_markup: inlineKeyboard(rows),
    });
  } else {
    await saveGalleryItem(ctx, store);
  }
});

// ── Service association ───────────────────────────────────────────────────

composer.callbackQuery(/^admin:gal:svc:(.+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await ctx.answerCallbackQuery();
  const serviceId = ctx.match[1];
  ctx.session.adminGalleryServiceId = serviceId;

  const store = getStore();
  await saveGalleryItem(ctx, store);
});

composer.callbackQuery("admin:gal:skip_svc", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await ctx.answerCallbackQuery();
  ctx.session.adminGalleryServiceId = undefined;

  const store = getStore();
  await saveGalleryItem(ctx, store);
});

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

// ── Helpers ───────────────────────────────────────────────────────────────

async function saveGalleryItem(ctx: Ctx, store: ReturnType<typeof getStore>) {
  const { adminGalleryPhotoId, adminGalleryCaption, adminGalleryTags, adminGalleryServiceId } = ctx.session;

  if (!adminGalleryPhotoId || !adminGalleryCaption) {
    await ctx.reply("Something went wrong. Let's start over.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to gallery", "admin:gallery")]]),
    });
    clearAdminGallerySession(ctx);
    return;
  }

  await store.createGalleryItem({
    photoFileId: adminGalleryPhotoId,
    caption: adminGalleryCaption,
    tags: adminGalleryTags ?? [],
    serviceId: adminGalleryServiceId,
  });

  clearAdminGallerySession(ctx);
  await ctx.reply("Photo added to gallery!");
  await showGalleryList(ctx);
}

async function showGalleryList(ctx: Ctx) {
  const store = getStore();
  const items = await store.listGalleryItems();

  if (items.length === 0) {
    await ctx.reply("No photos in the gallery yet. Add one to get started!", {
      reply_markup: inlineKeyboard([
        [inlineButton("➕ Add Photo", "admin:gal:add")],
        [inlineButton("⬅️ Back to admin", "admin:back")],
      ]),
    });
    return;
  }

  const rows = items.map((item) => [
    inlineButton(`📷 ${item.caption.slice(0, 30)}`, `admin:gal:del:${item.id}`),
  ]);
  rows.push([inlineButton("➕ Add Photo", "admin:gal:add")]);
  rows.push([inlineButton("⬅️ Back to admin", "admin:back")]);

  await ctx.reply(`Gallery (${items.length} photos):`, {
    reply_markup: inlineKeyboard(rows),
  });
}

function clearAdminGallerySession(ctx: Ctx) {
  ctx.session.adminGalleryStep = undefined;
  ctx.session.adminGalleryPhotoId = undefined;
  ctx.session.adminGalleryCaption = undefined;
  ctx.session.adminGalleryTags = undefined;
  ctx.session.adminGalleryServiceId = undefined;
}

export default composer;
