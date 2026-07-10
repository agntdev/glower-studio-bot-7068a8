// Persistent store for GlowEr Beauty Studio — Redis-backed with in-memory fallback.
// Maintains explicit INDEX records to avoid keyspace scans (O(N) Redis hazard).
// Durable domain data only; ephemeral conversation state lives in the session.

import { type RedisLike } from "./toolkit/session/redis.js";

// ── Entity types ──────────────────────────────────────────────────────────

export interface Service {
  id: string;
  name: string;
  description: string;
  duration: number; // minutes
  price: number; // in the studio's currency (e.g. USD cents or local)
  categories: string[];
}

export interface GalleryItem {
  id: string;
  photoFileId: string;
  caption: string;
  tags: string[];
  serviceId?: string;
}

export interface Review {
  id: string;
  appointmentId: string;
  authorId: number;
  authorName: string;
  rating: number; // 1-5
  text: string;
  photoFileIds: string[];
  response?: string;
  respondedBy?: number;
  status: "pending" | "responded";
  createdAt: number; // unix ms
}

export interface Appointment {
  id: string;
  clientName: string;
  clientTelegramId: number;
  clientPhone: string;
  serviceId: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  staffMember?: string;
  status: "booked" | "confirmed" | "completed" | "cancelled";
  notes?: string;
  createdAt: number;
}

export interface User {
  telegramId: number;
  name: string;
  phone?: string;
  isAdmin: boolean;
  createdAt: number;
}

export interface AdminSettings {
  adminChatId?: number;
  staffIds: number[];
  studioHours: StudioHours;
}

export interface StudioHours {
  // dayOfWeek (0=Sun, 1=Mon, ...) → { open: "HH:MM", close: "HH:MM" } or null (closed)
  [day: number]: { open: string; close: string } | null;
}

// ── Memory client (in-memory fallback for dev/test) ───────────────────────

class MemoryClient implements RedisLike {
  private store = new Map<string, string>();
  async get(key: string): Promise<string | null> { return this.store.get(key) ?? null; }
  async set(key: string, value: string): Promise<void> { this.store.set(key, value); }
  async del(key: string): Promise<void> { this.store.delete(key); }
  async keys(pattern: string): Promise<string[]> {
    const prefix = pattern.replace("*", "");
    return [...this.store.keys()].filter((k) => k.startsWith(prefix));
  }
}

// ── PersistentStore ───────────────────────────────────────────────────────

export class PersistentStore {
  private c: RedisLike;

  constructor(client?: RedisLike) {
    this.c = client ?? new MemoryClient();
  }

  // ── Generic helpers ───────────────────────────────────────────────────

  private async readIndex(prefix: string): Promise<string[]> {
    const raw = await this.c.get(`idx:${prefix}`);
    return raw ? JSON.parse(raw) : [];
  }

  private async writeIndex(prefix: string, ids: string[]): Promise<void> {
    await this.c.set(`idx:${prefix}`, JSON.stringify(ids));
  }

  private async getOne<T>(prefix: string, id: string): Promise<T | undefined> {
    const raw = await this.c.get(`${prefix}:${id}`);
    return raw ? (JSON.parse(raw) as T) : undefined;
  }

  private async putOne<T extends { id: string }>(prefix: string, item: T): Promise<void> {
    await this.c.set(`${prefix}:${item.id}`, JSON.stringify(item));
    const ids = await this.readIndex(prefix);
    if (!ids.includes(item.id)) {
      ids.push(item.id);
      await this.writeIndex(prefix, ids);
    }
  }

  private async removeOne(prefix: string, id: string): Promise<void> {
    await this.c.del(`${prefix}:${id}`);
    const ids = await this.readIndex(prefix);
    await this.writeIndex(prefix, ids.filter((i) => i !== id));
  }

  private async getAll<T>(prefix: string): Promise<T[]> {
    const ids = await this.readIndex(prefix);
    const items: T[] = [];
    for (const id of ids) {
      const item = await this.getOne<T>(prefix, id);
      if (item) items.push(item);
    }
    return items;
  }

  private async nextId(prefix: string): Promise<string> {
    const raw = await this.c.get(`counter:${prefix}`);
    const next = (raw ? parseInt(raw, 10) : 0) + 1;
    await this.c.set(`counter:${prefix}`, String(next));
    return String(next);
  }

  // ── Services ──────────────────────────────────────────────────────────

  async listServices(): Promise<Service[]> {
    return this.getAll<Service>("svc");
  }

  async getService(id: string): Promise<Service | undefined> {
    return this.getOne<Service>("svc", id);
  }

  async saveService(svc: Service): Promise<void> {
    await this.putOne("svc", svc);
  }

  async createService(data: Omit<Service, "id">): Promise<Service> {
    const id = await this.nextId("svc");
    const svc: Service = { ...data, id };
    await this.saveService(svc);
    return svc;
  }

  async deleteService(id: string): Promise<void> {
    await this.removeOne("svc", id);
  }

  async listServicesByCategory(category: string): Promise<Service[]> {
    const all = await this.listServices();
    return all.filter((s) => s.categories.includes(category));
  }

  // ── Gallery ───────────────────────────────────────────────────────────

  async listGalleryItems(): Promise<GalleryItem[]> {
    return this.getAll<GalleryItem>("gal");
  }

  async getGalleryItem(id: string): Promise<GalleryItem | undefined> {
    return this.getOne<GalleryItem>("gal", id);
  }

  async saveGalleryItem(item: GalleryItem): Promise<void> {
    await this.putOne("gal", item);
  }

  async createGalleryItem(data: Omit<GalleryItem, "id">): Promise<GalleryItem> {
    const id = await this.nextId("gal");
    const item: GalleryItem = { ...data, id };
    await this.saveGalleryItem(item);
    return item;
  }

  async deleteGalleryItem(id: string): Promise<void> {
    await this.removeOne("gal", id);
  }

  // ── Reviews ───────────────────────────────────────────────────────────

  async listReviews(): Promise<Review[]> {
    return this.getAll<Review>("rev");
  }

  async getReview(id: string): Promise<Review | undefined> {
    return this.getOne<Review>("rev", id);
  }

  async saveReview(rev: Review): Promise<void> {
    await this.putOne("rev", rev);
  }

  async createReview(data: Omit<Review, "id" | "createdAt" | "status">): Promise<Review> {
    const id = await this.nextId("rev");
    const rev: Review = { ...data, id, status: "pending", createdAt: Date.now() };
    await this.saveReview(rev);
    return rev;
  }

  async respondToReview(id: string, response: string, adminId: number): Promise<void> {
    const rev = await this.getReview(id);
    if (!rev) return;
    rev.response = response;
    rev.respondedBy = adminId;
    rev.status = "responded";
    await this.saveReview(rev);
  }

  async listPendingReviews(): Promise<Review[]> {
    const all = await this.listReviews();
    return all.filter((r) => r.status === "pending");
  }

  // ── Appointments ──────────────────────────────────────────────────────

  async listAppointments(): Promise<Appointment[]> {
    return this.getAll<Appointment>("apt");
  }

  async getAppointment(id: string): Promise<Appointment | undefined> {
    return this.getOne<Appointment>("apt", id);
  }

  async saveAppointment(apt: Appointment): Promise<void> {
    await this.putOne("apt", apt);
  }

  async createAppointment(data: Omit<Appointment, "id" | "createdAt">): Promise<Appointment> {
    const id = await this.nextId("apt");
    const apt: Appointment = { ...data, id, createdAt: Date.now() };
    await this.saveAppointment(apt);
    return apt;
  }

  async listUpcomingAppointments(): Promise<Appointment[]> {
    const all = await this.listAppointments();
    return all.filter((a) => a.status === "booked" || a.status === "confirmed");
  }

  async listAppointmentsByClient(telegramId: number): Promise<Appointment[]> {
    const all = await this.listAppointments();
    return all.filter((a) => a.clientTelegramId === telegramId);
  }

  async listCompletedAppointmentsByClient(telegramId: number): Promise<Appointment[]> {
    const all = await this.listAppointments();
    return all.filter(
      (a) => a.clientTelegramId === telegramId && a.status === "completed",
    );
  }

  async updateAppointmentStatus(
    id: string,
    status: Appointment["status"],
  ): Promise<void> {
    const apt = await this.getAppointment(id);
    if (!apt) return;
    apt.status = status;
    await this.saveAppointment(apt);
  }

  // ── Users ─────────────────────────────────────────────────────────────

  async getUser(telegramId: number): Promise<User | undefined> {
    return this.getOne<User>("usr", String(telegramId));
  }

  async saveUser(user: User): Promise<void> {
    await this.c.set(`usr:${user.telegramId}`, JSON.stringify(user));
    const ids = await this.readIndex("usr");
    if (!ids.includes(String(user.telegramId))) {
      ids.push(String(user.telegramId));
      await this.writeIndex("usr", ids);
    }
  }

  async upsertUser(data: { telegramId: number; name: string; phone?: string }): Promise<User> {
    const existing = await this.getUser(data.telegramId);
    if (existing) {
      existing.name = data.name;
      if (data.phone) existing.phone = data.phone;
      await this.saveUser(existing);
      return existing;
    }
    const isAdmin = isUserAdmin(data.telegramId);
    const user: User = {
      telegramId: data.telegramId,
      name: data.name,
      phone: data.phone,
      isAdmin,
      createdAt: Date.now(),
    };
    await this.saveUser(user);
    return user;
  }

  // ── Admin settings ────────────────────────────────────────────────────

  async getAdminSettings(): Promise<AdminSettings> {
    const raw = await this.c.get("admin:settings");
    if (raw) return JSON.parse(raw) as AdminSettings;
    return defaultAdminSettings();
  }

  async saveAdminSettings(settings: AdminSettings): Promise<void> {
    await this.c.set("admin:settings", JSON.stringify(settings));
  }

  // ── Slot availability ─────────────────────────────────────────────────

  async isSlotTaken(date: string, time: string, staffMember?: string): Promise<boolean> {
    const apts = await this.listAppointments();
    return apts.some(
      (a) =>
        a.date === date &&
        a.time === time &&
        a.status !== "cancelled" &&
        (staffMember ? a.staffMember === staffMember : true),
    );
  }
}

// ── Admin auth helpers ────────────────────────────────────────────────────

function isUserAdmin(telegramId: number): boolean {
  const adminIds = process.env.ADMIN_IDS ?? "";
  return adminIds
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(String(telegramId));
}

export function isAdmin(telegramId: number): boolean {
  return isUserAdmin(telegramId);
}

function defaultStudioHours(): StudioHours {
  return {
    0: null, // Sun closed
    1: { open: "09:00", close: "18:00" },
    2: { open: "09:00", close: "18:00" },
    3: { open: "09:00", close: "18:00" },
    4: { open: "09:00", close: "18:00" },
    5: { open: "09:00", close: "18:00" },
    6: { open: "10:00", close: "16:00" }, // Sat shorter
  };
}

function defaultAdminSettings(): AdminSettings {
  return {
    staffIds: [],
    studioHours: defaultStudioHours(),
  };
}

// ── Singleton store (resolved once per bot instance) ──────────────────────

import { createRequire } from "node:module";

let _store: PersistentStore | undefined;

export function getStore(): PersistentStore {
  if (!_store) {
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      try {
        const req = createRequire(import.meta.url);
        const ioredis = req("ioredis");
        const Redis = ioredis.default ?? ioredis.Redis ?? ioredis;
        const client = new Redis(redisUrl, {
          maxRetriesPerRequest: null,
          lazyConnect: false,
        });
        _store = new PersistentStore(client as RedisLike);
      } catch {
        _store = new PersistentStore();
      }
    } else {
      _store = new PersistentStore();
    }
  }
  return _store;
}
