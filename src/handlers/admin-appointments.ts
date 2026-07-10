import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, confirmKeyboard } from "../toolkit/index.js";
import { getStore, isAdmin, type Appointment } from "../storage.js";

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

// ── Appointment list ──────────────────────────────────────────────────────

composer.callbackQuery("admin:appointments", async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    await ctx.answerCallbackQuery({ text: "No access" });
    return;
  }
  await ctx.answerCallbackQuery();
  await showAppointmentList(ctx, "upcoming");
});

composer.callbackQuery(/^admin:apts:view:(upcoming|all|completed|cancelled)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await ctx.answerCallbackQuery();
  await showAppointmentList(ctx, ctx.match[1] as "upcoming" | "all" | "completed" | "cancelled");
});

// ── Appointment detail ────────────────────────────────────────────────────

composer.callbackQuery(/^admin:apt:detail:(.+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await ctx.answerCallbackQuery();
  const aptId = ctx.match[1];
  const store = getStore();
  const apt = await store.getAppointment(aptId);

  if (!apt) {
    await ctx.reply("Appointment not found.");
    return;
  }

  const svc = await store.getService(apt.serviceId);
  const statusEmoji: Record<string, string> = {
    booked: "📩",
    confirmed: "✅",
    completed: "🎉",
    cancelled: "❌",
  };

  const text =
    `${statusEmoji[apt.status] ?? ""} Appointment #${apt.id}\n\n` +
    `Client: ${apt.clientName}\n` +
    `Phone: ${apt.clientPhone}\n` +
    `Service: ${svc?.name ?? "Unknown"}\n` +
    `Date: ${apt.date}\n` +
    `Time: ${apt.time}\n` +
    `Status: ${apt.status}` +
    (apt.notes ? `\nNotes: ${apt.notes}` : "");

  const rows: ReturnType<typeof inlineButton>[][] = [];
  if (apt.status === "booked") {
    rows.push([inlineButton("✅ Confirm", `admin:apt:status:${apt.id}:confirmed`)]);
  }
  if (apt.status === "confirmed") {
    rows.push([inlineButton("🎉 Mark completed", `admin:apt:status:${apt.id}:completed`)]);
  }
  if (apt.status !== "cancelled" && apt.status !== "completed") {
    rows.push([inlineButton("❌ Cancel appointment", `admin:apt:cancel:${apt.id}`)]);
  }
  rows.push([inlineButton("⬅️ Back to appointments", "admin:appointments")]);

  await ctx.reply(text, {
    reply_markup: inlineKeyboard(rows),
  });
});

// ── Status change ─────────────────────────────────────────────────────────

composer.callbackQuery(/^admin:apt:status:(.+):(booked|confirmed|completed|cancelled)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await ctx.answerCallbackQuery();
  const aptId = ctx.match[1];
  const status = ctx.match[2] as Appointment["status"];
  const store = getStore();

  await store.updateAppointmentStatus(aptId, status);

  const apt = await store.getAppointment(aptId);
  if (apt && status === "completed") {
    // Notify client to leave a review
    try {
      await ctx.api.sendMessage(
        apt.clientTelegramId,
        `🎉 Your appointment on ${apt.date} at ${apt.time} is complete!\n\nWe'd love to hear about your experience.`,
        {
          reply_markup: inlineKeyboard([[inlineButton("✍️ Leave a review", "review:start")]]),
        },
      );
    } catch {
      // User may have blocked the bot
    }
  }

  if (apt && status === "confirmed") {
    try {
      await ctx.api.sendMessage(
        apt.clientTelegramId,
        `✅ Your appointment has been confirmed!\n\nDate: ${apt.date}\nTime: ${apt.time}`,
      );
    } catch {
      // Non-fatal
    }
  }

  await ctx.reply(`Appointment status updated to "${status}".`);
  await showAppointmentList(ctx, "upcoming");
});

// ── Cancel appointment ────────────────────────────────────────────────────

composer.callbackQuery(/^admin:apt:cancel:(.+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await ctx.answerCallbackQuery();
  const aptId = ctx.match[1];
  await ctx.reply("Cancel this appointment?", {
    reply_markup: confirmKeyboard(`admin:apt:cancelconfirm:${aptId}`),
  });
});

composer.callbackQuery(/^admin:apt:cancelconfirm:(.+):yes$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await ctx.answerCallbackQuery();
  const aptId = ctx.match[1];
  const store = getStore();
  const apt = await store.getAppointment(aptId);

  await store.updateAppointmentStatus(aptId, "cancelled");

  if (apt) {
    try {
      await ctx.api.sendMessage(
        apt.clientTelegramId,
        `❌ Your appointment on ${apt.date} at ${apt.time} has been cancelled.\n\nIf this was a mistake, feel free to book again.`,
      );
    } catch {
      // Non-fatal
    }
  }

  await ctx.reply("Appointment cancelled.");
  await showAppointmentList(ctx, "upcoming");
});

composer.callbackQuery(/^admin:apt:cancelconfirm:(.+):no$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await ctx.answerCallbackQuery();
  await ctx.reply("Cancelled. Appointment unchanged.");
  await showAppointmentList(ctx, "upcoming");
});

// ── Helpers ───────────────────────────────────────────────────────────────

async function showAppointmentList(ctx: Ctx, filter: "upcoming" | "all" | "completed" | "cancelled") {
  const store = getStore();
  let apts: Appointment[];

  switch (filter) {
    case "upcoming":
      apts = await store.listUpcomingAppointments();
      break;
    case "completed":
      apts = (await store.listAppointments()).filter((a) => a.status === "completed");
      break;
    case "cancelled":
      apts = (await store.listAppointments()).filter((a) => a.status === "cancelled");
      break;
    default:
      apts = await store.listAppointments();
  }

  if (apts.length === 0) {
    const msg =
      filter === "upcoming"
        ? "No upcoming appointments."
        : filter === "completed"
          ? "No completed appointments."
          : filter === "cancelled"
            ? "No cancelled appointments."
            : "No appointments yet.";
    await ctx.reply(msg, {
      reply_markup: inlineKeyboard([
        [
          inlineButton("📅 Upcoming", "admin:apts:view:upcoming"),
          inlineButton("All", "admin:apts:view:all"),
        ],
        [
          inlineButton("🎉 Completed", "admin:apts:view:completed"),
          inlineButton("❌ Cancelled", "admin:apts:view:cancelled"),
        ],
        [inlineButton("⬅️ Back to admin", "admin:back")],
      ]),
    });
    return;
  }

  // Sort by date/time descending (most recent first)
  apts.sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`));

  const statusEmoji: Record<string, string> = {
    booked: "📩",
    confirmed: "✅",
    completed: "🎉",
    cancelled: "❌",
  };

  const rows = apts.slice(0, 10).map((apt) => {
    const emoji = statusEmoji[apt.status] ?? "";
    return [inlineButton(`${emoji} ${apt.date} ${apt.time} — ${apt.clientName}`, `admin:apt:detail:${apt.id}`)];
  });

  rows.push([
    inlineButton("📅 Upcoming", "admin:apts:view:upcoming"),
    inlineButton("All", "admin:apts:view:all"),
  ]);
  rows.push([
    inlineButton("🎉 Completed", "admin:apts:view:completed"),
    inlineButton("❌ Cancelled", "admin:apts:view:cancelled"),
  ]);
  rows.push([inlineButton("⬅️ Back to admin", "admin:back")]);

  await ctx.reply(`Appointments (${apts.length}):`, {
    reply_markup: inlineKeyboard(rows),
  });
}

export default composer;
