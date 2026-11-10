import { credentialEnv } from "./env.js";
import { normalizeChannel, type Snapshot, type Status, type Message, type JourneyStep } from "../core/snapshot.js";
import { arr, getJson, mapLimit, obj, str } from "./http.js";
import { missingEnv, type Adapter, type AdapterOptions, type LaunchStats } from "./types.js";

// Braze REST API. Read-only endpoints only; the key needs: campaigns.list, campaigns.details,
// campaigns.data_series, canvas.list, canvas.details, canvas.data_summary, segments.list,
// segments.details, content_blocks.list, content_blocks.info.
//
// Known gap: campaign/Canvas details don't say which segment they target, so audience edges are
// recorded as "unknown" and can be filled in from the dashboard (seen-on-screen).

function status(d: Record<string, unknown>): Status {
  if (d.archived === true) return "archived";
  if (d.draft === true) return "draft";
  if (d.enabled === true) return "live";
  return "stopped";
}

// Braze's docs show two shapes: campaign details use `alert` (push body) and `message` (in-app body);
// the Canvas example uses `body` and `header`. Accept both. Push tap-through is `action`.
function mapMessages(raw: unknown, ownerId: string, prefix: string): Message[] {
  return Object.entries(obj(raw))
    .filter(([, m]) => str(obj(m).type) !== "control")
    .map(([variationId, m]) => {
      const msg = obj(m);
      const platformChannel = str(msg.channel) ?? "unknown";
      return {
        id: variationId,
        name: str(msg.name) ?? `${prefix} (${platformChannel})`,
        channel: normalizeChannel(platformChannel),
        platformChannel,
        ownerId,
        subject: str(msg.subject),
        preheader: str(msg.preheader),
        from: str(msg.from),
        title: str(msg.title) ?? str(msg.header),
        deepLink: str(msg.action) ?? str(msg.uri),
        imageUrl: str(msg.image_url),
        body: str(msg.body) ?? str(msg.alert) ?? str(msg.message) ?? str(msg.description) ?? "",
        webhookUrl: str(msg.url),
        webhookMethod: str(msg.method),
      };
    });
}

// Most list endpoints page with ?page=N (100 per page); content blocks use ?limit=&offset= instead.
async function listAll(
  base: string,
  path: string,
  key: string,
  headers: Record<string, string>,
  opts: AdapterOptions,
  paging: "page" | "offset" = "page",
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let page = 0; page < 200; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const query = paging === "page" ? `page=${page}` : `limit=100&offset=${page * 100}`;
    const res = obj(await getJson(`${base}${path}${sep}${query}`, headers, { fetcher: opts.fetcher }));
    const items = arr(res[key]).map(obj);
    out.push(...items);
    if (items.length < 100) break;
  }
  return out;
}

/** The REST endpoint as a usable address: "rest.iad-01.braze.com" gets https://; plain http is refused. */
export function brazeEndpoint(raw: string): string {
  const value = raw.trim().replace(/\/+$/, "");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(
      `The Braze REST endpoint "${raw}" isn't a web address. It looks like https://rest.iad-01.braze.com (Braze: Settings → APIs and Identifiers).`,
    );
  }
  if (url.protocol !== "https:")
    throw new Error(`The Braze REST endpoint must start with https:// (got "${raw}"); the API key would otherwise travel unencrypted.`);
  return withScheme;
}

export function brazeAdapter(opts: AdapterOptions = {}): Adapter {
  const env = opts.env ?? credentialEnv();
  const key = env.BRAZE_API_KEY;
  if (!key || !env.BRAZE_REST_ENDPOINT?.trim()) throw missingEnv("braze", ["BRAZE_API_KEY", "BRAZE_REST_ENDPOINT"]);
  const base = brazeEndpoint(env.BRAZE_REST_ENDPOINT);
  const headers = { authorization: `Bearer ${key}` };
  const get = (path: string) => getJson<Record<string, unknown>>(`${base}${path}`, headers, { fetcher: opts.fetcher });
  const workspace = env.BRAZE_WORKSPACE ?? "default";

  return {
    platform: "braze",
    workspace,

    async ping() {
      const res = await get("/segments/list?page=0");
      return `Connected to Braze (${new URL(base).host}); ${arr(res.segments).length}+ segments visible.`;
    },

    async snapshot(previous) {
      const gaps: string[] = [
        "Braze's API doesn't expose which segment a campaign or Canvas targets; those audience links are marked unknown.",
      ];
      const prevCampaigns = new Map(previous?.campaigns.map((c) => [c.id, c]));
      const prevJourneys = new Map(previous?.journeys.map((j) => [j.id, j]));
      const prevMessages = new Map<string, Message[]>();
      for (const m of previous?.messages ?? []) if (m.ownerId) prevMessages.set(m.ownerId, [...(prevMessages.get(m.ownerId) ?? []), m]);

      const snap: Snapshot = {
        platform: "braze",
        workspace,
        takenAt: new Date().toISOString(),
        campaigns: [],
        journeys: [],
        messages: [],
        segments: [],
        contentBlocks: [],
        gaps,
      };

      // Campaigns: details only for ones edited since the last snapshot.
      const campaigns = await listAll(base, "/campaigns/list?include_archived=false&sort_direction=desc", "campaigns", headers, opts);
      await mapLimit(campaigns, 5, async (c) => {
        const id = str(c.id)!;
        const prev = prevCampaigns.get(id);
        if (prev && prev.updatedAt && prev.updatedAt === str(c.last_edited)) {
          snap.campaigns.push(prev);
          snap.messages.push(...(prevMessages.get(id) ?? []));
          return;
        }
        try {
          const d = await get(`/campaigns/details?campaign_id=${encodeURIComponent(id)}`);
          const messages = mapMessages(d.messages, id, str(d.name) ?? id);
          snap.messages.push(...messages);
          snap.campaigns.push({
            id,
            name: str(d.name) ?? str(c.name) ?? id,
            status: status(d),
            channels: arr(d.channels).map((c) => normalizeChannel(String(c))),
            messageIds: messages.map((m) => m.id),
            audience: [{ id: "?", kind: "unknown", mode: "include", confidence: "unknown" }],
            conversionEvents: arr(d.conversion_behaviors).map((b) => str(obj(b).custom_event_name) ?? str(obj(b).type) ?? "conversion"),
            tags: arr(d.tags).map(String),
            updatedAt: str(c.last_edited) ?? str(d.updated_at),
          });
        } catch (e) {
          gaps.push(`Campaign "${str(c.name)}" could not be read: ${(e as Error).message}`);
        }
      });

      // Canvases.
      const canvases = await listAll(base, "/canvas/list?include_archived=false&sort_direction=desc", "canvases", headers, opts);
      await mapLimit(canvases, 5, async (c) => {
        const id = str(c.id)!;
        const prev = prevJourneys.get(id);
        if (prev && prev.updatedAt && prev.updatedAt === str(c.last_edited)) {
          snap.journeys.push(prev);
          snap.messages.push(...(prevMessages.get(id) ?? []));
          return;
        }
        try {
          const d = await get(`/canvas/details?canvas_id=${encodeURIComponent(id)}`);
          const steps: JourneyStep[] = arr(d.steps).map((raw) => {
            const s = obj(raw);
            const messages = mapMessages(s.messages, id, `${str(d.name)} · ${str(s.name)}`);
            snap.messages.push(...messages);
            const next = new Set<string>(arr(s.next_step_ids).map(String));
            for (const p of arr(s.next_paths)) {
              const n = str(obj(p).next_step_id);
              if (n) next.add(n);
            }
            return {
              id: str(s.id) ?? "",
              name: str(s.name) ?? "",
              type: str(s.type) ?? "step",
              messageIds: messages.map((m) => m.id),
              next: [...next],
            };
          });
          snap.journeys.push({
            id,
            name: str(d.name) ?? id,
            status: status(d),
            entryStepIds: arr(d.variants).flatMap((v) => arr(obj(v).first_step_ids).map(String)),
            steps,
            stepsKnown: true,
            audience: [{ id: "?", kind: "unknown", mode: "include", confidence: "unknown" }],
            conversionEvents: arr(d.conversion_behaviors).map((b) => str(obj(b).custom_event_name) ?? str(obj(b).type) ?? "conversion"),
            tags: arr(d.tags).map(String),
            updatedAt: str(c.last_edited),
          });
        } catch (e) {
          gaps.push(`Canvas "${str(c.name)}" could not be read: ${(e as Error).message}`);
        }
      });

      // Segments: Braze only gives a prose description of the filters.
      const segments = await listAll(base, "/segments/list?sort_direction=desc", "segments", headers, opts);
      await mapLimit(segments, 5, async (s) => {
        const id = str(s.id)!;
        try {
          const d = await get(`/segments/details?segment_id=${encodeURIComponent(id)}`);
          snap.segments.push({
            id,
            name: str(d.name) ?? str(s.name) ?? id,
            kind: "segment",
            description: str(d.description),
            updatedAt: str(d.updated_at),
          });
        } catch {
          snap.segments.push({ id, name: str(s.name) ?? id, kind: "segment" });
        }
      });

      // Content blocks, with the platform's own list of messages that include each one.
      const blocks = await listAll(base, "/content_blocks/list", "content_blocks", headers, opts, "offset").catch(() => {
        gaps.push("Content blocks could not be listed (the key may lack content_blocks.list).");
        return [];
      });
      await mapLimit(blocks, 5, async (b) => {
        const id = str(b.content_block_id) ?? str(b.id)!;
        try {
          const d = await get(`/content_blocks/info?content_block_id=${encodeURIComponent(id)}&include_inclusion_data=true`);
          const usedBy = arr(d.inclusion_data)
            .map((x) => str(obj(x).message_variation_id) ?? str(obj(x).message_variation_api_id) ?? str(x) ?? "")
            .filter(Boolean);
          snap.contentBlocks.push({
            id,
            name: str(d.name) ?? str(b.name) ?? id,
            body: str(d.content) ?? "",
            usedBy,
            updatedAt: str(d.last_edited),
          });
        } catch {
          snap.contentBlocks.push({ id, name: str(b.name) ?? id, body: "", usedBy: [] });
        }
      });

      return snap;
    },

    async launchStats(kind, id) {
      if (kind === "campaign") {
        const d = await get(`/campaigns/data_series?campaign_id=${encodeURIComponent(id)}&length=7`);
        const totals: LaunchStats = {
          period: "last 7 days",
          sent: 0,
          delivered: 0,
          bounces: 0,
          unsubscribes: 0,
          spamReports: 0,
          uniqueOpens: 0,
          uniqueClicks: 0,
          notes: [],
        };
        for (const day of arr(d.data)) {
          for (const variants of Object.values(obj(obj(day).messages))) {
            for (const v of arr(variants).map(obj)) {
              totals.sent += Number(v.sent ?? 0);
              totals.delivered! += Number(v.delivered ?? 0);
              totals.bounces! += Number(v.bounces ?? 0);
              totals.unsubscribes! += Number(v.unsubscribes ?? 0);
              totals.spamReports! += Number(v.reported_spam ?? 0);
              totals.uniqueOpens! += Number(v.unique_opens ?? 0);
              totals.uniqueClicks! += Number(v.unique_clicks ?? 0);
            }
          }
        }
        return totals;
      }
      const d = await get(
        `/canvas/data_summary?canvas_id=${encodeURIComponent(id)}&ending_at=${encodeURIComponent(new Date().toISOString())}&length=7&include_variant_breakdown=false&include_step_breakdown=false`,
      );
      const stats = obj(obj(d.data).total_stats);
      return {
        period: "last 7 days",
        sent: Number(stats.entries ?? 0),
        notes: [
          "Braze's Canvas summary reports entries and revenue, not per-message bounces or unsubscribes; check the Canvas analytics page for those.",
        ],
      };
    },
  };
}
