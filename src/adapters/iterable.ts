import type { Snapshot, Status } from "../core/snapshot.js";
import { arr, getJson, getText, mapLimit, obj, str } from "./http.js";
import { missingEnv, type Adapter, type AdapterOptions, type LaunchStats } from "./types.js";

// Iterable REST API (US or EU data center). A read-only server-side key is enough.
// Known gap: the API lists journeys but doesn't return their step graph, so journey steps are
// reconstructed from the campaigns attached to each journey, in unknown order.

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
  const env = opts.env ?? process.env;
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
      const snap: Snapshot = { platform: "iterable", workspace, takenAt: new Date().toISOString(), campaigns: [], journeys: [], messages: [], segments: [], contentBlocks: [], gaps };
      const prevMessages = new Map(previous?.messages.map((m) => [m.id, m]));
      const prevCampaigns = new Map(previous?.campaigns.map((c) => [c.id, c]));

      for (const l of arr((await get("/lists")).lists).map(obj)) {
        snap.segments.push({ id: str(l.id) ?? "", name: str(l.name) ?? "", kind: "list", description: str(l.listType) });
      }

      const campaigns = arr((await get("/campaigns")).campaigns).map(obj);
      await mapLimit(campaigns, 5, async (c) => {
        const id = str(c.id)!;
        const templateId = str(c.templateId);
        const medium = (str(c.messageMedium) ?? "email").toLowerCase();
        const messageId = templateId ? `template:${templateId}` : undefined;
        const updatedAt = str(c.updatedAt);
        if (messageId) {
          const prev = prevMessages.get(messageId);
          if (prev && prevCampaigns.get(id)?.updatedAt === updatedAt) {
            snap.messages.push(prev);
          } else if (medium === "email") {
            try {
              const t = await get(`/templates/email/get?templateId=${encodeURIComponent(templateId!)}`);
              const tpl = obj(t.template ?? t);
              snap.messages.push({
                id: messageId,
                name: str(tpl.name) ?? str(c.name) ?? messageId,
                channel: "email",
                ownerId: id,
                subject: str(tpl.subject),
                preheader: str(tpl.preheaderText),
                from: str(tpl.fromEmail),
                body: str(tpl.html) ?? "",
              });
            } catch (e) {
              gaps.push(`Template for "${str(c.name)}" could not be read: ${(e as Error).message}`);
            }
          } else {
            snap.messages.push({ id: messageId, name: str(c.name) ?? messageId, channel: medium, ownerId: id, body: "" });
          }
        }
        snap.campaigns.push({
          id,
          name: str(c.name) ?? id,
          status: campaignStatus(str(c.campaignState)),
          channels: [medium],
          messageIds: messageId ? [messageId] : [],
          audience: [
            ...arr(c.listIds).map((x) => ({ id: String(x), kind: "list" as const, mode: "include" as const, confidence: "api-verified" as const })),
            ...arr(c.suppressionListIds).map((x) => ({ id: String(x), kind: "list" as const, mode: "exclude" as const, confidence: "api-verified" as const })),
          ],
          tags: [str(c.type), str(c.workflowId) ? `journey:${str(c.workflowId)}` : undefined].filter((x): x is string => !!x),
          updatedAt,
        });
      });

      let journeys: Record<string, unknown>[] = [];
      try {
        const res = await get("/journeys");
        journeys = arr(res.journeys ?? res.workflows ?? obj(res.data).journeys).map(obj);
      } catch (e) {
        gaps.push(`Journeys could not be listed: ${(e as Error).message}`);
      }
      for (const j of journeys) {
        const id = str(j.id) ?? "";
        const attached = snap.campaigns.filter((c) => c.tags?.includes(`journey:${id}`));
        const enabled = j.enabled ?? j.isEnabled ?? j.isPublished;
        snap.journeys.push({
          id,
          name: str(j.name) ?? id,
          status: j.isArchived === true ? "archived" : enabled === true ? "live" : enabled === false ? "draft" : campaignStatus(str(j.state)),
          entryStepIds: [],
          steps: attached.map((c) => ({ id: c.id, name: c.name, type: "message (order unknown)", messageIds: c.messageIds, next: [] })),
          stepsKnown: false,
          audience: [],
          updatedAt: str(j.updatedAt),
        });
      }
      return snap;
    },

    async launchStats(kind, id) {
      if (kind === "journey") {
        return { period: "n/a", sent: 0, notes: ["Iterable journey-level metrics aren't available from the API; run this on the journey's campaigns instead."] };
      }
      const start = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 19).replace("T", " ");
      const csv = await getText(`${base}/campaigns/metrics?campaignId=${encodeURIComponent(id)}&startDateTime=${encodeURIComponent(start)}`, headers, opts.fetcher);
      const [header, ...rows] = csv.trim().split(/\r?\n/).map((l) => l.split(","));
      const col = (name: RegExp) => {
        const i = (header ?? []).findIndex((h) => name.test(h));
        return i < 0 ? undefined : rows.reduce((sum, r) => sum + Number(r[i] ?? 0), 0);
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
