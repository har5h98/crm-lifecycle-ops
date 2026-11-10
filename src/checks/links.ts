import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Parser } from "htmlparser2";
import type { Finding } from "../core/model.js";

export interface Link {
  href: string;
  text: string;
}

const TEMPLATE_SYNTAX = /\{\{|\{%|\$\{/;
// Host labels that almost always mean "not production". Matched per dot-separated subdomain label, so
// "staging.brand.com" and "qa-shop.brand.com" are caught but "devon.co.uk" is not.
const ENV = "staging|stage|stg|dev|test|qa|uat|sandbox|preview";
const NON_PROD_LABEL = new RegExp(`^(localhost|${ENV})$|-(${ENV})$|^(${ENV})-`);
// The same words hyphenated onto the domain itself ("brand-dev.com", "qa-brand.com"). Usually a test site,
// but real brands exist with such names, so this is a warning the team can waive, not a blocker.
const NON_PROD_DOMAIN_LABEL = /-(staging|stg|dev|qa|uat|sandbox)$|^(staging|stg|dev|qa|uat|sandbox)-/;
const PLACEHOLDER_HOSTS = ["example.com", "example.org", "example.net"];
// Tunnels to someone's laptop: never a real destination.
const TUNNEL_HOSTS = ["ngrok.io", "ngrok.app", "ngrok.dev", "ngrok-free.app", "ngrok-free.dev", "loca.lt", "trycloudflare.com"];
// Hosting platforms' default addresses: usually a preview deploy, sometimes a small brand's real site.
const PREVIEW_HOSTS = ["vercel.app", "netlify.app", "herokuapp.com"];
const under = (h: string, domains: string[]) => domains.some((d) => h === d || h.endsWith(`.${d}`));
// Click-tracking redirect hosts used by common ESPs (Braze/SendGrid/SparkPost/Klaviyo/Iterable/Mailchimp).
const CLICK_TRACKING =
  /(^|\.)(sendgrid\.net|sparkpostmail\.com|klclick\d*\.com|ctrk\.klclick\.com|links\.iterable\.com|list-manage\.com|braze\.com|brz\.ai|mailchimp\.com|ct\.sendgrid\.net)$|^(click|clicks|links|email|em|track|t)\./i;

// Footer and account links that teams don't tag: unsubscribe and preferences, legal, help, the web version.
const UTILITY_LINK =
  /unsubscrib|preference|opt-?out|\b(privacy|terms|legal|cookies?|help|support|faq|contact( us)?|account|log ?in|sign ?in)\b|view (this )?(email|message|it )?\s*(in|on) (your |a )?(web )?browser|web ?version|view online/i;

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

/** An address only reachable from inside a network or the machine itself (also what the live check refuses to request). */
export function isPrivateAddress(address: string): boolean {
  const a = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(a) === 4) {
    const [x, y] = a.split(".").map(Number) as [number, number];
    return (
      x === 0 ||
      x === 10 ||
      x === 127 ||
      (x === 169 && y === 254) ||
      (x === 172 && y >= 16 && y <= 31) ||
      (x === 192 && y === 168) ||
      (x === 100 && y >= 64 && y <= 127)
    );
  }
  if (isIP(a) === 6) {
    if (a === "::1" || a === "::") return true;
    if (a.startsWith("::ffff:")) return isPrivateAddress(a.slice(7));
    return /^f[cd]/.test(a) || /^fe[89ab]/.test(a);
  }
  return false;
}

export function isNonProdHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || /\.(local|test|invalid|localhost|internal)$/.test(h) || isPrivateAddress(h)) return true;
  if (under(h, PLACEHOLDER_HOSTS) || under(h, TUNNEL_HOSTS)) return true;
  // Judge only the subdomain labels: "staging.brand.com" and "brand-dev.brand.com" are caught,
  // but real domains like go.dev, brand.qa or test.io are not.
  const registrable = registrableDomain(h);
  const sub = h.slice(0, Math.max(0, h.length - registrable.length - 1));
  return sub !== "" && sub.split(".").some((label) => NON_PROD_LABEL.test(label));
}

/** Hosts that are probably, not certainly, non-production: "brand-dev.com", "qa-brand.com", "brand.vercel.app". */
export function looksNonProdHost(host: string): boolean {
  const h = host.toLowerCase();
  if (isNonProdHost(h) || isIP(h.replace(/^\[|\]$/g, ""))) return false;
  if (under(h, PREVIEW_HOSTS)) return true;
  return NON_PROD_DOMAIN_LABEL.test(registrableDomain(h).split(".")[0] ?? "");
}

const OPT_OUT = /unsubscrib|opt[-_ ]?out/i;
const PREFERENCES = /preference_center|manage_preferences|manage[ -]?(your )?preferences|email preferences/i;

/** Template tags outside HTML comments: {{ … }} and {% … %}. */
const liveTags = (html: string) => html.replace(/<!--[\s\S]*?-->/g, " ").match(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g) ?? [];

/**
 * A real way out: a link whose address or text is about unsubscribing, or a platform unsubscribe tag.
 * The word in the copy ("you can unsubscribe whenever you like") or in an HTML comment doesn't count.
 */
export function hasUnsubscribe(html: string, links: Link[] = extractLinks(html)): boolean {
  if (links.some((l) => l.href !== "" && l.href !== "#" && OPT_OUT.test(`${l.href} ${l.text}`))) return true;
  // Braze's {{${email_footer}}} is the workspace footer, which Braze requires to carry the unsubscribe link.
  return liveTags(html).some((t) => OPT_OUT.test(t) || /\bemail_footer\b/.test(t));
}

function hasPreferenceCenter(html: string, links: Link[]): boolean {
  return (
    links.some((l) => l.href !== "" && l.href !== "#" && PREFERENCES.test(`${l.href} ${l.text}`)) ||
    liveTags(html).some((t) => PREFERENCES.test(t))
  );
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
  } else if (!hasUnsubscribe(html, links)) {
    // An unexpanded Braze content block (often the footer) may hold the link; say so rather than cry wolf.
    const blocks = [...html.matchAll(/content_blocks\.\$?\{?\s*([\w-]+)/g)].map((m) => m[1]);
    // A preference-center link (Braze ${preference_center_url}, Klaviyo {% manage_preferences %}) is a
    // valid opt-out route if that page offers "unsubscribe from all", so it's a question, not a failure.
    const prefCenter = hasPreferenceCenter(html, links);
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
          : /unsubscrib|opt[- ]?out/i.test(html)
            ? "The email mentions unsubscribing, but no link or unsubscribe tag does it."
            : "No unsubscribe link or unsubscribe tag found.",
        fix: "Marketing email must include a working unsubscribe link (CAN-SPAM, GDPR, Gmail/Yahoo bulk-sender rules).",
      });
  }

  const tracked: { link: Link; domain: string; hasUtm: boolean }[] = [];
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
    // "//www.brand.com/sale" inherits the page's scheme on a website; in an inbox most clients treat it as https.
    const staticPart = (href.startsWith("//") ? `https:${href}` : href).split(TEMPLATE_SYNTAX)[0] ?? "";
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
    } else if (looksNonProdHost(url.hostname)) {
      findings.push({
        checkId: "links.non-production-host",
        severity: "warn",
        message: `Link "${label}" points at what looks like a test or preview site (${url.hostname}).`,
        evidence: href,
        fix: "Swap it for the live address. If this is your real site, add an exception for it.",
      });
    }
    if (href.startsWith("//")) {
      findings.push({
        checkId: "links.relative",
        severity: "warn",
        message: `Link "${label}" has no https: at the front (${href}); some email clients won't open it.`,
        fix: "Write the full https:// address.",
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
    if (!UTILITY_LINK.test(`${href} ${link.text}`)) {
      tracked.push({ link, domain: registrableDomain(url.hostname), hasUtm: /[?&]utm_source=/i.test(href) });
    }
  }

  // Mixed tagging is almost always a copy-paste miss; all-or-nothing is a team convention we can't judge.
  // Only links to the same sites as the tagged ones count: nobody tags an Instagram or app-store link.
  const tagged = new Set(tracked.filter((t) => t.hasUtm).map((t) => t.domain));
  const comparable = tracked.filter((t) => tagged.has(t.domain));
  const withUtm = comparable.filter((t) => t.hasUtm).length;
  if (withUtm > 0 && withUtm < comparable.length) {
    const missing = comparable.filter((t) => !t.hasUtm).map((t) => t.link.text || t.link.href);
    findings.push({
      checkId: "links.utm-inconsistent",
      severity: "warn",
      message: `${withUtm} of ${comparable.length} links to your site carry UTM tags; these don't: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""}`,
      fix: "Tag every tracked link the same way, or attribution for this send will be incomplete.",
    });
  }

  return findings;
}

type Resolve = (host: string) => Promise<string[]>;
const dnsResolve: Resolve = async (host) => (await lookup(host, { all: true })).map((a) => a.address);

/** Why a URL must not be requested from this machine, if there is a reason. */
async function refuseToRequest(url: URL, resolve: Resolve): Promise<string | undefined> {
  if (!/^https?:$/.test(url.protocol)) return "not a web address";
  if (isNonProdHost(url.hostname)) return "a local, internal or test address";
  let addresses: string[] = [];
  try {
    addresses = await resolve(url.hostname);
  } catch {
    return undefined; // doesn't resolve: let the request itself report that
  }
  return addresses.some(isPrivateAddress) ? "it resolves to an internal network address" : undefined;
}

/** Optional network pass: does each static link actually resolve? Off by default (slow, needs network). */
export async function checkLinksLive(
  html: string,
  timeoutMs = 8000,
  resolve: Resolve = dnsResolve,
): Promise<{ findings: Finding[]; notVerified: string[] }> {
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
          // Redirects are followed by hand so every hop is vetted: an email link must never make this
          // machine call something on the local network.
          let url = new URL(href);
          let res: Response | undefined;
          for (let hop = 0; hop < 6; hop++) {
            const refused = await refuseToRequest(url, resolve);
            if (refused) {
              notVerified.push(
                hop === 0
                  ? `${href} was not requested (${refused}).`
                  : `${href} redirects to ${url.host}, which was not requested (${refused}).`,
              );
              return;
            }
            // HEAD only: it fetches no page body and triggers nothing on well-behaved servers.
            res = await fetch(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
            const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
            if (!next) break;
            url = new URL(next, url);
            res = undefined;
          }
          if (!res) {
            notVerified.push(`${href} redirects too many times to check; open it by hand.`);
            return;
          }
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
