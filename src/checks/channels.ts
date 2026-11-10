import { summarize, type CheckReport, type Finding, type Persona, type Platform } from "../core/model.js";
import { applyRules, DEFAULT_RULES, type Rulebook } from "../core/rules.js";
import type { Button } from "../core/snapshot.js";
import { checkHtml } from "./html.js";
import { checkLinks, isNonProdHost, looksNonProdHost } from "./links.js";
import { ACCENTED_PERSONA, checkPersonalization } from "./personalization.js";
import { checkHouseRules } from "./house.js";
import { SMS_BEHAVIOUR } from "../guides/facts.js";

// QA for push, SMS and in-app messages. Same principles as email: deterministic pass/fail,
// personalization rendered for several personas, and anything we can't judge listed plainly.

export interface ChannelMessageInput {
  channel: "push" | "sms" | "in-app" | "content-card" | "webhook";
  platform: Platform;
  /** The platform's own channel name, e.g. "android_push". */
  platformChannel?: string;
  /** SMS: the platform will append the account's opt-out text (e.g. Klaviyo's per-message toggle). */
  optOutAppended?: boolean;
  name?: string;
  title?: string;
  body: string;
  deepLink?: string;
  imageUrl?: string;
  buttons?: Button[];
  /** Webhooks: destination and HTTP method. */
  webhookUrl?: string;
  webhookMethod?: string;
  personas?: Persona[];
}

const TEMPLATE = /\{\{|\{%|\$\{|\[\[/;
const URL_IN_TEXT = /\b(?:https?:\/\/|[a-z][a-z0-9+.-]*:\/\/)[^\s"'<>)]+/gi;

// ---------- SMS encoding ----------
// GSM-7 basic set and extension table (extension characters cost 2). Anything else forces UCS-2,
// which cuts a segment from 160 to 70 characters.
const GSM_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
);
const GSM_EXT = new Set("^{}\\[~]|€\f");

export function smsSegments(text: string): { encoding: "GSM-7" | "UCS-2"; length: number; segments: number; nonGsm: string[] } {
  const chars = [...text];
  const nonGsm = [...new Set(chars.filter((c) => !GSM_BASIC.has(c) && !GSM_EXT.has(c)))];
  if (nonGsm.length === 0) {
    const length = chars.reduce((n, c) => n + (GSM_EXT.has(c) ? 2 : 1), 0);
    return { encoding: "GSM-7", length, segments: length <= 160 ? 1 : Math.ceil(length / 153), nonGsm };
  }
  const length = text.length; // UTF-16 code units: emoji count as 2
  return { encoding: "UCS-2", length, segments: length <= 70 ? 1 : Math.ceil(length / 67), nonGsm };
}

const LOOKALIKES: Record<string, string> = { "’": "'", "‘": "'", "“": '"', "”": '"', "–": "-", "—": "-", "…": "...", " ": " " };

function linkFindings(urls: string[], where: string): Finding[] {
  const out: Finding[] = [];
  for (const href of urls) {
    if (TEMPLATE.test(href.split("?")[0] ?? "")) continue;
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      out.push({ checkId: "links.malformed", severity: "fail", message: `${where} link is not a valid URL.`, evidence: href });
      continue;
    }
    if (/^https?:$/.test(url.protocol) && isNonProdHost(url.hostname)) {
      out.push({
        checkId: "links.non-production-host",
        severity: "fail",
        message: `${where} link points at a non-production host (${url.hostname}).`,
        evidence: href,
      });
    } else if (/^https?:$/.test(url.protocol) && looksNonProdHost(url.hostname)) {
      out.push({
        checkId: "links.non-production-host",
        severity: "warn",
        message: `${where} link points at what looks like a test or preview site (${url.hostname}).`,
        evidence: href,
        fix: "Swap it for the live address. If this is your real site, add an exception for it.",
      });
    }
    if (url.protocol === "http:")
      out.push({ checkId: "links.insecure-http", severity: "warn", message: `${where} link uses http://.`, evidence: href });
  }
  return out;
}

/** Render title/body for every persona and return the longest outputs (for length checks). */
async function renderAll(text: string | undefined, platform: Platform, personas: Persona[] | undefined, label: string) {
  if (!text)
    return { findings: [] as Finding[], notVerified: [] as string[], longest: "", shortest: "", accented: undefined as string | undefined };
  const r = await checkPersonalization(text, platform, personas);
  // The accented-name render is judged separately: it shows a real risk (some customers get a
  // Unicode text) without making every personalized text look Unicode.
  const accented = r.renders.find((x) => x.persona === ACCENTED_PERSONA)?.output ?? undefined;
  const outputs = r.renders
    .filter((x) => x.persona !== ACCENTED_PERSONA)
    .map((x) => x.output)
    .filter((x): x is string => x !== null);
  const byLen = [...outputs].sort((a, b) => b.length - a.length);
  return {
    findings: r.findings.map((f) => ({ ...f, message: `${label}: ${f.message}` })),
    notVerified: r.notVerified,
    longest: byLen[0] ?? text,
    shortest: byLen[byLen.length - 1] ?? text,
    accented,
  };
}

export async function checkChannelMessage(
  input: ChannelMessageInput,
  rules: Rulebook = DEFAULT_RULES,
): Promise<CheckReport & { waived: { finding: Finding; reason: string }[]; stats: Record<string, unknown> }> {
  const findings: Finding[] = [];
  const notVerified: string[] = [];
  const stats: Record<string, unknown> = {};
  const personas = input.personas?.length
    ? input.personas
    : rules.personalization.personas.length
      ? [...rules.personalization.personas, { name: "Empty profile", attributes: {} }]
      : undefined;

  if ((!input.body || input.body.trim() === "") && input.channel !== "webhook") {
    findings.push({
      checkId: `${{ "in-app": "inapp", "content-card": "card", webhook: "webhook", push: "push", sms: "sms" }[input.channel]}.empty`,
      severity: "fail",
      message: "The message body is empty.",
    });
  }

  const isHtml = /<(html|body|div|table|p|span)\b/i.test(input.body);
  const body = await renderAll(input.body, input.platform, personas, input.channel === "sms" ? "Text" : "Body");
  const title = await renderAll(input.title, input.platform, personas, "Title");
  findings.push(...body.findings, ...title.findings);
  notVerified.push(...body.notVerified, ...title.notVerified);

  if (input.channel === "push") {
    const t = title.longest;
    const b = body.longest;
    stats.titleLength = t.length;
    stats.bodyLength = b.length;
    if (input.platform === "braze" && input.platformChannel?.includes("android") && !(input.title ?? "").trim()) {
      findings.push({
        checkId: "push.android-no-title",
        severity: "fail",
        message: "Android push in Braze can't be sent without a title.",
      });
    }
    if (/\n/.test(t)) {
      findings.push({
        checkId: "push.title-newline",
        severity: "warn",
        message: "The rendered title contains a line break; iOS hides everything after it.",
        fix: "Remove the break, or add | strip_newlines to the Liquid.",
      });
    }
    if (t.length > rules.push.titleMax) {
      findings.push({
        checkId: "push.title-long",
        severity: "warn",
        message: `Title can reach ${t.length} characters (longest persona); over ${rules.push.titleMax} it may be cut off on lock screens.`,
        evidence: t,
      });
    }
    if (b.length > rules.push.bodyMax) {
      findings.push({
        checkId: "push.body-long",
        severity: "warn",
        message: `Body can reach ${b.length} characters; over ${rules.push.bodyMax} it may be cut off before the tap-through.`,
        evidence: b.slice(0, 80) + "…",
      });
    }
    if (!input.deepLink) {
      if (rules.push.requireDeepLink)
        findings.push({
          checkId: "push.no-deep-link",
          severity: "warn",
          message: "No deep link: tapping opens the app's home screen, not the content the push is about.",
        });
    } else {
      const dl = input.deepLink;
      if (!TEMPLATE.test(dl) && !/^[a-z][a-z0-9+.-]*:\/?\/?\S+$/i.test(dl)) {
        findings.push({ checkId: "push.deep-link-malformed", severity: "fail", message: "Deep link isn't a valid URI.", evidence: dl });
      }
      if (rules.push.deepLinkPrefixes.length && !TEMPLATE.test(dl) && !rules.push.deepLinkPrefixes.some((p) => dl.startsWith(p))) {
        findings.push({
          checkId: "push.deep-link-scheme",
          severity: "warn",
          message: `Deep link doesn't use the app's link format (${rules.push.deepLinkPrefixes.join(" or ")}).`,
          evidence: dl,
        });
      }
      findings.push(...linkFindings([dl], "Deep"));
    }
    if (input.imageUrl) findings.push(...linkFindings([input.imageUrl], "Image"));
    for (const b of input.buttons ?? []) {
      if (input.platform === "iterable" && /\{\{/.test(`${b.text} ${b.link ?? ""}`)) {
        findings.push({
          checkId: "push.button-personalization",
          severity: "fail",
          message: `Button "${b.text}" uses Handlebars, which Iterable doesn't support in push buttons; it will show literally.`,
        });
      }
      if (b.link) findings.push(...linkFindings([b.link], `Button "${b.text}"`));
    }
    notVerified.push(
      "Exact truncation depends on device, OS version and whether the notification is expanded; lengths are judged against your house limits.",
    );
  }

  if (input.channel === "sms") {
    // Some platforms append opt-out text to every text by default; it's billed like the rest.
    const appended = SMS_BEHAVIOUR[input.platform].appendedOptOut;
    const withAppended = (t: string) => (appended ? `${t} ${appended}` : t);
    const longest = smsSegments(withAppended(body.longest));
    const shortest = smsSegments(withAppended(body.shortest));
    if (appended) stats.appendedByPlatform = appended;
    stats.encoding = longest.encoding;
    stats.characters = longest.length;
    stats.segments =
      shortest.segments === longest.segments ? longest.segments : `${shortest.segments}–${longest.segments} depending on personalization`;
    const hardCap = SMS_BEHAVIOUR[input.platform].maxSegments;
    if (hardCap && longest.segments > hardCap) {
      findings.push({
        checkId: "sms.over-platform-limit",
        severity: "fail",
        message: `Up to ${longest.segments} segments; ${input.platform} rejects texts over ${hardCap} segments.`,
      });
    } else if (longest.segments > rules.sms.maxSegments) {
      findings.push({
        checkId: "sms.too-many-segments",
        severity: "warn",
        message: `Sends as up to ${longest.segments} segments (${longest.length} ${longest.encoding} characters); house limit is ${rules.sms.maxSegments}. Each segment is billed.`,
      });
    }
    if (longest.encoding === "UCS-2") {
      const swappable = longest.nonGsm.filter((c) => LOOKALIKES[c]);
      findings.push({
        checkId: "sms.unicode",
        severity: swappable.length ? "warn" : "info",
        message: `Characters ${longest.nonGsm.map((c) => `"${c}"`).join(" ")} switch the text to Unicode, which fits 70 characters per segment instead of 160.`,
        fix: swappable.length
          ? `Swap ${swappable.map((c) => `${c} → ${LOOKALIKES[c]}`).join(", ")} (often pasted in from docs).`
          : undefined,
      });
    }
    if (body.accented && longest.encoding === "GSM-7") {
      const acc = smsSegments(withAppended(body.accented));
      if (acc.encoding === "UCS-2" && acc.segments > longest.segments) {
        findings.push({
          checkId: "sms.unicode-names",
          severity: "info",
          message: `Customers with accented names (e.g. "Zoë") get a Unicode text: ${acc.segments} segments instead of ${longest.segments}.`,
          fix: "Shorten the copy if that cost matters, or leave it: it only affects those customers.",
        });
      }
    }
    // Opt-out wording means an instruction, not just the word "stop" ("Stop by this weekend!").
    const hasOptOut =
      /\b(reply|text|txt|send)\s+["'“]?(stop|end|quit|cancel|unsubscribe)\b|\bopt[- ]?out\b|\bunsubscribe\b|\bstop\s*(to|2)\s+(opt|end|quit|cancel|unsub|stop)/i.test(
        input.body,
      );
    if (appended && hasOptOut) {
      findings.push({
        checkId: "sms.duplicate-opt-out",
        severity: "info",
        message: `${input.platform} already appends "${appended}" by default, so this text will carry two opt-out lines.`,
        fix: "Remove the opt-out line from the copy, unless the project setting that appends it has been turned off.",
      });
    }
    if (input.optOutAppended && !appended) {
      notVerified.push(
        "The platform appends your account's opt-out text to this message; its length isn't known here, so the segment count leaves it out.",
      );
    }
    if (rules.sms.requireOptOut && !appended && !input.optOutAppended && !hasOptOut) {
      findings.push({
        checkId: "sms.no-opt-out",
        severity: "warn",
        message: 'No opt-out wording (e.g. "Reply STOP to opt out").',
        fix: "US carrier rules expect opt-out instructions in marketing texts. If your platform appends them automatically, turn this off in /house-rules.",
      });
    }
    if (
      rules.sms.requireBrandName &&
      rules.brand.names.length &&
      !rules.brand.names.some((n) => input.body.toLowerCase().includes(n.toLowerCase()))
    ) {
      findings.push({
        checkId: "sms.no-brand-name",
        severity: "warn",
        message: `The text never says who it's from (${rules.brand.names[0]}).`,
        fix: "Start with the brand name so recipients recognise the sender.",
      });
    }
    findings.push(
      ...linkFindings(
        [...input.body.matchAll(URL_IN_TEXT)].map((m) => m[0]),
        "Text",
      ),
    );
  }

  if (input.channel === "in-app") {
    if (isHtml) {
      // HTML in-app messages: structural checks apply; email-only ones (preheader, Gmail clipping, unsubscribe) don't.
      findings.push(...checkHtml(input.body).filter((f) => !["html.no-preheader", "html.gmail-clipping"].includes(f.checkId)));
      findings.push(...checkLinks(input.body).filter((f) => f.checkId !== "links.no-unsubscribe"));
    } else {
      const len = body.longest.length;
      stats.bodyLength = len;
      if (len > rules.inApp.bodyMax) {
        findings.push({
          checkId: "inapp.body-long",
          severity: "warn",
          message: `Body can reach ${len} characters; over ${rules.inApp.bodyMax} it may need scrolling or get cut off.`,
        });
      }
      findings.push(
        ...linkFindings(
          [...input.body.matchAll(URL_IN_TEXT)].map((m) => m[0]),
          "Body",
        ),
      );
    }
    const buttons = input.buttons ?? [];
    if (rules.inApp.requireButton && buttons.length === 0 && !input.deepLink) {
      findings.push({
        checkId: "inapp.no-action",
        severity: "warn",
        message: "No button or click action, so there's nothing for people to do next.",
      });
    }
    for (const b of buttons) {
      if (input.platform === "iterable" && /\{\{/.test(`${b.text} ${b.link ?? ""}`)) {
        findings.push({
          checkId: "push.button-personalization",
          severity: "fail",
          message: `Button "${b.text}" uses Handlebars, which Iterable doesn't support in buttons; it will show literally.`,
        });
      }
      if (!b.text.trim()) findings.push({ checkId: "inapp.button-no-text", severity: "warn", message: "A button has no label." });
      if (b.link) findings.push(...linkFindings([b.link], `Button "${b.text}"`));
    }
    if (input.deepLink) findings.push(...linkFindings([input.deepLink], "Click-through"));
    if (input.imageUrl) findings.push(...linkFindings([input.imageUrl], "Image"));
  }

  if (input.channel === "content-card") {
    const t = title.longest;
    const b = body.longest;
    stats.titleLength = t.length;
    stats.bodyLength = b.length;
    if (t.length > rules.contentCard.titleMax) {
      findings.push({
        checkId: "card.title-long",
        severity: "warn",
        message: `Title can reach ${t.length} characters; over ${rules.contentCard.titleMax} it usually wraps past one line.`,
        evidence: t,
      });
    }
    if (b.length > rules.contentCard.bodyMax) {
      findings.push({
        checkId: "card.body-long",
        severity: "warn",
        message: `Message can reach ${b.length} characters; over ${rules.contentCard.bodyMax} it runs past four lines on most cards.`,
      });
    }
    if (input.deepLink) findings.push(...linkFindings([input.deepLink], "Card"));
    if (input.imageUrl) findings.push(...linkFindings([input.imageUrl], "Image"));
  }

  if (input.channel === "webhook") {
    const url = input.webhookUrl;
    if (!url) {
      findings.push({ checkId: "webhook.no-url", severity: "fail", message: "The webhook has no destination URL." });
    } else {
      findings.push(...linkFindings([url], "Webhook"));
      if (/[?&](api[_-]?key|key|token|secret|password|auth)=/i.test(url) && !TEMPLATE.test(url.split("?")[1] ?? "")) {
        findings.push({
          checkId: "webhook.secret-in-url",
          severity: "warn",
          message: "The webhook URL carries a key or token in plain text; anyone who can view the campaign can read it.",
          fix: "Use the platform's stored credentials (e.g. Braze Connected Content credentials) or a header instead.",
        });
      }
    }
    // JSON bodies break when a value contains a quote (O"Brien) or a newline, because template values aren't JSON-escaped.
    const looksJson = /^\s*[{[]/.test(input.body);
    if (looksJson && input.body.trim()) {
      const tricky = await checkPersonalization(input.body, input.platform, [
        ...(personas ?? []),
        {
          name: "Quote in a value",
          attributes: Object.fromEntries(
            (await checkPersonalization(input.body, input.platform)).variables.map((v) => [v, 'Ann "Annie" O\'Brien']),
          ),
        },
      ]);
      for (const r of tricky.renders) {
        if (r.output === null) continue;
        try {
          JSON.parse(r.output);
        } catch {
          findings.push({
            checkId: "webhook.invalid-json",
            severity: "fail",
            message: `The JSON body is invalid for "${r.persona}"; the receiving system will reject it.`,
            fix: "Escape values for JSON (Liquid: | json_escape or | escape; Handlebars: use a JSON-safe helper) and check commas and quotes.",
            persona: r.persona,
          });
          break;
        }
      }
    }
    if (input.webhookMethod && input.webhookMethod.toUpperCase() === "GET" && input.body.trim()) {
      findings.push({
        checkId: "webhook.get-with-body",
        severity: "warn",
        message: "A GET request with a body; most servers ignore it. Use POST, or move the data into the URL.",
      });
    }
  }

  // House rules that apply to any copy: brand terms, banned phrases, spelling, dates.
  const copyHtml = `<p>${[input.title, input.body].filter(Boolean).join(" ")}</p>`;
  if (input.channel !== "webhook")
    findings.push(
      ...checkHouseRules(
        { html: copyHtml },
        { ...rules, links: { domains: [], requiredUtm: {} }, compliance: { ...rules.compliance, requiredText: [] } },
      ).filter((f) => !["house.fallback-style"].includes(f.checkId)),
    );

  const applied = applyRules(findings, rules);
  const order = { fail: 0, warn: 1, info: 2 } as const;
  applied.findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return {
    target: input.name ?? `Pasted ${input.channel} message`,
    platform: input.platform,
    findings: applied.findings,
    waived: applied.waived,
    notVerified: [...new Set(notVerified)],
    summary: summarize(applied.findings),
    stats,
  };
}
