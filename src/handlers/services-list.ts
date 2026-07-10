import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { registerMainMenuItem, inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { getStore } from "../storage.js";

registerMainMenuItem({ label: "💅 Services", data: "services:list", order: 10 });

const composer = new Composer<Ctx>();

composer.callbackQuery("services:list", async (ctx) => {
  await ctx.answerCallbackQuery();
  const store = getStore();
  const services = await store.listServices();

  if (services.length === 0) {
    await ctx.reply("No services available yet — check back soon!", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
    });
    return;
  }

  // Group by category
  const byCategory = new Map<string, typeof services>();
  for (const svc of services) {
    const cats = svc.categories.length > 0 ? svc.categories : ["General"];
    for (const cat of cats) {
      const list = byCategory.get(cat) ?? [];
      list.push(svc);
      byCategory.set(cat, list);
    }
  }

  const rows: ReturnType<typeof inlineButton>[][] = [];
  for (const [cat, svcs] of byCategory) {
    rows.push([inlineButton(`📂 ${cat}`, `services:cat:${cat}`)]);
    for (const svc of svcs) {
      rows.push([inlineButton(`${svc.name} — $${svc.price}`, `services:detail:${svc.id}`)]);
    }
  }
  rows.push([inlineButton("⬅️ Back to menu", "menu:main")]);

  await ctx.reply("Here are our services:", {
    reply_markup: inlineKeyboard(rows),
  });
});

composer.callbackQuery(/^services:cat:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const category = ctx.match[1];
  const store = getStore();
  const services = await store.listServicesByCategory(category);

  if (services.length === 0) {
    await ctx.reply(`No services in the "${category}" category.`, {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back", "services:list")]]),
    });
    return;
  }

  const rows = services.map((svc) => [
    inlineButton(`${svc.name} — $${svc.price}`, `services:detail:${svc.id}`),
  ]);
  rows.push([inlineButton("⬅️ Back to all services", "services:list")]);

  await ctx.reply(`${category} services:`, {
    reply_markup: inlineKeyboard(rows),
  });
});

composer.callbackQuery(/^services:detail:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const serviceId = ctx.match[1];
  const store = getStore();
  const svc = await store.getService(serviceId);

  if (!svc) {
    await ctx.reply("Sorry, that service wasn't found.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back", "services:list")]]),
    });
    return;
  }

  const cats = svc.categories.length > 0 ? svc.categories.join(", ") : "General";
  const text =
    `✨ ${svc.name}\n\n` +
    `${svc.description}\n\n` +
    `Duration: ${svc.duration} min\n` +
    `Price: $${svc.price}\n` +
    `Category: ${cats}`;

  await ctx.reply(text, {
    reply_markup: inlineKeyboard([
      [inlineButton("📅 Book this service", `booking:start:${svc.id}`)],
      [inlineButton("⬅️ Back to services", "services:list")],
    ]),
  });
});

export default composer;
