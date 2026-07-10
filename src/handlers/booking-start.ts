import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { registerMainMenuItem, inlineButton, inlineKeyboard, confirmKeyboard } from "../toolkit/index.js";
import { getStore, type Service } from "../storage.js";

registerMainMenuItem({ label: "📅 Book", data: "booking:start", order: 40 });

const composer = new Composer<Ctx>();

// Entry point — show service selection
composer.callbackQuery("booking:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  await showServiceSelection(ctx);
});

// Entry with pre-selected service (from service detail page)
composer.callbackQuery(/^booking:start:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const serviceId = ctx.match[1];
  const store = getStore();
  const svc = await store.getService(serviceId);
  if (!svc) {
    await ctx.reply("Service not found.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
    });
    return;
  }
  ctx.session.bookingServiceId = serviceId;
  ctx.session.step = "booking_date";
  await showDateSelection(ctx);
});

// Service selected from booking flow
composer.callbackQuery(/^booking:svc:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const serviceId = ctx.match[1];
  ctx.session.bookingServiceId = serviceId;
  ctx.session.step = "booking_date";
  await showDateSelection(ctx);
});

// Date selected
composer.callbackQuery(/^booking:date:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const date = ctx.match[1];
  ctx.session.bookingDate = date;
  ctx.session.step = "booking_time";
  await showTimeSelection(ctx);
});

// Time selected
composer.callbackQuery(/^booking:time:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const time = ctx.match[1];
  ctx.session.bookingTime = time;
  ctx.session.step = "booking_name";

  // Check if user already has a name stored
  const store = getStore();
  const user = await store.getUser(ctx.from.id);
  if (user?.name) {
    ctx.session.bookingName = user.name;
    ctx.session.step = "booking_phone";
    if (user.phone) {
      ctx.session.bookingPhone = user.phone;
      ctx.session.step = "booking_confirm";
      await showBookingConfirmation(ctx);
    } else {
      await ctx.reply("What's your phone number?", {
        reply_markup: { force_reply: true, input_field_placeholder: "e.g. +1 555 123 4567" },
      });
    }
  } else {
    await ctx.reply("What's your name?", {
      reply_markup: { force_reply: true, input_field_placeholder: "Your name" },
    });
  }
});

// Confirm booking
composer.callbackQuery("booking:confirm:yes", async (ctx) => {
  await ctx.answerCallbackQuery();
  const store = getStore();
  const { bookingServiceId, bookingDate, bookingTime, bookingName, bookingPhone } = ctx.session;

  if (!bookingServiceId || !bookingDate || !bookingTime || !bookingName || !bookingPhone) {
    await ctx.reply("Something went wrong. Let's start over.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
    });
    clearBookingSession(ctx);
    return;
  }

  // Check slot availability
  const taken = await store.isSlotTaken(bookingDate, bookingTime);
  if (taken) {
    await ctx.reply("Sorry, that time slot was just taken. Pick another time.", {
      reply_markup: inlineKeyboard([[inlineButton("🔄 Choose a different time", "booking:retry_time")]]),
    });
    return;
  }

  const svc = await store.getService(bookingServiceId);
  const apt = await store.createAppointment({
    clientName: bookingName,
    clientTelegramId: ctx.from.id,
    clientPhone: bookingPhone,
    serviceId: bookingServiceId,
    date: bookingDate,
    time: bookingTime,
    staffMember: ctx.session.bookingStaff,
    status: "booked",
  });

  // Upsert user record
  await store.upsertUser({
    telegramId: ctx.from.id,
    name: bookingName,
    phone: bookingPhone,
  });

  // Notify admin chat
  const adminChatId = process.env.ADMIN_CHAT_ID;
  if (adminChatId) {
    const msg =
      `📅 New booking!\n\n` +
      `Client: ${bookingName}\n` +
      `Service: ${svc?.name ?? "Unknown"}\n` +
      `Date: ${bookingDate}\n` +
      `Time: ${bookingTime}\n` +
      `Phone: ${bookingPhone}`;
    try {
      await ctx.api.sendMessage(parseInt(adminChatId, 10), msg);
    } catch {
      // Admin chat may not be accessible — non-fatal
    }
  }

  const summary =
    `✅ Booking confirmed!\n\n` +
    `Service: ${svc?.name ?? "Unknown"}\n` +
    `Date: ${bookingDate}\n` +
    `Time: ${bookingTime}\n` +
    `Name: ${bookingName}\n` +
    `Phone: ${bookingPhone}\n\n` +
    `We'll see you there!`;

  clearBookingSession(ctx);

  await ctx.reply(summary, {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
  });
});

// Decline booking
composer.callbackQuery("booking:confirm:no", async (ctx) => {
  await ctx.answerCallbackQuery();
  clearBookingSession(ctx);
  await ctx.reply("Booking declined. Let's start over.", {
    reply_markup: inlineKeyboard([[inlineButton("🔄 Book again", "booking:start")]]),
  });
});

// Cancel booking
composer.callbackQuery("booking:cancel", async (ctx) => {
  await ctx.answerCallbackQuery();
  clearBookingSession(ctx);
  await ctx.reply("Booking cancelled.", {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
  });
});

// Retry time selection
composer.callbackQuery("booking:retry_time", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "booking_time";
  await showTimeSelection(ctx);
});

// Text input handler for booking flow
composer.on("message:text", async (ctx, next) => {
  const step = ctx.session.step;
  if (!step?.startsWith("booking_")) return next();

  const text = ctx.message.text.trim();

  if (step === "booking_name") {
    if (text.length < 2) {
      await ctx.reply("Name must be at least 2 characters. Try again:");
      return;
    }
    ctx.session.bookingName = text;
    ctx.session.step = "booking_phone";

    const store = getStore();
    const user = await store.getUser(ctx.from.id);
    if (user?.phone) {
      ctx.session.bookingPhone = user.phone;
      ctx.session.step = "booking_confirm";
      await showBookingConfirmation(ctx);
    } else {
      await ctx.reply("What's your phone number?", {
        reply_markup: { force_reply: true, input_field_placeholder: "e.g. +1 555 123 4567" },
      });
    }
    return;
  }

  if (step === "booking_phone") {
    if (text.length < 5) {
      await ctx.reply("Please enter a valid phone number. Try again:");
      return;
    }
    ctx.session.bookingPhone = text;
    ctx.session.step = "booking_confirm";
    await showBookingConfirmation(ctx);
    return;
  }

  return next();
});

// ── Helper functions ──────────────────────────────────────────────────────

async function showServiceSelection(ctx: Ctx) {
  const store = getStore();
  const services = await store.listServices();

  if (services.length === 0) {
    await ctx.reply("No services available yet — check back soon!", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
    });
    return;
  }

  const rows = services.map((svc) => [
    inlineButton(`${svc.name} ($${svc.price})`, `booking:svc:${svc.id}`),
  ]);
  rows.push([inlineButton("⬅️ Back to menu", "menu:main")]);

  ctx.session.step = "booking_service";
  await ctx.reply("Which service would you like to book?", {
    reply_markup: inlineKeyboard(rows),
  });
}

async function showDateSelection(ctx: Ctx) {
  const now = new Date();
  const dates: { label: string; value: string }[] = [];

  for (let i = 0; i < 14; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    const dayName = d.toLocaleDateString("en-US", { weekday: "short" });
    const dateStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const isoDate = d.toISOString().split("T")[0]!;
    const prefix = i === 0 ? "Today" : i === 1 ? "Tomorrow" : `${dayName}, ${dateStr}`;
    dates.push({ label: prefix, value: isoDate });
  }

  const rows = [];
  for (let i = 0; i < dates.length; i += 2) {
    const row = [inlineButton(dates[i]!.label, `booking:date:${dates[i]!.value}`)];
    if (dates[i + 1]) {
      row.push(inlineButton(dates[i + 1]!.label, `booking:date:${dates[i + 1]!.value}`));
    }
    rows.push(row);
  }
  rows.push([inlineButton("❌ Cancel", "booking:cancel")]);

  await ctx.reply("Pick a date:", {
    reply_markup: inlineKeyboard(rows),
  });
}

async function showTimeSelection(ctx: Ctx) {
  const store = getStore();
  const { bookingServiceId, bookingDate } = ctx.session;

  if (!bookingServiceId || !bookingDate) {
    await ctx.reply("Something went wrong. Let's start over.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
    });
    clearBookingSession(ctx);
    return;
  }

  const svc = await store.getService(bookingServiceId);
  const duration = svc?.duration ?? 60;

  // Generate time slots from 9:00 to 17:00 in 30-min increments
  const slots: string[] = [];
  for (let h = 9; h < 17; h++) {
    for (let m = 0; m < 60; m += 30) {
      const time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      const endMinutes = h * 60 + m + duration;
      if (endMinutes <= 18 * 60) {
        // Check if slot is available
        const taken = await store.isSlotTaken(bookingDate, time);
        if (!taken) {
          slots.push(time);
        }
      }
    }
  }

  if (slots.length === 0) {
    await ctx.reply("No available time slots for this date. Try another date.", {
      reply_markup: inlineKeyboard([
        [inlineButton("🔄 Pick a different date", "booking:start")],
        [inlineButton("❌ Cancel", "booking:cancel")],
      ]),
    });
    return;
  }

  const rows = [];
  for (let i = 0; i < slots.length; i += 2) {
    const row = [inlineButton(slots[i]!, `booking:time:${slots[i]}`)];
    if (slots[i + 1]) {
      row.push(inlineButton(slots[i + 1]!, `booking:time:${slots[i + 1]}`));
    }
    rows.push(row);
  }
  rows.push([inlineButton("❌ Cancel", "booking:cancel")]);

  await ctx.reply("Available times:", {
    reply_markup: inlineKeyboard(rows),
  });
}

async function showBookingConfirmation(ctx: Ctx) {
  const store = getStore();
  const { bookingServiceId, bookingDate, bookingTime, bookingName, bookingPhone } = ctx.session;

  const svc = bookingServiceId ? await store.getService(bookingServiceId) : undefined;

  const summary =
    `📋 Booking summary:\n\n` +
    `Service: ${svc?.name ?? "Unknown"}\n` +
    `Date: ${bookingDate}\n` +
    `Time: ${bookingTime}\n` +
    `Name: ${bookingName}\n` +
    `Phone: ${bookingPhone}\n\n` +
    `Confirm this booking?`;

  await ctx.reply(summary, {
    reply_markup: confirmKeyboard("booking:confirm"),
  });
}

function clearBookingSession(ctx: Ctx) {
  ctx.session.step = undefined;
  ctx.session.bookingServiceId = undefined;
  ctx.session.bookingDate = undefined;
  ctx.session.bookingTime = undefined;
  ctx.session.bookingStaff = undefined;
  ctx.session.bookingName = undefined;
  ctx.session.bookingPhone = undefined;
}

export default composer;
