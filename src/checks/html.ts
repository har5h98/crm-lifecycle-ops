import { Parser } from "htmlparser2";
import type { Finding } from "../core/model.js";

// Gmail clips messages whose HTML exceeds ~102 KB, hiding the footer (and the unsubscribe link).
const GMAIL_CLIP_BYTES = 102 * 1024;

// Only structural tags whose mismatch breaks email layouts. Optional-close tags like <p>/<li>
// are left out on purpose: flagging them would bury real problems in noise.
const TRACKED_TAGS = new Set(["table", "tbody", "thead", "tr", "td", "th", "div", "a", "center", "span"]);

// At send time the platform rewrites every tracked link (longer URLs) and adds an open pixel.
const TRACKING_BYTES_PER_LINK = 120;
const PLATFORM_OVERHEAD_BYTES = 3 * 1024;

/** Keep only the first branch of template conditionals, so `{% if %}<a>{% else %}<a>{% endif %}` isn't read as two opens. */
function firstBranches(html: string): string {
  return html
    .replace(/\{%-?\s*(?:else|elsif|elif)\b[\s\S]*?(?=\{%-?\s*end(?:if|unless|case)\b)/g, "")
    .replace(/\{\{\s*else\s*\}\}[\s\S]*?(?=\{\{\/)/g, "");
}

export function checkHtml(html: string): Finding[] {
  const findings: Finding[] = [];

  const links = (html.match(/<a\s[^>]*href=/gi) ?? []).length;
  const raw = Buffer.byteLength(html, "utf8");
  const estimated = raw + links * TRACKING_BYTES_PER_LINK + PLATFORM_OVERHEAD_BYTES;
  if (estimated > GMAIL_CLIP_BYTES) {
    findings.push({
      checkId: "html.gmail-clipping",
      severity: "warn",
      message: `About ${(estimated / 1024).toFixed(0)} KB once sent (${(raw / 1024).toFixed(0)} KB of HTML plus link tracking for ${links} links); Gmail clips anything over ~102 KB, which can hide the footer and unsubscribe link.`,
      fix: "Inline less CSS, remove unused blocks, shorten links, or move long content behind a link.",
    });
  }

  const opens = (html.match(/<!--\[if/gi) ?? []).length;
  const closes = (html.match(/<!\[endif\]-->/gi) ?? []).length;
  if (opens !== closes) {
    findings.push({
      checkId: "html.outlook-conditionals",
      severity: "fail",
      message: `Outlook conditional comments are unbalanced: ${opens} "<!--[if" vs ${closes} "<![endif]-->".`,
      fix: "Every <!--[if mso]> needs a matching <![endif]-->; an unclosed one can hide the rest of the email in Outlook.",
    });
  }

  const stack: string[] = [];
  let imagesWithoutAlt = 0;
  let hasHiddenPreheader = false;
  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (TRACKED_TAGS.has(name)) stack.push(name);
        if (name === "img" && attrs.alt === undefined) imagesWithoutAlt++;
        const style = (attrs.style ?? "").replace(/\s/g, "").toLowerCase();
        if (style.includes("display:none") || style.includes("mso-hide:all")) hasHiddenPreheader = true;
      },
      onclosetag(name, isImplied) {
        if (!TRACKED_TAGS.has(name) || isImplied) return;
        const idx = stack.lastIndexOf(name);
        if (idx === -1) {
          findings.push({
            checkId: "html.unmatched-close",
            severity: "warn",
            message: `Closing </${name}> has no matching opening tag.`,
          });
          return;
        }
        for (const unclosed of stack.splice(idx).slice(1)) {
          findings.push({
            checkId: "html.unclosed-tag",
            severity: "warn",
            message: `<${unclosed}> is never closed before </${name}>.`,
            fix: "Unclosed table cells and divs render differently across email clients; close them explicitly.",
          });
        }
      },
    },
    { decodeEntities: true, lowerCaseTags: true },
  );
  parser.write(firstBranches(html));
  parser.end();

  for (const unclosed of stack) {
    findings.push({
      checkId: "html.unclosed-tag",
      severity: "warn",
      message: `<${unclosed}> is never closed.`,
    });
  }

  // One finding per tag and kind, with a count, rather than thousands of identical rows.
  const grouped = new Map<string, Finding & { n: number }>();
  for (const f of findings.splice(0)) {
    const key =
      f.checkId === "html.unclosed-tag" || f.checkId === "html.unmatched-close"
        ? `${f.checkId}:${f.message.match(/<\/?(\w+)/)?.[1]}`
        : `${f.checkId}:${grouped.size}`;
    const g = grouped.get(key);
    if (g) g.n++;
    else grouped.set(key, { ...f, n: 1 });
  }
  for (const g of grouped.values()) {
    const { n, ...f } = g;
    findings.push(n > 1 ? { ...f, message: `${f.message} (${n} times)` } : f);
  }

  if (imagesWithoutAlt > 0) {
    findings.push({
      checkId: "html.img-missing-alt",
      severity: "warn",
      message: `${imagesWithoutAlt} image(s) have no alt attribute.`,
      fix: 'Add descriptive alt text (or alt="" for purely decorative images). Many clients block images by default.',
    });
  }

  if (!hasHiddenPreheader) {
    findings.push({
      checkId: "html.no-preheader",
      severity: "info",
      message: "No hidden preheader found; inboxes will preview the first visible text instead.",
    });
  }

  return findings;
}
