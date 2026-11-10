import { credentialEnv } from "./env.js";
import { normalizeChannel, type Snapshot, type Status } from "../core/snapshot.js";
import { arr, getJson, getText, mapLimit, obj, str } from "./http.js";
import { missingEnv, type Adapter, type AdapterOptions, type LaunchStats } from "./types.js";

// Iterable REST API (US or EU data center). A read-only server-side key is enough.
// Known gap: the API lists journeys but doesn't return their step graph, so journey steps are
// reconstructed from the campaigns attached to each journey, in unknown order.

/** CSV rows, with quoted fields (commas, quotes and line breaks inside them) read correctly. */
export function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const text = csv.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows;
}

function campaignStatus(state: string | undefined): Status {
  switch ((state ?? "").toLowerCase()) {
    case "running":
    case "starting":
    case "recurring":
    case "ready":
      return "live";
    case "scheduled":
      return "scheduled";
    case "finished":
      return "sent";
    case "aborted":
      return "stopped";
    case "archived":
      return "archived";
    default:
      return "draft";
  }
}

export function iterableAdapter(opts: AdapterOptions = {}): Adapter {
  const env = opts.env ?? credentialEnv();
  const key = env.ITERABLE_API_KEY;
  if (!key) throw missingEnv("iterable", ["ITERABLE_API_KEY"]);
  const base = env.ITERABLE_REGION?.toLowerCase() === "eu" ? "https://api.eu.iterable.com/api" : "https://api.iterable.com/api";
  const headers = { "api-key": key };
  const get = (path: string) => getJson<Record<string, unknown>>(`${base}${path}`, headers, { fetcher: opts.fetcher });
  const workspace = env.ITERABLE_PROJECT ?? "default";

  return {
    platform: "iterable",
    workspace,

    async ping() {
      const res = await get("/lists");
      return `Connected to Iterable (${new URL(base).host}); ${arr(res.lists).length} lists visible.`;
    },

    async snapshot(previous) {
      const gaps = [
        "Iterable's API doesn't return journey step graphs; journey steps are rebuilt from attached campaigns, in unknown order.",
        "Iterable dynamic segment logic isn't available from the API; lists are mapped, their criteria are not.",
      ];
      const snap: Snapshot = {
        platform: "iterable",
        workspace,
        takenAt: new Date().toISOString(),
        campaigns: [],
        journeys: [],
        messages: [],
        segments: [],
        contentBlocks: [],
        gaps,
      };
      const prevMessages = new Map(previous?.messages.map((m) => [m.id, m]));
      const prevCampaigns = new Map(previous?.campaigns.map((c) => [c.id, c]));

      for (const l of arr((await get("/lists")).lists).map(obj)) {
        snap.segments.push({ id: str(l.id) ?? "", name: str(l.name) ?? "", kind: "list", description: str(l.listType) });
      }

      // Paginate: the unpaginated form of GET /campaigns is deprecated (pageSize max 1000).
      const campaigns: Record<string, unknown>[] = [];
      for (let page = 1; page < 200; page++) {
        const res = await get(`/campaigns?page=${page}&pageSize=1000&sort=-updatedAt`);
        const batch = arr(res.campaigns).map(obj);
        campaigns.push(...batch);
        if (batch.length < 1000 || !str(res.nextPageUrl)) break;
      }
      let skippedOld = 0;
      await mapLimit(campaigns, 5, async (c) => {
        const id = str(c.id)!;
        const templateId = str(c.templateId);
        const medium = (str(c.messageMedium) ?? "email").toLowerCase();
        const messageId = templateId ? `template:${templateId}` : undefined;
        const updatedAt = str(c.updatedAt);
        // Finished campaigns older than 90 days are kept as metadata only; fetching every historical
        // template would make the first refresh of a large project take hours.
        const state = (str(c.campaignState) ?? "").toLowerCase();
        const stale = ["finished", "archived", "aborted"].includes(state) && Date.now() - Number(c.updatedAt ?? 0) > 90 * 86_400_000;
        if (stale) skippedOld++;
        if (messageId && !stale) {
          const prev = prevMessages.get(messageId);
          // Reuse saved content only for a campaign that has finished. A template can be edited without
          // its campaign's updatedAt moving, and stale content would be QA'd as current.
          const final = ["finished", "archived", "aborted"].includes(state);
          if (prev && final && prevCampaigns.get(id)?.updatedAt === updatedAt) {
            snap.messages.push(prev);
          } else {
            const kind = normalizeChannel(medium);
            const path = { email: "email", push: "push", sms: "sms", "in-app": "inapp" }[kind as string];
            if (!path) {
              snap.messages.push({
                id: messageId,
                name: str(c.name) ?? messageId,
                channel: kind,
                platformChannel: medium,
                ownerId: id,
                body: "",
              });
              gaps.push(`"${str(c.name)}" is a ${medium} campaign; its content can't be read through Iterable's API.`);
            } else {
              try {
                const tpl = obj(await get(`/templates/${path}/get?templateId=${encodeURIComponent(templateId!)}`));
                // Push: Studio templates keep the tap destination in defaultAction; the legacy deeplink may be empty.
                const action = obj(tpl.defaultAction);
                const legacy = obj(tpl.deeplink);
                snap.messages.push({
                  id: messageId,
                  name: str(tpl.name) ?? str(c.name) ?? messageId,
                  channel: kind,
                  platformChannel: medium,
                  ownerId: id,
                  subject: str(tpl.subject),
                  preheader: str(tpl.preheaderText),
                  from: str(tpl.fromEmail),
                  title: str(tpl.title) ?? str(obj(tpl.inboxMetadata).title),
                  deepLink: str(action.data) ?? str(legacy.ios) ?? str(legacy.android),
                  imageUrl: str(tpl.imageUrl),
                  buttons: arr(tpl.buttons).map((b) => ({ text: str(obj(b).title) ?? "", link: str(obj(obj(b).action).data) })),
                  body: str(tpl.html) ?? str(tpl.message) ?? "",
                });
              } catch (e) {
                gaps.push(`Template for "${str(c.name)}" could not be read: ${(e as Error).message}`);
              }
            }
          }
        }
        snap.campaigns.push({
          id,
          name: str(c.name) ?? id,
          status: campaignStatus(str(c.campaignState)),
          channels: [normalizeChannel(medium)],
          messageIds: messageId ? [messageId] : [],
          audience: [
            // Triggered campaigns have no send list; their trigger isn't in the API, so say "unknown", not "none".
            ...(arr(c.listIds).length === 0 && str(c.type) === "Triggered"
              ? [
                  {
                    id: str(c.workflowId) ? `journey:${str(c.workflowId)}` : "?",
                    kind: "unknown" as const,
                    mode: "trigger" as const,
                    confidence: "unknown" as const,
                  },
                ]
              : []),
            ...arr(c.listIds).map((x) => ({
              id: String(x),
              kind: "list" as const,
              mode: "include" as const,
              confidence: "api-verified" as const,
            })),
            ...arr(c.suppressionListIds).map((x) => ({
              id: String(x),
              kind: "list" as const,
              mode: "exclude" as const,
              confidence: "api-verified" as const,
            })),
          ],
          tags: [str(c.type), str(c.workflowId) ? `journey:${str(c.workflowId)}` : undefined].filter((x): x is string => !!x),
          updatedAt,
        });
      });

      if (skippedOld) gaps.push(`${skippedOld} finished campaigns older than 90 days were listed without their content.`);
      const journeys: Record<string, unknown>[] = [];
      try {
        for (let page = 1; page < 200; page++) {
          const res = await get(`/journeys?page=${page}&pageSize=50`);
          const batch = arr(res.journeys).map(obj);
          journeys.push(...batch);
          if (batch.length < 50 || !str(res.nextPageUrl)) break;
        }
      } catch (e) {
        gaps.push(`Journeys could not be listed: ${(e as Error).message}`);
      }
      for (const j of journeys) {
        const id = str(j.id) ?? "";
        const attached = snap.campaigns.filter((c) => c.tags?.includes(`journey:${id}`));
        const enabled = j.enabled;
        snap.journeys.push({
          id,
          name: str(j.name) ?? id,
          status:
            j.isArchived === true ? "archived" : enabled === true ? "live" : enabled === false ? "draft" : campaignStatus(str(j.state)),
          entryStepIds: [],
          steps: attached.map((c) => ({ id: c.id, name: c.name, type: "message (order unknown)", messageIds: c.messageIds, next: [] })),
          stepsKnown: false,
          audience: arr(j.triggerEventNames).map((e) => ({
            id: String(e),
            kind: "event" as const,
            mode: "trigger" as const,
            confidence: "api-verified" as const,
          })),
          tags: obj(j.draft).id ? ["has an unpublished draft"] : [],
          updatedAt: str(j.updatedAt),
        });
      }
      return snap;
    },

    async launchStats(kind, id) {
      if (kind === "journey") {
        return {
          period: "n/a",
          sent: 0,
          notes: ["Iterable journey-level metrics aren't available from the API; run this on the journey's campaigns instead."],
        };
      }
      const start = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 19).replace("T", " ");
      const csv = await getText(
        `${base}/campaigns/metrics?campaignId=${encodeURIComponent(id)}&startDateTime=${encodeURIComponent(start)}`,
        headers,
        opts.fetcher,
      );
      const [header, ...rows] = parseCsv(csv);
      const col = (name: RegExp) => {
        const i = (header ?? []).findIndex((h) => name.test(h));
        return i < 0 ? undefined : rows.reduce((sum, r) => sum + (Number((r[i] ?? "").replace(/,/g, "")) || 0), 0);
      };
      return {
        period: "last 7 days",
        sent: col(/total email sends/i) ?? col(/sends/i) ?? 0,
        delivered: col(/delivered/i),
        bounces: col(/bounce/i),
        unsubscribes: col(/unsubscrib/i),
        spamReports: col(/complain/i),
        uniqueOpens: col(/unique email opens/i),
        uniqueClicks: col(/unique email clicks/i),
        notes: [],
      } satisfies LaunchStats;
    },
  };
}
