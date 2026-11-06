import { findItem } from "../checks/campaign.js";
import { whatBreaks } from "../core/graph.js";
import type { Platform } from "../core/model.js";
import type { Rulebook } from "../core/rules.js";
import { isActive, type Snapshot } from "../core/snapshot.js";
import { GUIDES } from "./index.js";
import { guideFreshness, TASKS, type TaskId } from "./types.js";

// Builds platform-specific instructions for a task, filled in with this team's house rules and,
// when a snapshot exists, with this account's real assets: what to reuse, what's live, what a
// change would affect. It never edits the account; a person follows the steps.

export interface HowToContext {
  /** The campaign or journey being changed (edit tasks). */
  target?: string;
  /** Channels involved, e.g. ["email", "push"]. */
  channels?: ("email" | "push" | "sms" | "in-app")[];
  /** Words describing the audience, used to find existing segments to reuse. */
  audience?: string;
  /** Personalization attributes the message will use. */
  attributes?: string[];
}

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);

export function howTo(platform: Platform, task: TaskId, rules: Rulebook, snap?: Snapshot, ctx: HowToContext = {}) {
  const guide = GUIDES[platform];
  const procedure = guide.tasks[task];
  const channels = ctx.channels ?? ["email"];
  const yourSetup: string[] = [];
  const warnings: string[] = [];

  // ---- house rules → concrete values for this build
  if (rules.naming.campaignPattern || rules.naming.example) {
    yourSetup.push(
      `Name it to match your convention${rules.naming.example ? `, e.g. "${rules.naming.example}"` : ""}${rules.naming.campaignPattern ? ` (pattern ${rules.naming.campaignPattern})` : ""}.`,
    );
  }
  if (channels.includes("email") && rules.senders.allowed.length) {
    yourSetup.push(`Sender: use an approved address (${rules.senders.allowed.join(", ")}).`);
  }
  const utm = Object.entries(rules.links.requiredUtm);
  if (utm.length) {
    yourSetup.push(`Links: every tracked link needs ${utm.map(([k, v]) => (v ? `${k} (format ${v})` : k)).join(", ")}.`);
  }
  if (rules.links.domains.length) yourSetup.push(`Links should only point to ${rules.links.domains.join(", ")}.`);
  const fallback = rules.personalization.greetingFallback ?? "there";
  const attrs = ctx.attributes?.length ? ctx.attributes : ["first_name"];
  yourSetup.push(
    `Personalization in ${guide.platform} syntax, with your fallback: ${attrs
      .map((a) => guide.personalization.withFallback(a, a === "first_name" ? fallback : "", a !== "first_name"))
      .map((x) => `\`${x}\``)
      .join(" · ")}.`,
  );
  if (rules.compliance.requiredText.length)
    yourSetup.push(`Footer must include: ${rules.compliance.requiredText.map((t) => `"${t}"`).join(", ")}.`);
  if (channels.includes("push")) {
    yourSetup.push(
      `Push: title ≤ ${rules.push.titleMax} and body ≤ ${rules.push.bodyMax} characters for your longest names${rules.push.deepLinkPrefixes.length ? `; deep links start with ${rules.push.deepLinkPrefixes.join(" or ")}` : ""}${rules.push.requireDeepLink ? "; a deep link is required" : ""}.`,
    );
  }
  if (channels.includes("sms")) {
    yourSetup.push(
      `SMS: at most ${rules.sms.maxSegments} segment(s); avoid smart quotes and emoji (they halve segment length)${rules.sms.requireBrandName && rules.brand.names[0] ? `; start with "${rules.brand.names[0]}"` : ""}${rules.sms.requireOptOut ? '; include "Reply STOP to opt out" unless the platform adds it' : ""}.`,
    );
  }
  if (channels.includes("in-app"))
    yourSetup.push(`In-app: body ≤ ${rules.inApp.bodyMax} characters${rules.inApp.requireButton ? "; at least one button" : ""}.`);

  // ---- the account: reuse what exists, flag what's live
  const reuse: string[] = [];
  let target: { name: string; kind: string; status: string; affected?: ReturnType<typeof whatBreaks> } | undefined;
  if (snap) {
    if (ctx.audience) {
      const want = new Set(words(ctx.audience));
      const matches = snap.segments
        .map((s) => ({ s, score: words(`${s.name} ${s.description ?? ""}`).filter((w) => want.has(w)).length }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      for (const { s } of matches)
        reuse.push(`${s.kind === "list" ? guide.terms.list : guide.terms.segment} "${s.name}"${s.description ? `: ${s.description}` : ""}`);
      if (!matches.length) reuse.push(`No existing ${guide.terms.segment.toLowerCase()} matches "${ctx.audience}"; you'll create one.`);
    }
    const footer = snap.contentBlocks.find(
      (b) => /unsubscrib/i.test(b.body) || rules.compliance.requiredText.some((t) => b.body.includes(t)),
    );
    if (footer && channels.includes("email"))
      reuse.push(
        `${guide.terms.sharedContent} "${footer.name}" (has the unsubscribe link${rules.compliance.requiredText.length ? " and required footer text" : ""}; used in ${footer.usedBy.length} messages)`,
      );

    if (ctx.target) {
      const found = findItem(snap, ctx.target);
      if ("candidates" in found) {
        warnings.push(
          `Couldn't pin down "${ctx.target}"${found.candidates.length ? `; did you mean: ${found.candidates.join("; ")}` : ""}.`,
        );
      } else {
        const msgIds = found.kind === "campaign" ? found.item.messageIds : found.item.steps.flatMap((s) => s.messageIds);
        target = {
          name: found.item.name,
          kind: found.kind === "journey" ? guide.terms.journey : guide.terms.campaign,
          status: found.item.status,
        };
        if (isActive(found.item.status)) {
          warnings.push(`"${found.item.name}" is ${found.item.status}. Read the gotchas below before changing it.`);
        }
        // Shared content inside this item affects other programs too.
        for (const b of snap.contentBlocks) {
          if (b.usedBy.some((id) => msgIds.includes(id))) {
            const others = whatBreaks(snap, "content-block", b.name).dependents.filter((d) => d.active && d.id !== found.item.id);
            if (others.length)
              warnings.push(
                `It uses ${guide.terms.sharedContent} "${b.name}", which is also in ${others.length} other live program(s): ${others.map((o) => o.name).join(", ")}. Edit the block only if they should all change.`,
              );
          }
        }
      }
    }
  } else {
    reuse.push("No snapshot yet: run /refresh to get suggestions from your account (segments and blocks to reuse, what's live).");
  }

  const freshness = guideFreshness(guide.verifiedAt);
  if (freshness.stale)
    warnings.push(
      `These ${guide.platform} steps were last checked against the vendor's docs ${freshness.daysAgo} days ago; menus and rules may have moved. Follow the doc links where a step doesn't match what you see, and report it with /report-problem.`,
    );

  return {
    platform: guide.platform,
    task: TASKS[task],
    target,
    warnings,
    yourSetup,
    reuse,
    steps: procedure.steps,
    gotchas: procedure.gotchas,
    channelNotes: channels.flatMap((c) => guide.channels[c]?.notes ?? []),
    afterwards: [
      `Run /check-campaign${target ? ` "${target.name}"` : ""} once it's built (all channels, all test profiles).`,
      "Send tests to your seed inboxes/devices and check on mobile.",
      "After launch: /watch-launch at +1 hour and +24 hours.",
    ],
    docs: [...procedure.docs, ...guide.personalization.docs],
    verifiedAt: guide.verifiedAt,
    freshness,
    unverified: guide.unverified,
  };
}
