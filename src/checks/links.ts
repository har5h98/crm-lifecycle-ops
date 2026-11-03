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

export function isNonProdHost(host: string): boolean {
  if (host === "127.0.0.1" || host === "[::1]" || host.endsWith(".local") || host.endsWith(".test")) return true;
  if (PLACEHOLDER_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return true;
  return host.split(".").some((label) => NON_PROD_LABEL.test(label));
}

export function checkLinks(html: string): Finding[] {
  const findings: Finding[] = [];
  const links = extractLinks(html);

  if (!/unsubscrib/i.test(html)) {
    // An unexpanded Braze content block (often the footer) may hold the link; say so rather than cry wolf.
    const blocks = [...html.matchAll(/content_blocks\.\$?\{?\s*([\w-]+)/g)].map((m) => m[1]);
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
      findings.push({ checkId: "links.empty-href", severity: "warn", message: `Link "${label}" has no destination.`, evidence: `href="${href}"` });
      continue;
    }
    if (/^(mailto|tel|sms):/i.test(href)) continue;

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
      findings.push({ checkId: "links.insecure-http", severity: "warn", message: `Link "${label}" uses http:// instead of https://.`, evidence: href });
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
  const urls = [...new Set(extractLinks(html).map((l) => l.href))].filter((h) => /^https?:\/\//i.test(h) && !TEMPLATE_SYNTAX.test(h));

  for (let i = 0; i < urls.length; i += 5) {
    await Promise.all(
      urls.slice(i, i + 5).map(async (href) => {
        try {
          let res = await fetch(href, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
          if (res.status === 405 || res.status === 403) {
            res = await fetch(href, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
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
