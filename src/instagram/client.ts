import { config } from "../config";
import { getAccessToken } from "./token";

/**
 * Minimaler Client fuer die Instagram Graph API ("Instagram API with
 * Instagram Login", eigener Professional-Account). Nur offizielle Endpoints:
 * Content Publishing (Feed/Carousel/Story/Reel) und Comment Moderation auf
 * den EIGENEN Medien. Liken/Kommentieren/Folgen bei fremden Accounts bietet
 * die API nicht an - und das wird hier bewusst auch nicht nachgebaut.
 */

const base = () => `https://${config.igGraphHost}/${config.igApiVersion}`;

async function call<T = any>(
  method: "GET" | "POST",
  path: string,
  params: Record<string, string> = {}
): Promise<T> {
  const qs = new URLSearchParams({ ...params, access_token: getAccessToken() });
  const url = `${base()}${path}?${qs.toString()}`;
  const res = await fetch(url, { method });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    const msg = body?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`Instagram API ${method} ${path}: ${msg}`);
  }
  return body as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wartet, bis ein Media-Container verarbeitet ist (Videos brauchen laenger). */
async function waitForContainer(id: string, timeoutMs = 5 * 60_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { status_code } = await call<{ status_code?: string }>("GET", `/${id}`, {
      fields: "status_code",
    });
    if (status_code === "FINISHED" || status_code === undefined) return;
    if (status_code === "ERROR" || status_code === "EXPIRED") {
      throw new Error(`Container ${id} status ${status_code}`);
    }
    await sleep(5_000);
  }
  throw new Error(`Container ${id} not ready after ${timeoutMs / 1000}s`);
}

async function publishContainer(creationId: string): Promise<string> {
  await waitForContainer(creationId);
  const { id } = await call<{ id: string }>("POST", `/${config.igUserId}/media_publish`, {
    creation_id: creationId,
  });
  return id;
}

export async function publishImage(imageUrl: string, caption: string): Promise<string> {
  const { id } = await call<{ id: string }>("POST", `/${config.igUserId}/media`, {
    image_url: imageUrl,
    caption,
  });
  return publishContainer(id);
}

export async function publishCarousel(imageUrls: string[], caption: string): Promise<string> {
  if (imageUrls.length < 2) return publishImage(imageUrls[0], caption);
  if (imageUrls.length > 10) throw new Error("Carousel: max. 10 images via API");

  const children: string[] = [];
  for (const url of imageUrls) {
    const { id } = await call<{ id: string }>("POST", `/${config.igUserId}/media`, {
      image_url: url,
      is_carousel_item: "true",
    });
    children.push(id);
  }
  for (const c of children) await waitForContainer(c);

  const { id } = await call<{ id: string }>("POST", `/${config.igUserId}/media`, {
    media_type: "CAROUSEL",
    children: children.join(","),
    caption,
  });
  return publishContainer(id);
}

export async function publishStory(imageUrl: string): Promise<string> {
  const { id } = await call<{ id: string }>("POST", `/${config.igUserId}/media`, {
    media_type: "STORIES",
    image_url: imageUrl,
  });
  return publishContainer(id);
}

export async function publishReel(videoUrl: string, caption: string, coverUrl?: string): Promise<string> {
  const { id } = await call<{ id: string }>("POST", `/${config.igUserId}/media`, {
    media_type: "REELS",
    video_url: videoUrl,
    caption,
    ...(coverUrl ? { cover_url: coverUrl } : {}),
  });
  return publishContainer(id);
}

export interface IgComment {
  id: string;
  text: string;
  username: string;
  timestamp: string;
  mediaId: string;
  mediaCaption?: string;
  repliedByMe: boolean;
}

/** Top-Level-Kommentare unter den letzten eigenen Posts. */
/** Captions aller eigenen Posts (fuer "schon gepostet"-Erkennung), seitenweise. */
export async function fetchOwnCaptions(max = 1000): Promise<string[]> {
  const out: string[] = [];
  let page = await call<{ data: { caption?: string }[]; paging?: { next?: string } }>(
    "GET",
    `/${config.igUserId}/media`,
    { fields: "caption", limit: "100" }
  );
  for (;;) {
    for (const m of page.data) if (m.caption) out.push(m.caption);
    const next = page.paging?.next;
    if (!next || out.length >= max) break;
    // "next" ist eine vollstaendige URL inkl. Token und Cursor
    const res = await fetch(next);
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || body.error) throw new Error(`Instagram API paging: ${body?.error?.message ?? res.status}`);
    page = body;
  }
  return out;
}

export async function fetchRecentComments(mediaLimit = 10): Promise<IgComment[]> {
  const me = await call<{ username: string }>("GET", `/${config.igUserId}`, {
    fields: "username",
  });
  const media = await call<{ data: { id: string; caption?: string }[] }>(
    "GET",
    `/${config.igUserId}/media`,
    { fields: "id,caption", limit: String(mediaLimit) }
  );

  const out: IgComment[] = [];
  for (const m of media.data) {
    const comments = await call<{ data: any[] }>("GET", `/${m.id}/comments`, {
      fields: "id,text,username,timestamp,replies{username}",
      limit: "50",
    });
    for (const c of comments.data) {
      if (c.username === me.username) continue;
      out.push({
        id: c.id,
        text: c.text ?? "",
        username: c.username ?? "",
        timestamp: c.timestamp,
        mediaId: m.id,
        mediaCaption: m.caption,
        repliedByMe: (c.replies?.data ?? []).some((r: any) => r.username === me.username),
      });
    }
  }
  return out;
}

/** Blendet einen Kommentar unter einem eigenen Post aus (nicht loeschen). */
export async function hideComment(commentId: string): Promise<void> {
  await call("POST", `/${commentId}`, { hide: "true" });
}

export interface IgProfile {
  username: string;
  name?: string;
  biography?: string;
  website?: string;
  followers_count?: number;
  follows_count?: number;
  media_count?: number;
  profile_picture_url?: string;
}

export interface IgMediaStat {
  id: string;
  caption?: string;
  media_type: string;
  media_product_type?: string;
  timestamp: string;
  permalink?: string;
  thumbnail_url?: string;
  media_url?: string;
  like_count?: number;
  comments_count?: number;
}

/** Profilfelder fuer die Profil-Analyse (/ig-profile) */
export async function fetchProfile(): Promise<IgProfile> {
  return call<IgProfile>("GET", `/${config.igUserId}`, {
    fields: "username,name,biography,website,followers_count,follows_count,media_count,profile_picture_url",
  });
}

/** Letzte Posts mit Likes/Kommentaren */
export async function fetchRecentMediaStats(limit = 24): Promise<IgMediaStat[]> {
  const r = await call<{ data: IgMediaStat[] }>("GET", `/${config.igUserId}/media`, {
    fields: "id,caption,media_type,media_product_type,timestamp,permalink,thumbnail_url,media_url,like_count,comments_count",
    limit: String(limit),
  });
  return r.data;
}

/** Anzahl gerade aktiver Stories */
export async function fetchActiveStoryCount(): Promise<number> {
  const r = await call<{ data: unknown[] }>("GET", `/${config.igUserId}/stories`, { fields: "id" });
  return r.data.length;
}

/** Kommentare eines Posts mit Info, ob der Account selbst geantwortet hat */
export async function commentReplyRate(mediaId: string, username: string): Promise<{ total: number; answered: number }> {
  const r = await call<{ data: any[] }>("GET", `/${mediaId}/comments`, { fields: "username,replies{username}", limit: "50" });
  const others = r.data.filter((c) => c.username !== username);
  const answered = others.filter((c) => (c.replies?.data ?? []).some((x: any) => x.username === username)).length;
  return { total: others.length, answered };
}

/** Kommentar unter einem eigenen Post (z. B. Decklisten-Link als erster Kommentar). */
export async function commentOnMedia(mediaId: string, message: string): Promise<string> {
  const { id } = await call<{ id: string }>("POST", `/${mediaId}/comments`, { message });
  return id;
}

export async function replyToComment(commentId: string, message: string): Promise<string> {
  const { id } = await call<{ id: string }>("POST", `/${commentId}/replies`, { message });
  return id;
}
