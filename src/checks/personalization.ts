import Handlebars from "handlebars";
import { Liquid, Tag, type TagToken, type TopLevelToken, type Template } from "liquidjs";
import type { Finding, Persona, Platform } from "../core/model.js";

// Each platform has its own template language, so a local render is an approximation of the
// real send. Anything we can't faithfully reproduce goes into `notVerified`, never into a "pass".

const ABORT = "__CLO_ABORT__";
const KEYWORDS = new Set([
  "if", "elsif", "else", "unless", "endif", "endunless", "case", "when", "for", "in", "endfor", "each", "with",
  "and", "or", "not", "true", "false", "nil", "null", "blank", "empty", "contains", "this", "assign", "capture",
  // Iterable / Handlebars helpers
  "defaultIfEmpty", "eq", "ne", "gt", "lt", "lookup", "unless",
  // Platform tags that are not customer data
  "content_blocks", "unsubscribe", "unsubscribe_url", "manage_preferences", "manage_preferences_url", "web_view",
  "unsubscribeUrl", "unsubscribeMessageTypeUrl", "hostedUnsubscribeUrl", "viewInBrowserUrl", "connected_content",
  "abort_message", "catalog_items", "set_user_to_unsubscribed_url", "email_footer", "preference_center",
]);

/** Braze writes standard attributes as {{${first_name}}}; strip the ${} so Liquid can read them. */
function normalizeBraze(src: string): string {
  return src.replace(/\$\{\s*([\w.]+)\s*\}/g, "$1");
}

export function referencedVariables(src: string, platform: Platform): string[] {
  const body = platform === "braze" ? normalizeBraze(src) : src;
  const found = new Set<string>();
  const blocks = [...body.matchAll(/\{\{[#/^]?([\s\S]*?)\}\}/g), ...body.matchAll(/\{%-?\s*(?:if|elsif|unless)\s+([\s\S]*?)-?%\}/g)];
  for (const m of blocks) {
    // Drop quoted strings and Liquid filters ("| default: 'x'") before picking identifiers.
    const expr = (m[1] ?? "").replace(/(['"]).*?\1/g, "").split(/\|(?!\|)/)[0] ?? "";
    for (const token of expr.match(/[A-Za-z_][\w.]*/g) ?? []) {
      const root = token.split(".")[0] ?? token;
      if (!KEYWORDS.has(root) && !KEYWORDS.has(token)) found.add(token);
    }
  }
  return [...found].sort();
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let node = target;
  for (const part of parts.slice(0, -1)) {
    if (typeof node[part] !== "object" || node[part] === null) node[part] = {};
    node = node[part] as Record<string, unknown>;
  }
  node[parts[parts.length - 1]!] = value;
}

/** Three synthetic personas derived from the variables the template actually uses. */
export function defaultPersonas(variables: string[]): Persona[] {
  const complete: Record<string, unknown> = {};
  const edge: Record<string, unknown> = {};
  for (const v of variables) {
    const leaf = v.split(".").pop() ?? v;
    complete[v] = `Sample ${leaf}`;
    edge[v] = "Zoë-Anne Ñúñez-Oyelaran Whitfield-Montgomery";
  }
  return [
    { name: "Complete profile", attributes: complete },
    { name: "Empty profile", attributes: {} },
    { name: "Edge case (long, accented values)", attributes: edge },
  ];
}

function contextFor(persona: Persona, platform: Platform): Record<string, unknown> {
  const ctx: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(persona.attributes)) setPath(ctx, k, v);
  if (platform === "braze") ctx.custom_attribute = { ...(ctx.custom_attribute as object), ...persona.attributes };
  if (platform === "klaviyo") ctx.person = { ...(ctx.person as object), ...persona.attributes };
  if (platform === "iterable") ctx.unsubscribeUrl = ctx.unsubscribeUrl ?? "https://links.iterable.com/unsubscribe";
  return ctx;
}

function liquidEngine(notVerified: Set<string>): Liquid {
  const engine = new Liquid({ jsTruthy: false });
  const note = (msg: string) =>
    class extends Tag {
      constructor(token: TagToken, remain: TopLevelToken[], liquid: Liquid) {
        super(token, remain, liquid);
        notVerified.add(msg);
      }
      *render(): Generator<unknown, void, unknown> {}
    };
  engine.registerTag(
    "abort_message",
    class extends Tag {
      private reason: string;
      constructor(token: TagToken, remain: TopLevelToken[], liquid: Liquid) {
        super(token, remain, liquid);
        this.reason = token.args.trim();
      }
      *render(): Generator<unknown, void, unknown> {
        throw new Error(`${ABORT}${this.reason}`);
      }
    },
  );
  engine.registerTag("connected_content", note("connected_content calls were not executed (live API data)."));
  engine.registerTag("catalog_items", note("catalog_items lookups were not executed (live catalog data)."));
  engine.registerTag("promotion", note("Braze promotion codes were not generated."));
  for (const t of ["unsubscribe", "unsubscribe_url", "manage_preferences", "manage_preferences_url", "web_view"]) {
    engine.registerTag(
      t,
      class extends Tag {
        *render(): Generator<unknown, string, unknown> {
          return "https://example-esp.invalid/" + t;
        }
      },
    );
  }
  engine.registerFilter("lookup", (obj: unknown, key: string) => (obj as Record<string, unknown> | undefined)?.[key]);
  return engine;
}

function textOf(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ");
}

// Patterns that appear when data is missing. We only report them when a persona produces MORE
// of them than the complete profile does, so copy that legitimately contains them isn't flagged.
const ARTIFACTS: { id: string; pattern: RegExp; message: string }[] = [
  { id: "personalization.dangling-punctuation", pattern: /^[ \t]*[,!?.;:](?=\s)|\w[ \t]+[,!?.;:](?=\s|$)/gm, message: "a blank where a value should be (e.g. \"Hi ,\")" },
  { id: "personalization.literal-null", pattern: /\b(undefined|null|nil|NaN)\b|\[object Object\]/g, message: "a literal undefined/null/nil in the copy" },
];

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

export interface PersonalizationResult {
  findings: Finding[];
  notVerified: string[];
  variables: string[];
  renders: { persona: string; output: string | null; aborted?: string }[];
}

export async function checkPersonalization(
  source: string,
  platform: Platform,
  personas?: Persona[],
): Promise<PersonalizationResult> {
  const findings: Finding[] = [];
  const notVerified = new Set<string>();
  const variables = referencedVariables(source, platform);
  const cast = personas && personas.length > 0 ? personas : defaultPersonas(variables);

  let src = source;
  if (platform === "braze") {
    src = normalizeBraze(source).replace(/\{\{\s*content_blocks\.([\w-]+)\s*\}\}/g, (_m, name: string) => {
      notVerified.add(`Content block "${name}" was not expanded; its contents are checked separately once an account is connected.`);
      return "";
    });
  }
  if (platform === "klaviyo") notVerified.add("Klaviyo's template language was approximated with Liquid; uncommon tags may render differently.");

  if (platform === "iterable") {
    // In Iterable, eq/ifEq/lt/gt on an empty or missing field fails the template, and the message
    // isn't sent to that person at all. Fields wrapped in defaultIfEmpty are safe.
    for (const m of source.matchAll(/\{\{#?(eq|ifEq|ifNotEq|lt|gt|lte|gte)\s+([A-Za-z_][\w.]*)/g)) {
      findings.push({
        checkId: "personalization.iterable-empty-comparison",
        severity: "warn",
        message: `"${m[0]}}}" compares ${m[2]} directly; if it's empty for someone, Iterable fails the template and skips the send for them.`,
        evidence: m[0],
        fix: `Wrap the field: {{#${m[1]} (defaultIfEmpty ${m[2]} "") …}}.`,
      });
    }
  }

  let render: (ctx: Record<string, unknown>) => Promise<string>;
  try {
    if (platform === "iterable") {
      const hb = Handlebars.create();
      hb.registerHelper("defaultIfEmpty", (value: unknown, fallback: unknown) => (value === undefined || value === null || value === "" ? fallback : value));
      hb.registerHelper("helperMissing", function (...args: unknown[]) {
        const opts = args[args.length - 1] as { name: string };
        notVerified.add(`Iterable helper "${opts.name}" is not emulated locally.`);
        return "";
      });
      const tpl = hb.compile(src);
      render = async (ctx) => tpl(ctx);
    } else {
      const engine = liquidEngine(notVerified);
      const tpl: Template[] = engine.parse(src);
      render = (ctx) => engine.render(tpl, ctx);
    }
  } catch (err) {
    findings.push({
      checkId: "personalization.syntax-error",
      severity: "fail",
      message: `The template doesn't parse: ${(err as Error).message.split("\n")[0]}`,
      fix: "Fix the template syntax; the platform will refuse to send or will send broken copy.",
    });
    return { findings, notVerified: [...notVerified], variables, renders: [] };
  }

  const renders: PersonalizationResult["renders"] = [];
  for (const persona of cast) {
    try {
      renders.push({ persona: persona.name, output: await render(contextFor(persona, platform)) });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes(ABORT)) {
        const reason = msg.slice(msg.indexOf(ABORT) + ABORT.length).split(", line:")[0];
        renders.push({ persona: persona.name, output: null, aborted: reason });
        findings.push({
          checkId: "personalization.aborts",
          severity: "info",
          message: `The message aborts for "${persona.name}" ${reason}, so people like this won't receive it. Make sure that's intended.`,
          persona: persona.name,
        });
      } else {
        renders.push({ persona: persona.name, output: null });
        findings.push({
          checkId: "personalization.render-error",
          severity: "fail",
          message: `Rendering failed for "${persona.name}": ${msg.split("\n")[0]}`,
          persona: persona.name,
        });
      }
    }
  }

  const baseline = renders.find((r) => r.output !== null);
  const baselineText = baseline?.output ? textOf(baseline.output) : "";
  for (const r of renders) {
    if (r.output === null) continue;
    const text = textOf(r.output);
    if (/\{\{|\{%|\$\{|\[\[/.test(text)) {
      findings.push({
        checkId: "personalization.unrendered-syntax",
        severity: "fail",
        message: `Template syntax survives into the copy for "${r.persona}".`,
        persona: r.persona,
        evidence: text.match(/.{0,30}(\{\{|\{%|\$\{|\[\[).{0,30}/)?.[0]?.trim(),
      });
    }
    if (r === baseline) continue;
    for (const a of ARTIFACTS) {
      if (count(text, a.pattern) > count(baselineText, a.pattern)) {
        findings.push({
          checkId: a.id,
          severity: "warn",
          message: `For "${r.persona}" the copy shows ${a.message}.`,
          persona: r.persona,
          evidence: text.match(new RegExp(`.{0,25}(${a.pattern.source}).{0,10}`))?.[0]?.trim(),
          fix: "Add a fallback (Liquid: | default: 'there' · Iterable: {{defaultIfEmpty x \"there\"}}) or wrap the line in an if.",
        });
      }
    }
  }

  return { findings, notVerified: [...notVerified], variables, renders };
}
