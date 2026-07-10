import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, confirmKeyboard } from "../toolkit/index.js";
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

// ── Service list ──────────────────────────────────────────────────────────

composer.callbackQuery("admin:services", async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.answerCallbackQuery({ text: "No access" });
    return;
  }
  await ctx.answerCallbackQuery();
  await showServiceList(ctx);
});

// ── Add service flow ──────────────────────────────────────────────────────

composer.callbackQuery("admin:svc:add", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await ctx.answerCallbackQuery();
  ctx.session.adminServiceStep = "name";
  await ctx.reply("What's the service name?", {
    reply_markup: inlineKeyboard([[inlineButton("❌ Cancel", "admin:svc:cancel")]]),
  });
});

// ── Edit service ──────────────────────────────────────────────────────────

composer.callbackQuery(/^admin:svc:edit:(.+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await ctx.answerCallbackQuery();
  const serviceId = ctx.match[1];
  const store = getStore();
  const svc = await store.getService(serviceId);
  if (!svc) {
    await ctx.reply("Service not found.");
    return;
  }

  ctx.session.adminServiceId = serviceId;
  const text =
    `Editing: ${svc.name}\n\n` +
    `Current details:\n` +
    `Description: ${svc.description}\n` +
    `Price: $${svc.price}\n` +
    `Duration: ${svc.duration} min\n` +
    `Categories: ${svc.categories.join(", ") || "None"}`;

  await ctx.reply(text, {
    reply_markup: inlineKeyboard([
      [inlineButton("✏️ Edit name", "admin:svc:field:name"), inlineButton("✏️ Edit description", "admin:svc:field:desc")],
      [inlineButton("✏️ Edit price", "admin:svc:field:price"), inlineButton("✏️ Edit duration", "admin:svc:field:duration")],
      [inlineButton("✏️ Edit categories", "admin:svc:field:categories")],
      [inlineButton("🗑️ Delete service", `admin:svc:del:${serviceId}`)],
      [inlineButton("⬅️ Back to services", "admin:services")],
    ]),
  });
});

// ── Delete service ────────────────────────────────────────────────────────

composer.callbackQuery(/^admin:svc:del:(.+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await ctx.answerCallbackQuery();
  const serviceId = ctx.match[1];
  await ctx.reply("Delete this service?", {
    reply_markup: confirmKeyboard(`admin:svc:delconfirm:${serviceId}`),
  });
});

composer.callbackQuery(/^admin:svc:delconfirm:(.+):yes$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await ctx.answerCallbackQuery();
  const serviceId = ctx.match[1];
  const store = getStore();
  await store.deleteService(serviceId);
  await ctx.reply("Service deleted.");
  await showServiceList(ctx);
});

composer.callbackQuery(/^admin:svc:delconfirm:(.+):no$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await ctx.answerCallbackQuery();
  await ctx.reply("Cancelled.");
  await showServiceList(ctx);
});

// ── Field editing ─────────────────────────────────────────────────────────

composer.callbackQuery(/^admin:svc:field:(.+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await ctx.answerCallbackQuery();
  const field = ctx.match[1];
  ctx.session.adminServiceStep = `edit_${field}`;

  const prompts: Record<string, string> = {
    name: "Enter the new service name:",
    desc: "Enter the new description:",
    price: "Enter the new price (number):",
    duration: "Enter the new duration in minutes (number):",
    categories: "Enter categories (comma-separated):",
  };

  await ctx.reply(prompts[field] ?? "Enter the new value:", {
    reply_markup: inlineKeyboard([[inlineButton("❌ Cancel", "admin:services")]]),
  });
});

// ── Cancel ────────────────────────────────────────────────────────────────

composer.callbackQuery("admin:svc:cancel", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await ctx.answerCallbackQuery();
  ctx.session.adminServiceStep = undefined;
  ctx.session.adminServiceId = undefined;
  await showServiceList(ctx);
});

// ── Text input handler ────────────────────────────────────────────────────

composer.on("message:text", async (ctx, next) => {
  if (!isAdmin(ctx.from.id)) return next();
  const step = ctx.session.adminServiceStep;
  if (!step) return next();

  const text = ctx.message.text.trim();
  const store = getStore();

  if (step === "name") {
    if (text.length < 2) {
      await ctx.reply("Name must be at least 2 characters. Try again:");
      return;
    }
    ctx.session.adminServiceName = text;
    ctx.session.adminServiceStep = "desc";
    await ctx.reply("Describe the service:", {
      reply_markup: inlineKeyboard([[inlineButton("❌ Cancel", "admin:svc:cancel")]]),
    });
    return;
  }

  if (step === "desc") {
    ctx.session.adminServiceDesc = text;
    ctx.session.adminServiceStep = "price";
    await ctx.reply("What's the price? (number only, e.g. 50)", {
      reply_markup: inlineKeyboard([[inlineButton("❌ Cancel", "admin:svc:cancel")]]),
    });
    return;
  }

  if (step === "price") {
    const price = parseFloat(text);
    if (isNaN(price) || price < 0) {
      await ctx.reply("Please enter a valid price (a positive number):");
      return;
    }
    ctx.session.adminServicePrice = price;
    ctx.session.adminServiceStep = "duration";
    await ctx.reply("How long is the service in minutes? (e.g. 60)", {
      reply_markup: inlineKeyboard([[inlineButton("❌ Cancel", "admin:svc:cancel")]]),
    });
    return;
  }

  if (step === "duration") {
    const duration = parseInt(text, 10);
    if (isNaN(duration) || duration <= 0) {
      await ctx.reply("Please enter a valid duration (a positive number):");
      return;
    }
    ctx.session.adminServiceDuration = duration;
    ctx.session.adminServiceStep = "categories";
    await ctx.reply("Enter categories (comma-separated, or leave blank):", {
      reply_markup: inlineKeyboard([[inlineButton("Skip", "admin:svc:skip_cats")], [inlineButton("❌ Cancel", "admin:svc:cancel")]]),
    });
    return;
  }

  if (step === "categories") {
    const categories = text
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    ctx.session.adminServiceCategories = categories;

    // Create the service
    const svc = await store.createService({
      name: ctx.session.adminServiceName!,
      description: ctx.session.adminServiceDesc!,
      price: ctx.session.adminServicePrice!,
      duration: ctx.session.adminServiceDuration!,
      categories,
    });

    clearAdminServiceSession(ctx);
    await ctx.reply(`Service "${svc.name}" created!`);
    await showServiceList(ctx);
    return;
  }

  // Edit field handlers
  if (step.startsWith("edit_")) {
    const field = step.replace("edit_", "");
    const serviceId = ctx.session.adminServiceId;
    if (!serviceId) return next();

    const svc = await store.getService(serviceId);
    if (!svc) return next();

    if (field === "name") {
      svc.name = text;
    } else if (field === "desc") {
      svc.description = text;
    } else if (field === "price") {
      const price = parseFloat(text);
      if (isNaN(price) || price < 0) {
        await ctx.reply("Please enter a valid price:");
        return;
      }
      svc.price = price;
    } else if (field === "duration") {
      const duration = parseInt(text, 10);
      if (isNaN(duration) || duration <= 0) {
        await ctx.reply("Please enter a valid duration:");
        return;
      }
      svc.duration = duration;
    } else if (field === "categories") {
      svc.categories = text
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }

    await store.saveService(svc);
    ctx.session.adminServiceStep = undefined;
    ctx.session.adminServiceId = undefined;
    await ctx.reply("Updated!");
    // Show the service details again
    const text2 =
      `Editing: ${svc.name}\n\n` +
      `Description: ${svc.description}\n` +
      `Price: $${svc.price}\n` +
      `Duration: ${svc.duration} min\n` +
      `Categories: ${svc.categories.join(", ") || "None"}`;
    await ctx.reply(text2, {
      reply_markup: inlineKeyboard([
        [inlineButton("✏️ Edit name", "admin:svc:field:name"), inlineButton("✏️ Edit description", "admin:svc:field:desc")],
        [inlineButton("✏️ Edit price", "admin:svc:field:price"), inlineButton("✏️ Edit duration", "admin:svc:field:duration")],
        [inlineButton("✏️ Edit categories", "admin:svc:field:categories")],
        [inlineButton("🗑️ Delete service", `admin:svc:del:${svc.id}`)],
        [inlineButton("⬅️ Back to services", "admin:services")],
      ]),
    });
    return;
  }

  return next();
});

// ── Skip categories ───────────────────────────────────────────────────────

composer.callbackQuery("admin:svc:skip_cats", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await ctx.answerCallbackQuery();
  const store = getStore();

  const svc = await store.createService({
    name: ctx.session.adminServiceName!,
    description: ctx.session.adminServiceDesc!,
    price: ctx.session.adminServicePrice!,
    duration: ctx.session.adminServiceDuration!,
    categories: [],
  });

  clearAdminServiceSession(ctx);
  await ctx.reply(`Service "${svc.name}" created!`);
  await showServiceList(ctx);
});

// ── Helpers ───────────────────────────────────────────────────────────────

async function showServiceList(ctx: Ctx) {
  const store = getStore();
  const services = await store.listServices();

  if (services.length === 0) {
    await ctx.reply("No services yet. Add one to get started!", {
      reply_markup: inlineKeyboard([
        [inlineButton("➕ Add Service", "admin:svc:add")],
        [inlineButton("⬅️ Back to admin", "admin:back")],
      ]),
    });
    return;
  }

  const rows = services.map((svc) => [
    inlineButton(`${svc.name} — $${svc.price}`, `admin:svc:edit:${svc.id}`),
  ]);
  rows.push([inlineButton("➕ Add Service", "admin:svc:add")]);
  rows.push([inlineButton("⬅️ Back to admin", "admin:back")]);

  await ctx.reply("Manage services:", {
    reply_markup: inlineKeyboard(rows),
  });
}

function clearAdminServiceSession(ctx: Ctx) {
  ctx.session.adminServiceStep = undefined;
  ctx.session.adminServiceId = undefined;
  ctx.session.adminServiceName = undefined;
  ctx.session.adminServiceDesc = undefined;
  ctx.session.adminServicePrice = undefined;
  ctx.session.adminServiceDuration = undefined;
  ctx.session.adminServiceCategories = undefined;
}

export default composer;
