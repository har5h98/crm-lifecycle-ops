import { credentialEnv } from "./env.js";
import { normalizeChannel, type AudienceRef, type JourneyStep, type Snapshot, type Status } from "../core/snapshot.js";
import { arr, getJson, mapLimit, obj, str } from "./http.js";
import { missingEnv, type Adapter, type AdapterOptions, type LaunchStats } from "./types.js";

// Klaviyo JSON:API, pinned to one revision so a Klaviyo release can't change shapes under us
// (the weekly drift job flags new revisions). A read-only private key with campaigns:read,
// flows:read, segments:read, lists:read, templates:read and metrics:read is enough.

const REVISION = "2026-10-15";
const BASE = "https://a.klaviyo.com/api";

type Resource = { id: string; type: string; attributes: Record<string, unknown>; relationships: Record<string, unknown> };
const asResource = (v: unknown): Resource => {
  const o = obj(v);
  return { id: str(o.id) ?? "", type: str(o.type) ?? "", attributes: obj(o.attributes), relationships: obj(o.relationships) };
};
const relIds = (r: Resource, name: string): string[] => {
  const data = obj(r.relationships[name]).data;
  return (Array.isArray(data) ? data : data ? [data] : []).map((d) => str(obj(d).id) ?? "").filter(Boolean);
};

function campaignStatus(archived: boolean, messageStatuses: string[]): Status {
  if (archived) return "archived";
  const has = (s: string) => messageStatuses.includes(s);
  if (has("sending")) return "live";
  if (has("scheduled")) return "scheduled";
  if (messageStatuses.length > 0 && messageStatuses.every((s) => s === "sent")) return "sent";
  if (has("cancelled")) return "stopped";
  return "draft";
}

function flowStatus(s: string | undefined, archived: boolean): Status {
  if (archived) return "archived";
  if (s === "live" || s === "manual") return "live";
  return "draft";
}

/** Audience ids come back as bare strings or {id,type} objects depending on revision. */
function audienceRefs(ids: unknown[], mode: AudienceRef["mode"]): AudienceRef[] {
  return ids.map((x) => {
    const o = obj(x);
    const id = str(x) ?? str(o.id) ?? "";
    const t = str(o.type);
    return { id, kind: t === "list" ? "list" : t === "segment" ? "segment" : "unknown", mode, confidence: "api-verified" };
  });
}

export function klaviyoAdapter(opts: AdapterOptions = {}): Adapter {
  const env = opts.env ?? credentialEnv();
  const key = env.KLAVIYO_API_KEY;
  if (!key) throw missingEnv("klaviyo", ["KLAVIYO_API_KEY"]);
  const headers = { authorization: `Klaviyo-API-Key ${key}`, revision: REVISION, accept: "application/vnd.api+json" };
  const get = (url: string) => getJson<Record<string, unknown>>(url.startsWith("http") ? url : `${BASE}${url}`, headers, { fetcher: opts.fetcher });
  const workspace = env.KLAVIYO_ACCOUNT ?? "default";

  async function all(path: string): Promise<{ data: Resource[]; included: Resource[] }> {
    const data: Resource[] = [];
    const included: Resource[] = [];
    let url: string | undefined = path;
    for (let i = 0; url && i < 500; i++) {
      const res = await get(url);
      data.push(...arr(res.data).map(asResource));
      included.push(...arr(res.included).map(asResource));
      url = str(obj(res.links).next);
    }
    return { data, included };
  }

  async function templateHtml(path: string): Promise<string> {
    try {
      return str(asResource((await get(path)).data).attributes.html) ?? "";
    } catch {
      return "";
    }
  }

  return {
    platform: "klaviyo",
    workspace,

    async ping() {
      const res = await get("/lists?page[size]=1");
      return `Connected to Klaviyo (API revision ${REVISION}); lists visible: ${arr(res.data).length > 0 ? "yes" : "none yet"}.`;
    },

    async snapshot(previous) {
      const gaps = ["Klaviyo universal content blocks are not mapped yet; they're checked as part of each template's HTML."];
      const snap: Snapshot = { platform: "klaviyo", workspace, takenAt: new Date().toISOString(), campaigns: [], journeys: [], messages: [], segments: [], contentBlocks: [], gaps };
      const prevMessages = new Map(previous?.messages.map((m) => [m.id, m]));

      // Each section is independent: one failing endpoint shouldn't sink the whole refresh.
      const section = async (label: string, fn: () => Promise<void>) => {
        try {
          await fn();
        } catch (e) {
          gaps.push(`${label} could not be read: ${(e as Error).message}`);
        }
      };
      const metricNames = new Map<string, string>();
      await section("Metrics", async () => {
        for (const m of (await all("/metrics")).data) metricNames.set(m.id, str(m.attributes.name) ?? m.id);
      });

      // Segments (with structured definitions) and lists.
      await section("Segments", async () => {
      const segs = await all("/segments?page[size]=100");
      await mapLimit(segs.data, 4, async (s) => {
        let definition: unknown;
        try {
          definition = asResource((await get(`/segments/${s.id}`)).data).attributes.definition;
        } catch {
          gaps.push(`Segment "${str(s.attributes.name)}" definition could not be read.`);
        }
        snap.segments.push({ id: s.id, name: str(s.attributes.name) ?? s.id, kind: "segment", definition, updatedAt: str(s.attributes.updated) });
      });
      });
      await section("Lists", async () => {
        for (const l of (await all("/lists?page[size]=100")).data) {
          snap.segments.push({ id: l.id, name: str(l.attributes.name) ?? l.id, kind: "list", updatedAt: str(l.attributes.updated) });
        }
      });
      const kindOf = new Map(snap.segments.map((s) => [s.id, s.kind]));
      const resolve = (refs: AudienceRef[]) => refs.map((r) => (r.kind === "unknown" && kindOf.has(r.id) ? { ...r, kind: kindOf.get(r.id)! } : r));

      // Campaigns → audiences → messages → template + variation (subject line).
      await section("Campaigns", async () => {
      const camps = await all("/campaigns?filter=equals(archived,false)&include=campaign-messages,campaign-audiences");
      const inc = new Map(camps.included.map((r) => [`${r.type}:${r.id}`, r]));
      await mapLimit(camps.data, 4, async (c) => {
        const def = obj(c.attributes.definition);
        const audience: AudienceRef[] = [];
        for (const aid of relIds(c, "campaign-audiences")) {
          const a = obj(inc.get(`campaign-audience:${aid}`)?.attributes.definition);
          audience.push(...audienceRefs(arr(a.included), "include"), ...audienceRefs(arr(a.excluded), "exclude"));
        }
        const statuses: string[] = [];
        const messageIds: string[] = [];
        for (const mid of relIds(c, "campaign-messages")) {
          const m = inc.get(`campaign-message:${mid}`);
          const mdef = obj(m?.attributes.definition);
          statuses.push(str(mdef.status) ?? "draft");
          messageIds.push(mid);
          const updated = str(m?.attributes.updated);
          const prev = prevMessages.get(mid);
          if (prev && updated && prev.ownerId === c.id && previous?.campaigns.find((x) => x.id === c.id)?.updatedAt === str(c.attributes.updated_at)) {
            snap.messages.push(prev);
            continue;
          }
          let details: Record<string, unknown> = {};
          const vid = m ? relIds(m, "campaign-variations")[0] : undefined;
          if (vid) {
            try {
              details = obj(obj(asResource((await get(`/campaign-variations/${vid}`)).data).attributes.definition).details);
            } catch {
              /* subject line stays unknown */
            }
          }
          // Each campaign message targets one channel; its variation's `details` is keyed by channel.
          const channel = normalizeChannel(str(details.channel) ?? "email");
          const tid = str(details.template_id);
          snap.messages.push({
            id: mid,
            name: str(mdef.name) ?? str(def.name) ?? mid,
            channel,
            platformChannel: str(details.channel),
            ownerId: c.id,
            subject: str(details.subject),
            preheader: str(details.preview_text),
            from: str(details.from_email),
            title: str(details.title),
            deepLink: str(details.ios_deep_link) ?? str(details.android_deep_link) ?? str(details.web_url),
            buttons: arr(details.action_buttons).map((b) => ({ text: str(obj(b).label) ?? "", link: str(obj(b).url) ?? str(obj(b).ios_deep_link) })),
            optOutAppended: channel === "sms" ? details.add_opt_out_language === true : undefined,
            body:
              channel === "email"
                ? (tid ? await templateHtml(`/templates/${tid}`) : "") || (await templateHtml(`/campaign-messages/${mid}/template`))
                : (str(details.body) ?? ""),
          });
        }
        snap.campaigns.push({
          id: c.id,
          name: str(def.name) ?? c.id,
          status: campaignStatus(def.archived === true, statuses),
          channels: [...new Set(snap.messages.filter((m) => m.ownerId === c.id).map((m) => String(m.channel)))],
          messageIds,
          audience: resolve(audience),
          conversionEvents: str(obj(def.send_settings).exit_condition_conversion_metric_id)
            ? [metricNames.get(str(obj(def.send_settings).exit_condition_conversion_metric_id)!) ?? str(obj(def.send_settings).exit_condition_conversion_metric_id)!]
            : undefined,
          updatedAt: str(c.attributes.updated_at),
        });
      });

      });

      // Flows with their full action graph.
      await section("Flows", async () => {
      const flows = await all("/flows?filter=equals(archived,false)&page[size]=50");
      await mapLimit(flows.data, 3, async (f) => {
        try {
          const d = obj(asResource((await get(`/flows/${f.id}?additional-fields[flow]=definition`)).data).attributes.definition);
          const steps: JourneyStep[] = [];
          for (const raw of arr(d.actions)) {
            const a = obj(raw);
            const id = str(a.id) ?? str(a.temporary_id) ?? "";
            const links = obj(a.links);
            const next = Object.values(links).map(str).filter((x): x is string => !!x);
            const message = obj(obj(a.data).message);
            const messageIds: string[] = [];
            if (Object.keys(message).length > 0) {
              const mid = `${f.id}:${id}`;
              const tid = str(message.template_id);
              // Action types: send-email, send-sms, send-mobile-push… Flow fields differ from campaign ones
              // (subject_line, ios_link/android_link/on_open).
              const channel = normalizeChannel(str(a.type));
              messageIds.push(mid);
              snap.messages.push({
                id: mid,
                name: str(message.name) ?? `${str(f.attributes.name)} · ${str(a.type)}`,
                channel,
                platformChannel: str(a.type),
                ownerId: f.id,
                subject: str(message.subject_line),
                preheader: str(message.preview_text),
                from: str(message.from_email),
                title: str(message.title),
                deepLink: str(message.on_open) === "home" ? undefined : (str(message.ios_link) ?? str(message.android_link) ?? str(message.web_url)),
                buttons: arr(message.action_buttons).map((b) => ({ text: str(obj(b).label) ?? "", link: str(obj(b).url) })),
                optOutAppended: channel === "sms" ? message.add_opt_out_language === true : undefined,
                transactional: message.transactional === true,
                body: channel === "email" ? (tid ? await templateHtml(`/templates/${tid}`) : "") : (str(message.body) ?? ""),
              });
            }
            steps.push({ id, name: str(message.name) ?? str(a.type) ?? id, type: str(a.type) ?? "action", messageIds, next });
          }
          const audience: AudienceRef[] = arr(d.triggers).map((t) => {
            const o = obj(t);
            const type = str(o.type) ?? "";
            return {
              id: str(o.id) ?? type,
              kind: type === "list" ? "list" : type === "segment" ? "segment" : type === "metric" ? "event" : "unknown",
              mode: "trigger",
              confidence: "api-verified",
              name: type === "metric" ? metricNames.get(str(o.id) ?? "") : undefined,
            } satisfies AudienceRef;
          });
          snap.journeys.push({
            id: f.id,
            name: str(f.attributes.name) ?? f.id,
            status: flowStatus(str(f.attributes.status), f.attributes.archived === true),
            entryStepIds: str(d.entry_action_id) ? [str(d.entry_action_id)!] : steps.slice(0, 1).map((s) => s.id),
            steps,
            stepsKnown: steps.length > 0,
            audience,
            tags: str(f.attributes.trigger_type) ? [`trigger: ${str(f.attributes.trigger_type)}`] : [],
            updatedAt: str(f.attributes.updated),
          });
        } catch (e) {
          gaps.push(`Flow "${str(f.attributes.name)}" could not be read: ${(e as Error).message}`);
        }
      });

      });

      return snap;
    },

    async launchStats(kind, id) {
      // Klaviyo's reporting API requires a conversion metric; use "Placed Order" when it exists.
      const metrics = await all("/metrics");
      const metric = metrics.data.find((m) => str(m.attributes.name) === "Placed Order") ?? metrics.data[0];
      if (!metric) return { period: "last 30 days", sent: 0, notes: ["No metrics in this account yet, so Klaviyo can't produce a report."] };
      const type = kind === "campaign" ? "campaign-values-report" : "flow-values-report";
      const res = await getJson<Record<string, unknown>>(`${BASE}/${type}s`, headers, {
        fetcher: opts.fetcher,
        method: "POST",
        body: {
          data: {
            type,
            attributes: {
              statistics: ["recipients", "delivered", "bounced", "unsubscribes", "spam_complaints", "opens_unique", "clicks_unique"],
              timeframe: { key: "last_30_days" },
              conversion_metric_id: metric.id,
              filter: `equals(${kind === "campaign" ? "campaign_id" : "flow_id"},"${id}")`,
            },
          },
        },
      });
      const totals: Record<string, number> = {};
      for (const r of arr(obj(obj(res.data).attributes).results)) {
        for (const [k, v] of Object.entries(obj(obj(r).statistics))) totals[k] = (totals[k] ?? 0) + Number(v ?? 0);
      }
      return {
        period: "last 30 days",
        sent: totals.recipients ?? 0,
        delivered: totals.delivered,
        bounces: totals.bounced,
        unsubscribes: totals.unsubscribes,
        spamReports: totals.spam_complaints,
        uniqueOpens: totals.opens_unique,
        uniqueClicks: totals.clicks_unique,
        notes: [],
      } satisfies LaunchStats;
    },
  };
}
