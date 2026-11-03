import { closest } from "../core/fuzzy.js";
import { checkJourneyStructure } from "../core/journey.js";
import { summarize, type Finding } from "../core/model.js";
import { DEFAULT_RULES, applyRules, type Rulebook } from "../core/rules.js";
import type { Campaign, Journey, Snapshot } from "../core/snapshot.js";
import { checkChannelMessage } from "./channels.js";
import { checkEmail } from "./email.js";
import { checkCampaignName } from "./house.js";

export function findItem(
  snap: Snapshot,
  query: string,
): { kind: "campaign"; item: Campaign } | { kind: "journey"; item: Journey } | { candidates: string[]; near?: boolean } {
  const q = query.trim().toLowerCase();
  const all = [
    ...snap.campaigns.map((item) => ({ kind: "campaign" as const, item })),
    ...snap.journeys.map((item) => ({ kind: "journey" as const, item })),
  ];
  const exact = all.find((x) => x.item.id.toLowerCase() === q || x.item.name.toLowerCase() === q);
  if (exact) return exact;
  const partial = all.filter((x) => x.item.name.toLowerCase().includes(q));
  if (partial.length === 1) return partial[0]!;
  const describe = (x: (typeof all)[number]) => `${x.item.name} (${x.kind}, ${x.item.status}, id ${x.item.id})`;
  if (partial.length) return { candidates: partial.slice(0, 10).map(describe) };
  // Nothing contains the query: probably a typo, so offer the nearest names instead of nothing.
  const near = closest(
    query,
    all.map((x) => x.item.name),
  );
  return { candidates: all.filter((x) => near.includes(x.item.name)).map(describe), near: true };
}

/** /check-campaign: every message in a campaign or journey, plus its settings and structure. */
export async function checkCampaign(snap: Snapshot, query: string, rules: Rulebook = DEFAULT_RULES) {
  const found = findItem(snap, query);
  if ("candidates" in found)
    return {
      error: !found.candidates.length
        ? "Nothing matched that name or id."
        : found.near
          ? "Nothing matched that name exactly. Did you mean one of these?"
          : "More than one match; pick one.",
      candidates: found.candidates,
    };

  const { kind, item } = found;
  const settings: Finding[] = [];
  const notVerified: string[] = [];
  const messageIds = kind === "campaign" ? item.messageIds : item.steps.flatMap((s) => s.messageIds);

  if (messageIds.length === 0)
    settings.push({ checkId: "campaign.no-messages", severity: "fail", message: `This ${kind} has no messages.` });
  const includes = item.audience.filter((a) => a.mode !== "exclude");
  if (includes.length === 0 && !(kind === "journey" && snap.platform === "iterable")) {
    settings.push({ checkId: "campaign.no-audience", severity: "fail", message: `No audience or trigger is set.` });
  }
  if (item.audience.some((a) => a.confidence === "unknown")) {
    notVerified.push("Who this targets isn't available from the API; check the audience step in the platform.");
  }
  if (snap.platform === "braze" && (item.conversionEvents ?? []).length === 0) {
    settings.push({
      checkId: "campaign.no-conversion-event",
      severity: "info",
      message: "No conversion event is set, so this can't report on the outcome it's meant to drive.",
    });
  }
  settings.push(...checkCampaignName(item.name, rules));
  if (kind === "journey") {
    const s = checkJourneyStructure(item);
    settings.push(...s.findings);
    notVerified.push(...s.notVerified);
  }

  const messages = [];
  for (const id of messageIds) {
    const m = snap.messages.find((x) => x.id === id);
    if (!m) continue;
    if (m.channel === "push" || m.channel === "sms" || m.channel === "in-app" || m.channel === "content-card" || m.channel === "webhook") {
      const r = await checkChannelMessage(
        {
          channel: m.channel,
          platform: snap.platform,
          platformChannel: m.platformChannel,
          optOutAppended: m.optOutAppended,
          name: `${m.name} (${m.channel})`,
          title: m.title,
          body: m.body,
          deepLink: m.deepLink,
          imageUrl: m.imageUrl,
          buttons: m.buttons,
          webhookUrl: m.webhookUrl,
          webhookMethod: m.webhookMethod,
        },
        rules,
      );
      messages.push(r);
      notVerified.push(...r.notVerified);
      continue;
    }
    if (m.channel !== "email" || !m.body) {
      notVerified.push(
        `"${m.name}" (${m.platformChannel ?? m.channel}) wasn't QA'd: ${m.channel === "webhook" ? "webhooks" : "this channel"} isn't checked yet.`,
      );
      continue;
    }
    // Expand Braze content blocks we have, so footers and shared modules are checked too.
    const html = m.body.replace(
      /\{\{\s*content_blocks\.\$\{\s*([\w-]+)\s*\}\s*\}\}/g,
      (whole, name: string) => snap.contentBlocks.find((b) => b.name === name)?.body ?? whole,
    );
    const pattern = rules.transactional.namePattern;
    const transactional = m.transactional === true || (!!pattern && new RegExp(pattern, "i").test(`${item.name} ${m.name}`));
    const r = await checkEmail(
      { html, platform: snap.platform, name: m.name, subject: m.subject, preheader: m.preheader, from: m.from, transactional },
      rules,
    );
    messages.push(r);
    notVerified.push(...r.notVerified);
  }

  const applied = applyRules(settings, rules);
  const all = [...applied.findings, ...messages.flatMap((m) => m.findings)];
  return {
    kind,
    id: item.id,
    name: item.name,
    status: item.status,
    settings: applied.findings,
    messages: messages.map((m) => ({
      name: m.target,
      summary: m.summary,
      findings: m.findings,
      waived: m.waived,
      stats: "stats" in m ? m.stats : undefined,
    })),
    notVerified: [...new Set(notVerified)],
    summary: summarize(all),
    snapshotTakenAt: snap.takenAt,
  };
}
