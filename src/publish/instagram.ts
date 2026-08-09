import axios from "axios";
import { config, requireInstagramConfigured } from "../config";

/**
 * WICHTIG (siehe SPEC.md "Instagram-Publishing"): Graph-API-Endpoints und
 * die genaue Versionsnummer aendern sich gelegentlich. Vor dem ersten
 * echten Publish gegen die aktuelle Meta-Doku pruefen:
 * https://developers.facebook.com/docs/instagram-platform/content-publishing
 */
const GRAPH_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const MAX_CAROUSEL_ITEMS = 10;
const CONTAINER_POLL_INTERVAL_MS = 2000;
const CONTAINER_POLL_TIMEOUT_MS = 60_000;

interface GraphError {
  error?: { message?: string; type?: string; code?: number };
}

function throwIfError(data: GraphError, context: string): void {
  if (data?.error) {
    throw new Error(
      `Instagram Graph API Fehler bei ${context}: ${data.error.message ?? JSON.stringify(data.error)}`
    );
  }
}

async function createCarouselItem(imageUrl: string): Promise<string> {
  const { igUserId, accessToken } = config.instagram;
  const res = await axios.post(`${GRAPH_BASE}/${igUserId}/media`, null, {
    params: {
      image_url: imageUrl,
      is_carousel_item: true,
      access_token: accessToken,
    },
  });
  throwIfError(res.data, "Carousel-Item-Erstellung");
  return res.data.id as string;
}

async function waitUntilFinished(containerId: string): Promise<void> {
  const { accessToken } = config.instagram;
  const deadline = Date.now() + CONTAINER_POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const res = await axios.get(`${GRAPH_BASE}/${containerId}`, {
      params: { fields: "status_code", access_token: accessToken },
    });
    throwIfError(res.data, "Status-Abfrage");
    const status = res.data.status_code;
    if (status === "FINISHED") return;
    if (status === "ERROR") {
      throw new Error(`Instagram-Container ${containerId} ist fehlgeschlagen (status ERROR)`);
    }
    await new Promise((resolve) => setTimeout(resolve, CONTAINER_POLL_INTERVAL_MS));
  }
  throw new Error(`Timeout beim Warten auf Container ${containerId} (status_code != FINISHED)`);
}

async function createCarouselContainer(
  childIds: string[],
  caption: string
): Promise<string> {
  const { igUserId, accessToken } = config.instagram;
  const res = await axios.post(`${GRAPH_BASE}/${igUserId}/media`, null, {
    params: {
      media_type: "CAROUSEL",
      children: childIds.join(","),
      caption,
      access_token: accessToken,
    },
  });
  throwIfError(res.data, "Carousel-Container-Erstellung");
  return res.data.id as string;
}

async function publishContainer(containerId: string): Promise<string> {
  const { igUserId, accessToken } = config.instagram;
  const res = await axios.post(`${GRAPH_BASE}/${igUserId}/media_publish`, null, {
    params: { creation_id: containerId, access_token: accessToken },
  });
  throwIfError(res.data, "media_publish");
  return res.data.id as string;
}

/**
 * Veroeffentlicht ein Carousel aus oeffentlich erreichbaren Bild-URLs
 * (siehe publish/storage.ts fuer den S3/R2-Upload davor). Max. 10 Bilder
 * pro Carousel (API-Hardlimit). Gibt die veroeffentlichte Media-ID zurueck.
 */
export async function publishCarousel(
  imageUrls: string[],
  caption: string
): Promise<string> {
  requireInstagramConfigured();

  if (imageUrls.length === 0) {
    throw new Error("Keine Bilder zum Veroeffentlichen");
  }
  if (imageUrls.length > MAX_CAROUSEL_ITEMS) {
    throw new Error(
      `Zu viele Slides fuer ein Carousel (${imageUrls.length} > ${MAX_CAROUSEL_ITEMS})`
    );
  }

  const childIds: string[] = [];
  for (const url of imageUrls) {
    childIds.push(await createCarouselItem(url));
  }

  const containerId = await createCarouselContainer(childIds, caption);
  await waitUntilFinished(containerId);
  return publishContainer(containerId);
}
