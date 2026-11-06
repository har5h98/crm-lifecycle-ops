import { Parser } from "htmlparser2";
import type { Finding } from "../core/model.js";

// Email accessibility: what a screen reader or a zoomed-in reader runs into. Only checks with a
// clear, mechanical answer; colour contrast needs the rendered email and isn't attempted.

// Link text that says nothing out of context (screen readers list links on their own).
const VAGUE_LINK_TEXT = /^(click( here)?|here|this|this link|link|read more|more|go|tap here)[.!]?$/i;
// Hidden-preheader tricks use font-size 0 or 1px; anything from 2px to 11px is real text that's too small.
const MIN_FONT_PX = 12;
// The first thing an inbox previews when no preheader is set, and it wastes the preview.
const BOILERPLATE =
  /^(view (this )?(email|message|it) (in|on) (your |a )?(web )?browser|view (in|on) (the )?(web|browser|online)|having trouble (viewing|reading)|can'?t see (this|images)|email not displaying)/i;

const isHidden = (style: string) => /display:none|mso-hide:all|visibility:hidden|max-height:0|font-size:[01]px/.test(style);
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

export interface PreviewText {
  /** Text inside the first hidden element (the usual preheader hack), if any. */
  hidden?: string;
  /** The first visible text, which inboxes show when there's no hidden preheader. */
  firstVisible: string;
}

interface Scan {
  findings: Finding[];
  preview: PreviewText;
}

function scan(html: string): Scan {
  const findings: Finding[] = [];
  let hasHtmlTag = false;
  let hasLang = false;
  let layoutTables = 0;
  const vague = new Set<string>();
  let namelessLinks = 0;
  const tiny = new Set<number>();

  // Element stack: is this element hidden, and does it open a link?
  const stack: { name: string; hidden: boolean }[] = [];
  let skipText = 0; // inside <head>, <style>, <script>, <title>
  let link: { text: string; imgAlt: string[] } | null = null;
  let hiddenText: string | undefined;
  let hiddenBuf: string | null = null;
  let hiddenDepth = -1;
  let visible = "";

  const parser = new Parser(
    {
      onopentag(name, attrs) {
        const style = (attrs.style ?? "").replace(/\s/g, "").toLowerCase();
        const parentHidden = stack.some((s) => s.hidden);
        const hidden = parentHidden || isHidden(style);
        stack.push({ name, hidden });
        if (["head", "style", "script", "title"].includes(name)) skipText++;
        if (name === "html") {
          hasHtmlTag = true;
          hasLang = Boolean(attrs.lang?.trim() || attrs["xml:lang"]?.trim());
        }
        if (name === "table" && !/^(presentation|none)$/i.test(attrs.role ?? "")) layoutTables++;
        if (name === "a" && attrs.href !== undefined) link = { text: "", imgAlt: [] };
        if (name === "img" && link) link.imgAlt.push((attrs.alt ?? "").trim());
        const size = style.match(/font-size:(\d+(?:\.\d+)?)px/);
        if (size && !hidden) {
          const px = Number(size[1]);
          if (px >= 2 && px < MIN_FONT_PX) tiny.add(px);
        }
        if (hidden && !parentHidden && hiddenText === undefined && hiddenBuf === null) {
          hiddenBuf = "";
          hiddenDepth = stack.length;
        }
      },
      ontext(text) {
        if (skipText) return;
        if (link) link.text += text;
        if (hiddenBuf !== null) hiddenBuf += text;
        else if (!stack.some((s) => s.hidden) && visible.length < 300) visible += text;
      },
      onclosetag(name) {
        if (["head", "style", "script", "title"].includes(name)) skipText = Math.max(0, skipText - 1);
        if (name === "a" && link) {
          const text = squash(link.text);
          if (text && VAGUE_LINK_TEXT.test(text)) vague.add(text);
          if (!text && link.imgAlt.length && link.imgAlt.every((a) => !a)) namelessLinks++;
          link = null;
        }
        if (hiddenBuf !== null && stack.length === hiddenDepth) {
          if (squash(hiddenBuf)) hiddenText = squash(hiddenBuf);
          hiddenBuf = null;
        }
        stack.pop();
      },
    },
    { decodeEntities: true, lowerCaseTags: true },
  );
  parser.write(html);
  parser.end();

  if (hasHtmlTag && !hasLang)
    findings.push({
      checkId: "a11y.no-lang",
      severity: "warn",
      message: "The <html> tag has no lang attribute, so screen readers guess the language and may mispronounce the whole email.",
      fix: 'Add the language, e.g. <html lang="en">.',
    });
  if (vague.size)
    findings.push({
      checkId: "a11y.vague-link-text",
      severity: "warn",
      message: `Link text that means nothing on its own: ${[...vague].map((t) => `"${t}"`).join(", ")}. Screen-reader users often hear links as a list.`,
      fix: 'Say where the link goes: "See the new arrivals" instead of "Click here".',
    });
  if (namelessLinks)
    findings.push({
      checkId: "a11y.image-link-no-alt",
      severity: "warn",
      message: `${namelessLinks} link(s) contain only an image with no alt text, so they have no name for screen readers, or when images are blocked.`,
      fix: "Give the image alt text that says where the link goes.",
    });
  if (layoutTables)
    findings.push({
      checkId: "a11y.layout-table-role",
      severity: "info",
      message: `${layoutTables} table(s) have no role="presentation"; screen readers announce each layout table's rows and columns.`,
      fix: 'Add role="presentation" to tables used for layout (not to real data tables).',
    });
  if (tiny.size)
    findings.push({
      checkId: "a11y.small-text",
      severity: "info",
      message: `Text set at ${[...tiny].sort((a, b) => a - b).join("px, ")}px; under ${MIN_FONT_PX}px is hard to read, and iOS enlarges it unpredictably.`,
      fix: `Use at least ${MIN_FONT_PX}px for body copy and footers (14–16px is typical).`,
    });

  return { findings, preview: { hidden: hiddenText, firstVisible: squash(visible).slice(0, 140) } };
}

export function checkAccessibility(html: string): Finding[] {
  return scan(html).findings;
}

export function previewText(html: string): PreviewText {
  return scan(html).preview;
}

/** What the inbox will show next to the subject, and whether it's wasted. */
export function checkPreheader(html: string, opts: { subject?: string; preheader?: string }): Finding[] {
  const findings: Finding[] = [];
  const p = previewText(html);
  // Quote what a reader sees: template tags become [name] (or […]) instead of raw {{ … }}.
  const readable = (s: string) => s.replace(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g, (tag) => (/name/i.test(tag) ? "[name]" : "[…]"));
  const shown = squash(readable(opts.preheader ?? p.hidden ?? p.firstVisible));
  if (!shown) return findings;
  const source =
    opts.preheader !== undefined ? "The preheader" : p.hidden ? "The hidden preheader" : "With no preheader, the inbox preview";
  if (BOILERPLATE.test(shown))
    findings.push({
      checkId: "copy.preheader-boilerplate",
      severity: "warn",
      message: `${source} reads "${shown.slice(0, 60)}${shown.length > 60 ? "…" : ""}", which wastes the second line of the inbox listing.`,
      fix: "Set a preheader that adds to the subject line (an offer, a detail, a reason to open).",
    });
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const subject = opts.subject ? norm(opts.subject) : "";
  if (subject.length >= 8 && norm(shown).startsWith(subject))
    findings.push({
      checkId: "copy.preheader-repeats-subject",
      severity: "warn",
      message: `${source} repeats the subject line, so the inbox shows the same words twice.`,
      fix: "Use the preheader for something the subject doesn't say.",
    });
  return findings;
}
