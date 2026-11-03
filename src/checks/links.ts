import { Parser } from "htmlparser2";
import type { Finding } from "../core/model.js";

export interface Link {
  href: string;
  text: string;
}

const TEMPLATE_SYNTAX = /\{\{|\{%|\$\{/;
// Host labels that almost always mean "not production". Matched per dot-separated label, so
// "staging.brand.com" and "brand-dev.com" are caught but "devon.co.uk" is not.
const NON_PROD_LABEL = /^(localhost|staging|stage|stg|dev|test|qa|uat|sandbox|preview)$|-(staging|stage|dev|test|qa|uat|sandbox|preview)$/;
const PLACEHOLDER_HOSTS = ["example.com", "example.org", "example.net"];
// Click-tracking redirect hosts used by common ESPs (Braze/SendGrid/SparkPost/Klaviyo/Iterable/Mailchimp).
const CLICK_TRACKING =
  /(^|\.)(sendgrid\.net|sparkpostmail\.com|klclick\d*\.com|ctrk\.klclick\.com|links\.iterable\.com|list-manage\.com|braze\.com|brz\.ai|mailchimp\.com|ct\.sendgrid\.net)$|^(click|clicks|links|email|em|track|t)\./i;

export function extractLinks(html: string): Link[] {
  const links: Link[] = [];
  let current: Link | null = null;
  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (name === "a") current = { href: (attrs.href ?? "").trim(), text: "" };
      },
      ontext(text) {
        if (current) current.text += text;
      },
      onclosetag(name) {
        if (name === "a" && current) {
          current.text = current.text.replace(/\s+/g, " ").trim();
          links.push(current);
          current = null;
        }
      },
    },
    // Keep entities like &amp; encoded in hrefs as authored; we decode for URL parsing below.
    { decodeEntities: true, lowerCaseTags: true },
  );
  parser.write(html);
  parser.end();
  return links;
}

// Two-part public suffixes common in marketing domains (brand.co.uk). Not a full public-suffix
// list; it only decides which labels are "the domain" versus subdomains.
const TWO_PART_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "com.au",
  "net.au",
  "org.au",
  "co.nz",
  "co.jp",
  "co.in",
  "com.br",
  "com.mx",
  "co.za",
  "com.sg",
  "com.hk",
  "co.kr",
  "com.tr",
  "com.cn",
]);

/** The registrable domain: "staging.brand.co.uk" → "brand.co.uk". */
export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().split(".");
  const n = TWO_PART_SUFFIXES.has(labels.slice(-2).join(".")) ? 3 : 2;
  return labels.slice(-n).join(".");
}

export function isNonProdHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "[::1]" || /\.(local|test|invalid|localhost)$/.test(h)) return true;
  if (PLACEHOLDER_HOSTS.some((p) => h === p || h.endsWith(`.${p}`))) return true;
  // Judge only the subdomain labels: "staging.brand.com" and "brand-dev.brand.com" are caught,
  // but real domains like go.dev, brand.qa or test.io are not.
  const registrable = registrableDomain(h);
  const sub = h.slice(0, Math.max(0, h.length - registrable.length - 1));
  return sub !== "" && sub.split(".").some((label) => NON_PROD_LABEL.test(label));
}

export interface LinkCheckOptions {
  /** Transactional email (receipts, password resets) doesn't need an unsubscribe link. */
  transactional?: boolean;
}

export function checkLinks(html: string, opts: LinkCheckOptions = {}): Finding[] {
  const findings: Finding[] = [];
  const links = extractLinks(html);

  if (opts.transactional) {
    // Nothing to check: transactional mail is exempt from unsubscribe rules.
  } else if (!/unsubscrib|opt[- ]?out/i.test(html)) {
    // An unexpanded Braze content block (often the footer) may hold the link; say so rather than cry wolf.
    const blocks = [...html.matchAll(/content_blocks\.\$?\{?\s*([\w-]+)/g)].map((m) => m[1]);
    // A preference-center link (Braze ${preference_center_url}, Klaviyo {% manage_preferences %}) is a
    // valid opt-out route if that page offers "unsubscribe from all", so it's a question, not a failure.
    const prefCenter = /preference_center|manage_preferences|manage[ -]?(your )?preferences|email preferences/i.test(html);
    if (prefCenter)
      findings.push({
        checkId: "links.no-unsubscribe",
        severity: "warn",
        message: "There's a preference-center link but no explicit unsubscribe link.",
        fix: 'Fine if the preference page has a one-click "unsubscribe from all"; otherwise add an unsubscribe link (CAN-SPAM, Gmail/Yahoo bulk-sender rules).',
      });
    else
      findings.push({
        checkId: "links.no-unsubscribe",
        severity: blocks.length ? "warn" : "fail",
        message: blocks.length
          ? `No unsubscribe link found in this HTML; it may be inside content block ${blocks.map((b) => `"${b}"`).join(", ")}, which wasn't expanded. Check it with /check-campaign once connected, or paste the block.`
          : "No unsubscribe link or unsubscribe tag found.",
        fix: "Marketing email must include a working unsubscribe link (CAN-SPAM, GDPR, Gmail/Yahoo bulk-sender rules).",
      });
  }

  const tracked: { link: Link; hasUtm: boolean }[] = [];
  for (const link of links) {
    const { href } = link;
    const label = link.text || "(no link text)";
    if (href === "" || href === "#") {
      findings.push({
        checkId: "links.empty-href",
        severity: "warn",
        message: `Link "${label}" has no destination.`,
        evidence: `href="${href}"`,
      });
      continue;
    }
    if (/^(mailto|tel|sms):/i.test(href) || href.startsWith("#")) continue; // in-page anchors are fine
    if (/^(\/|\.\.?\/)/.test(href) && !href.startsWith("//")) {
      findings.push({
        checkId: "links.relative",
        severity: "warn",
        message: `Link "${label}" is relative (${href}); it has no website to be relative to once it's in an inbox.`,
        fix: "Use the full https:// address.",
      });
      continue;
    }

    // A fully dynamic href ({{ url }}) can only be judged after rendering; a static prefix can be judged now.
    const staticPart = href.split(TEMPLATE_SYNTAX)[0] ?? "";
    let url: URL;
    try {
      url = new URL(staticPart);
    } catch {
      if (!TEMPLATE_SYNTAX.test(href)) {
        findings.push({ checkId: "links.malformed", severity: "fail", message: `Link "${label}" is not a valid URL.`, evidence: href });
      }
      continue;
    }

    if (isNonProdHost(url.hostname)) {
      findings.push({
        checkId: "links.non-production-host",
        severity: "fail",
        message: `Link "${label}" points at a non-production host (${url.hostname}).`,
        evidence: href,
        fix: "Swap the staging/test/placeholder URL for the live one.",
      });
    }
    if (url.protocol === "http:") {
      findings.push({
        checkId: "links.insecure-http",
        severity: "warn",
        message: `Link "${label}" uses http:// instead of https://.`,
        evidence: href,
      });
    }
    if (!/unsubscrib|preference/i.test(href + link.text)) {
      tracked.push({ link, hasUtm: /[?&]utm_source=/i.test(href) });
    }
  }

  // Mixed tagging is almost always a copy-paste miss; all-or-nothing is a team convention we can't judge.
  const withUtm = tracked.filter((t) => t.hasUtm).length;
  if (withUtm > 0 && withUtm < tracked.length) {
    const missing = tracked.filter((t) => !t.hasUtm).map((t) => t.link.text || t.link.href);
    findings.push({
      checkId: "links.utm-inconsistent",
      severity: "warn",
      message: `${withUtm} of ${tracked.length} links carry UTM tags; these don't: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""}`,
      fix: "Tag every tracked link the same way, or attribution for this send will be incomplete.",
    });
  }

  return findings;
}

/** Optional network pass: does each static link actually resolve? Off by default (slow, needs network). */
export async function checkLinksLive(html: string, timeoutMs = 8000): Promise<{ findings: Finding[]; notVerified: string[] }> {
  const findings: Finding[] = [];
  const notVerified: string[] = [];
  // Never request anything that could act on a real recipient: unsubscribe and preference links,
  // or ESP click-tracking redirects copied from a received email (they'd register a click).
  const unsafe = (l: Link) =>
    /unsubscrib|preference|optout|opt-out/i.test(l.href + l.text) || CLICK_TRACKING.test(new URL(l.href).hostname);
  const candidates = extractLinks(html).filter((l) => /^https?:\/\//i.test(l.href) && !TEMPLATE_SYNTAX.test(l.href));
  const skipped = candidates.filter((l) => {
    try {
      return unsafe(l);
    } catch {
      return true;
    }
  });
  if (skipped.length)
    notVerified.push(
      `${skipped.length} unsubscribe or click-tracking link(s) were deliberately not requested, so they can't unsubscribe or click as anyone.`,
    );
  const urls = [...new Set(candidates.filter((l) => !skipped.includes(l)).map((l) => l.href))];

  for (let i = 0; i < urls.length; i += 5) {
    await Promise.all(
      urls.slice(i, i + 5).map(async (href) => {
        try {
          // HEAD only: it fetches no page body and triggers nothing on well-behaved servers.
          const res = await fetch(href, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
          if (res.status === 405 || res.status === 403 || res.status === 429) {
            notVerified.push(`${href} doesn't answer link checks (HTTP ${res.status}); open it by hand.`);
            return;
          }
          if (res.status >= 400) {
            findings.push({ checkId: "links.broken", severity: "fail", message: `Link returns HTTP ${res.status}.`, evidence: href });
          }
        } catch {
          notVerified.push(`Could not reach ${href} (timeout or network error)`);
        }
      }),
    );
  }
  return { findings, notVerified };
}
