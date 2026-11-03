import Handlebars from "handlebars";
import { Liquid, Tag, TagToken, type TopLevelToken, type Template } from "liquidjs";
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
  // Closing tags ({{/ifEq}}) and else markers carry no data.
  const blocks = [...body.matchAll(/\{\{\{?([#^]?)(?!\/)([\s\S]*?)\}?\}\}/g), ...body.matchAll(/\{%-?\s*(?:if|elsif|elif|unless)\s+([\s\S]*?)-?%\}/g)];
  for (const m of blocks) {
    const isLiquidTag = m[0].startsWith("{%");
    // Drop quoted strings and Liquid filters ("| default: 'x'") before picking identifiers.
    let expr = ((isLiquidTag ? m[1] : m[2]) ?? "").replace(/(['"]).*?\1/g, "").split(/\|(?!\|)/)[0] ?? "";
    // Handlebars helpers: in {{helper arg …}}, {{#helper arg}} and (helper arg) the first word is the
    // helper's name, not customer data. A lone word ({{firstName}}) is data.
    expr = expr.replace(/\(\s*[A-Za-z_][\w.]*/g, "(").replace(/[A-Za-z_]\w*=/g, " ");
    if (!isLiquidTag && platform === "iterable") {
      const words = expr.trim().split(/\s+/);
      if (words.length > 1 || m[1] === "#") expr = words.slice(1).join(" ");
    }
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

export const ACCENTED_PERSONA = "Accented name";
const NAME_LIKE = /(^|[._])(first_?name|last_?name|full_?name|name)$/i;

/**
 * Synthetic personas derived from the variables the template actually uses: complete, empty,
 * long values (plain ASCII, so length is judged without changing SMS encoding) and, when the
 * template uses a name, an accented name (which can switch an SMS to Unicode).
 */
export function defaultPersonas(variables: string[]): Persona[] {
  const complete: Record<string, unknown> = {};
  const long: Record<string, unknown> = {};
  const accented: Record<string, unknown> = {};
  for (const v of variables) {
    const leaf = v.split(".").pop() ?? v;
    complete[v] = `Sample ${leaf}`;
    long[v] = NAME_LIKE.test(v) ? "Alexandra-Catherine Montgomery-Whitfield" : `Sample ${leaf} with a much longer value than usual`;
    accented[v] = NAME_LIKE.test(v) ? "Zoë Ñúñez" : `Sample ${leaf}`;
  }
  const personas: Persona[] = [
    { name: "Complete profile", attributes: complete },
    { name: "Empty profile", attributes: {} },
    { name: "Long values", attributes: long },
  ];
  if (variables.some((v) => NAME_LIKE.test(v))) personas.push({ name: ACCENTED_PERSONA, attributes: accented });
  return personas;
}

// Klaviyo / Braze tags that produce data we can't reproduce locally. They render as nothing and
// are reported as not verified, never as a syntax error.
const BLOCK_STUBS: Record<string, string> = {
  catalog: "Klaviyo catalog lookups were not executed (live catalog data).",
};
const INLINE_STUBS: Record<string, string> = {
  coupon_code: "Klaviyo coupon codes were not generated.",
  today: "Klaviyo {% today %} dates were not rendered.",
  currency_format: "Klaviyo currency formatting was not applied.",
};

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
  for (const [t, msg] of Object.entries(INLINE_STUBS)) engine.registerTag(t, note(msg));
  for (const [t, msg] of Object.entries(BLOCK_STUBS)) engine.registerTag(t, blockStub(t, msg, notVerified));
  engine.registerFilter("lookup", (obj: unknown, key: string) => (obj as Record<string, unknown> | undefined)?.[key]);
  return engine;
}

/** A block tag ({% x %}…{% endx %}) whose body is skipped and reported as not verified. */
function blockStub(name: string, msg: string, notVerified: Set<string>) {
  return class extends Tag {
    constructor(token: TagToken, remain: TopLevelToken[], liquid: Liquid) {
      super(token, remain, liquid);
      notVerified.add(msg);
      while (remain.length) {
        const t = remain.shift();
        if (t instanceof TagToken && t.name === `end${name}`) return;
      }
    }
    *render(): Generator<unknown, void, unknown> {}
  };
}

/**
 * Parse with liquidjs; an unknown tag the platform supports but we don't emulate is stubbed and
 * reported as not verified, so only genuine syntax errors fail.
 */
function parseTolerant(engine: Liquid, src: string, notVerified: Set<string>): Template[] {
  for (let i = 0; i < 20; i++) {
    try {
      return engine.parse(src);
    } catch (err) {
      const unknown = /tag "?([\w-]+)"? not found/i.exec((err as Error).message)?.[1];
      if (!unknown) throw err;
      const ends = new RegExp(`\\{%-?\\s*end${unknown}\\b`).test(src);
      const msg = `{% ${unknown} %} isn't emulated locally; its output wasn't checked.`;
      engine.registerTag(unknown, ends ? blockStub(unknown, msg, notVerified) : class extends Tag {
        constructor(token: TagToken, remain: TopLevelToken[], liquid: Liquid) {
          super(token, remain, liquid);
          notVerified.add(msg);
        }
        *render(): Generator<unknown, void, unknown> {}
      });
    }
  }
  return engine.parse(src);
}

// Iterable's Handlebars helpers (support.iterable.com Handlebars reference). Comparison helpers
// are implemented; formatting helpers return their input; anything else is reported, not failed.
function registerIterableHelpers(hb: typeof Handlebars, notVerified: Set<string>) {
  type Opts = Handlebars.HelperOptions;
  const cmp = (test: (a: unknown, b: unknown) => boolean) =>
    function (this: unknown, a: unknown, b: unknown, opts: Opts) {
      return test(a, b) ? opts.fn(this) : opts.inverse(this);
    };
  hb.registerHelper("defaultIfEmpty", (value: unknown, fallback: unknown) => (value === undefined || value === null || value === "" ? fallback : value));
  hb.registerHelper("ifEq", cmp((a, b) => String(a) === String(b)));
  hb.registerHelper("ifNotEq", cmp((a, b) => String(a) !== String(b)));
  hb.registerHelper("ifGt", cmp((a, b) => Number(a) > Number(b)));
  hb.registerHelper("ifGte", cmp((a, b) => Number(a) >= Number(b)));
  hb.registerHelper("ifLt", cmp((a, b) => Number(a) < Number(b)));
  hb.registerHelper("ifLte", cmp((a, b) => Number(a) <= Number(b)));
  hb.registerHelper("ifContainsStr", cmp((a, b) => String(a ?? "").includes(String(b))));
  hb.registerHelper("eq", function (this: unknown, a: unknown, b: unknown, opts: Opts) {
    const r = String(a) === String(b);
    return opts && typeof opts.fn === "function" ? (r ? opts.fn(this) : opts.inverse(this)) : r;
  });
  for (const name of ["capitalize", "upper", "lower", "titleCase", "trim", "urlEncode", "dateFormat", "replace", "truncate", "formatNumber"]) {
    hb.registerHelper(name, (value: unknown) => (typeof value === "string" || typeof value === "number" ? String(value) : ""));
  }
  hb.registerHelper("snippet", (name: unknown) => {
    notVerified.add(`Snippet "${String(name)}" was not expanded; check it separately.`);
    return "";
  });
  hb.registerHelper("helperMissing", function (...args: unknown[]) {
    const opts = args[args.length - 1] as { name: string };
    notVerified.add(`Iterable helper "${opts.name}" is not emulated locally.`);
    return "";
  });
  hb.registerHelper("blockHelperMissing", function (this: unknown, ...args: unknown[]) {
    const opts = args[args.length - 1] as Opts & { name: string };
    if (["catalog", "catalogCollection", "catalogKeys"].includes(opts.name)) notVerified.add("Iterable catalog lookups were not executed (live catalog data).");
    return "";
  });
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
  if (platform === "klaviyo") {
    notVerified.add("Klaviyo's template language was approximated with Liquid; uncommon tags may render differently.");
    src = src.replace(/\{%(-?)\s*elif\b/g, "{%$1 elsif");
  }

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
      registerIterableHelpers(hb, notVerified);
      const tpl = hb.compile(src);
      tpl({}); // compile is lazy: surface syntax errors now
      render = async (ctx) => tpl(ctx);
    } else {
      const engine = liquidEngine(notVerified);
      const tpl: Template[] = parseTolerant(engine, src, notVerified);
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
