import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { isAdmin } from "../storage.js";

const composer = new Composer<Ctx>();

composer.command("admin", async (ctx) => {
  if (!ctx.from || !isAdmin(ctx.from.id)) {
    await ctx.reply("You don't have admin access.");
    return;
  }

  await ctx.reply("🔧 Admin Panel", {
    reply_markup: inlineKeyboard([
      [inlineButton("💅 Manage Services", "admin:services"), inlineButton("🖼️ Manage Gallery", "admin:gallery")],
      [inlineButton("📝 Manage Reviews", "admin:reviews"), inlineButton("📅 View Appointments", "admin:appointments")],
    ]),
  });
});

export default composer;
