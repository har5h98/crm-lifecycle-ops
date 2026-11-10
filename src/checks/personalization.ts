import Handlebars from "handlebars";
import { Liquid, Tag, TagToken, type TopLevelToken, type Template } from "liquidjs";
import type { Finding, Persona, Platform } from "../core/model.js";

// Each platform has its own template language, so a local render is an approximation of the
// real send. Anything we can't faithfully reproduce goes into `notVerified`, never into a "pass".

const ABORT = "__CLO_ABORT__";
const KEYWORDS = new Set([
  "if",
  "elsif",
  "else",
  "unless",
  "endif",
  "endunless",
  "case",
  "when",
  "for",
  "in",
  "endfor",
  "each",
  "with",
  "and",
  "or",
  "not",
  "true",
  "false",
  "nil",
  "null",
  "blank",
  "empty",
  "contains",
  "this",
  "assign",
  "capture",
  // Iterable / Handlebars helpers
  "defaultIfEmpty",
  "eq",
  "ne",
  "gt",
  "lt",
  "lookup",
  "unless",
  // Platform tags that are not customer data
  "content_blocks",
  "unsubscribe",
  "unsubscribe_url",
  "manage_preferences",
  "manage_preferences_url",
  "web_view",
  "unsubscribeUrl",
  "unsubscribeMessageTypeUrl",
  "hostedUnsubscribeUrl",
  "viewInBrowserUrl",
  "connected_content",
  "abort_message",
  "catalog_items",
  "set_user_to_unsubscribed_url",
  "email_footer",
  "preference_center",
]);

/** Braze writes standard attributes as {{${first_name}}}; strip the ${} so Liquid can read them. */
function normalizeBraze(src: string): string {
  return (
    src
      // Attribute names can contain spaces (custom_attribute.${Favorite Color}); Liquid reads those as ["…"].
      .replace(/\.\$\{\s*([^}]*?\s[^}]*?)\s*\}/g, '["$1"]')
      .replace(/\$\{\s*([\w.]+)\s*\}/g, "$1")
      // Braze accepts output tags inside logic tags ({% assign t = {{custom_attribute.${tier}}} %}); standard
      // Liquid doesn't, so unwrap them to the plain expression before parsing.
      .replace(/\{%[\s\S]*?%\}/g, (tag) => tag.replace(/\{\{-?\s*([\s\S]*?)\s*-?\}\}/g, "$1"))
  );
}

export function referencedVariables(src: string, platform: Platform): string[] {
  const found = new Set<string>();
  let body = src;
  if (platform === "braze") {
    for (const m of src.matchAll(/(\w+)\.\$\{\s*([^}]*?\s[^}]*?)\s*\}/g)) found.add(`${m[1]}.${m[2]}`);
    body = normalizeBraze(src).replace(/[A-Za-z_][\w.]*\["[^"]*"\]/g, " "); // already recorded above
  }
  // Closing tags ({{/ifEq}}) and else markers carry no data.
  const blocks = [
    ...body.matchAll(/\{\{\{?([#^]?)(?!\/)([\s\S]*?)\}?\}\}/g),
    ...body.matchAll(/\{%-?\s*(?:if|elsif|elif|unless|case|when|assign\s+\w+\s*=)\s+([\s\S]*?)-?%\}/g),
  ];
  for (const m of blocks) {
    const isLiquidTag = m[0].startsWith("{%");
    // Drop quoted strings and Liquid filters ("| default: 'x'") before picking identifiers.
    let expr = ((isLiquidTag ? m[1] : m[2]) ?? "").replace(/(['"]).*?\1/g, "").split(/\|(?!\|)/)[0] ?? "";
    const hasHashArgs = /[A-Za-z_]\w*=/.test(expr); // {{now format="yyyy"}}: "now" is a helper
    // Handlebars helpers: in {{helper arg …}}, {{#helper arg}} and (helper arg) the first word is the
    // helper's name, not customer data. A lone word ({{firstName}}) is data.
    expr = expr.replace(/\(\s*[A-Za-z_][\w.]*/g, "(").replace(/[A-Za-z_]\w*=/g, " ");
    if (!isLiquidTag && platform === "iterable") {
      const words = expr.trim().split(/\s+/);
      if (words.length > 1 || m[1] === "#" || hasHashArgs) expr = words.slice(1).join(" ");
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

/** A long but real-world value for each kind of name field: a first name shouldn't be a whole full name. */
function longName(leaf: string): string {
  if (/first/i.test(leaf)) return "Alexandra-Catherine";
  if (/last/i.test(leaf)) return "Montgomery-Whitfield";
  return "Alexandra-Catherine Montgomery-Whitfield";
}

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
    long[v] = NAME_LIKE.test(v) ? longName(leaf) : `Sample ${leaf} with a much longer value than usual`;
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

// Klaviyo's templates are Django-style, so its filters differ from Liquid's. These are the common ones
// with a clear, mechanical result; anything else is named in "not verified" by unknownFilters().
function registerKlaviyoFilters(engine: Liquid) {
  const s = (v: unknown) => (v === undefined || v === null ? "" : String(v));
  const words = (v: unknown, fn: (w: string) => string) => s(v).replace(/\S+/g, fn);
  engine.registerFilter("upper", (v: unknown) => s(v).toUpperCase());
  engine.registerFilter("lower", (v: unknown) => s(v).toLowerCase());
  engine.registerFilter("title", (v: unknown) => words(v, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()));
  engine.registerFilter("capfirst", (v: unknown) => s(v).charAt(0).toUpperCase() + s(v).slice(1));
  engine.registerFilter("floatformat", (v: unknown, places: unknown = -1) => {
    const n = Number(v);
    if (v === "" || v === undefined || v === null || Number.isNaN(n)) return "";
    const p = Number(places);
    // Django: a negative count shows decimals only when there are any.
    if (p < 0) return Number.isInteger(Number(n.toFixed(-p))) ? n.toFixed(0) : n.toFixed(-p);
    return n.toFixed(Number.isFinite(p) ? p : 1);
  });
  engine.registerFilter("truncatechars", (v: unknown, n: unknown) => {
    const max = Number(n);
    return s(v).length > max && max > 0 ? `${s(v).slice(0, Math.max(0, max - 1))}…` : s(v);
  });
  engine.registerFilter("truncatewords", (v: unknown, n: unknown) => {
    const parts = s(v).trim().split(/\s+/);
    return parts.length > Number(n) ? `${parts.slice(0, Number(n)).join(" ")} …` : s(v);
  });
  engine.registerFilter("default_if_none", (v: unknown, fallback: unknown) => (v === undefined || v === null ? fallback : v));
  engine.registerFilter("length", (v: unknown) => (Array.isArray(v) ? v.length : s(v).length));
  engine.registerFilter("add", (v: unknown, n: unknown) =>
    Number.isFinite(Number(v)) && Number.isFinite(Number(n)) ? Number(v) + Number(n) : s(v) + s(n),
  );
  engine.registerFilter("cut", (v: unknown, what: unknown) => s(v).split(s(what)).join(""));
  engine.registerFilter("striptags", (v: unknown) => s(v).replace(/<[^>]*>/g, ""));
  engine.registerFilter("urlencode", (v: unknown) => encodeURIComponent(s(v)));
  engine.registerFilter("slugify", (v: unknown) =>
    s(v)
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_-]+/g, "-"),
  );
  engine.registerFilter("safe", (v: unknown) => v);
}

/** Filters the template uses that this engine doesn't have. liquidjs skips those silently, so say so. */
function unknownFilters(engine: Liquid, src: string): string[] {
  const found = new Set<string>();
  for (const tag of src.match(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g) ?? []) {
    // Drop quoted text first: a "|" inside a string isn't a filter.
    const code = tag.replace(/"[^"]*"|'[^']*'/g, '""');
    for (const m of code.matchAll(/\|\s*([A-Za-z_][\w-]*)/g)) if (!Object.hasOwn(engine.filters, m[1]!)) found.add(m[1]!);
  }
  return [...found];
}

function liquidEngine(notVerified: Set<string>, platform?: Platform): Liquid {
  const engine = new Liquid({ jsTruthy: false });
  if (platform === "klaviyo") registerKlaviyoFilters(engine);
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
  // Braze's json_escape: escapes a value for use inside a JSON string (quotes not included).
  engine.registerFilter("json_escape", (v: unknown) => JSON.stringify(String(v ?? "")).slice(1, -1));
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
      engine.registerTag(
        unknown,
        ends
          ? blockStub(unknown, msg, notVerified)
          : class extends Tag {
              constructor(token: TagToken, remain: TopLevelToken[], liquid: Liquid) {
                super(token, remain, liquid);
                notVerified.add(msg);
              }
              *render(): Generator<unknown, void, unknown> {}
            },
      );
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
  hb.registerHelper("defaultIfEmpty", (value: unknown, fallback: unknown) =>
    value === undefined || value === null || value === "" ? fallback : value,
  );
  hb.registerHelper(
    "ifEq",
    cmp((a, b) => String(a) === String(b)),
  );
  hb.registerHelper(
    "ifNotEq",
    cmp((a, b) => String(a) !== String(b)),
  );
  hb.registerHelper(
    "ifGt",
    cmp((a, b) => Number(a) > Number(b)),
  );
  hb.registerHelper(
    "ifGte",
    cmp((a, b) => Number(a) >= Number(b)),
  );
  hb.registerHelper(
    "ifLt",
    cmp((a, b) => Number(a) < Number(b)),
  );
  hb.registerHelper(
    "ifLte",
    cmp((a, b) => Number(a) <= Number(b)),
  );
  hb.registerHelper(
    "ifContainsStr",
    cmp((a, b) => String(a ?? "").includes(String(b))),
  );
  // Usable as a block ({{#eq a b}}…{{/eq}}) or inside another helper ({{#if (eq a b)}}).
  const either = (test: (a: unknown, b: unknown) => boolean) =>
    function (this: unknown, a: unknown, b: unknown, opts: Opts) {
      const r = test(a, b);
      return opts && typeof opts.fn === "function" ? (r ? opts.fn(this) : opts.inverse(this)) : r;
    };
  hb.registerHelper(
    "eq",
    either((a, b) => String(a) === String(b)),
  );
  hb.registerHelper(
    "lt",
    either((a, b) => Number(a) < Number(b)),
  );
  hb.registerHelper(
    "gt",
    either((a, b) => Number(a) > Number(b)),
  );
  hb.registerHelper(
    "lte",
    either((a, b) => Number(a) <= Number(b)),
  );
  hb.registerHelper(
    "gte",
    either((a, b) => Number(a) >= Number(b)),
  );

  // Text helpers change what the reader sees, so they're applied, not passed through.
  const s = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "");
  // Handlebars passes its options object last; a helper's own arguments are whatever comes before it.
  const num = (v: unknown) => (typeof v === "number" || (typeof v === "string" && v.trim() !== "") ? Number(v) : NaN);
  const eachWord = (v: string) => v.replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));
  const text: Record<string, (v: string, a?: unknown, b?: unknown) => string> = {
    upper: (v) => v.toUpperCase(),
    toUpper: (v) => v.toUpperCase(),
    upperCase: (v) => v.toUpperCase(),
    lower: (v) => v.toLowerCase(),
    toLower: (v) => v.toLowerCase(),
    lowerCase: (v) => v.toLowerCase(),
    capitalize: eachWord,
    titleCase: (v) => eachWord(v.toLowerCase()),
    capitalizeFirst: (v) => v.charAt(0).toUpperCase() + v.slice(1),
    trim: (v) => v.trim(),
    urlEncode: (v) => encodeURIComponent(v),
    replace: (v, find, to) => (typeof find === "string" && find ? v.split(find).join(typeof to === "string" ? to : "") : v),
    substring: (v, from, to) => v.substring(Number.isNaN(num(from)) ? 0 : num(from), Number.isNaN(num(to)) ? undefined : num(to)),
    // Iterable's abbreviate counts the "..." in the length.
    abbreviate: (v, n) => (num(n) >= 4 && v.length > num(n) ? `${v.slice(0, num(n) - 3)}...` : v),
    truncate: (v, n) => (num(n) > 0 && v.length > num(n) ? v.slice(0, num(n)) : v),
  };
  for (const [name, fn] of Object.entries(text)) hb.registerHelper(name, (value: unknown, a?: unknown, b?: unknown) => fn(s(value), a, b));
  // Date and number formats depend on Iterable's own locale and pattern rules; show the raw value and say so.
  for (const name of ["dateFormat", "formatNumber", "numberFormat", "formatDate"]) {
    hb.registerHelper(name, (value: unknown) => {
      notVerified.add(`Iterable's {{${name}}} formatting wasn't applied; the value is shown as stored. Check it in Iterable's preview.`);
      return s(value);
    });
  }
  hb.registerHelper("now", (...args: unknown[]) => {
    notVerified.add("Iterable's {{now}} was rendered with today's date, not the send date.");
    const format = (args[args.length - 1] as Opts | undefined)?.hash?.format;
    const first = typeof args[0] === "string" ? args[0] : undefined;
    return javaDate(new Date(), typeof format === "string" ? format : (first ?? "yyyy-MM-dd"));
  });
  hb.registerHelper("snippet", (name: unknown) => {
    notVerified.add(`Snippet "${String(name)}" was not expanded; check it separately.`);
    return "";
  });
  // Iterable fills these system links in at send time; render them as placeholder URLs, not "unknown helper".
  for (const name of ["unsubscribeUrl", "unsubscribeMessageTypeUrl", "hostedUnsubscribeUrl", "viewInBrowserUrl"])
    hb.registerHelper(name, () => `https://links.iterable.com/${name}`);
  hb.registerHelper("helperMissing", function (...args: unknown[]) {
    // {{email}} with no arguments is a field this profile doesn't have, not a helper: blanks are judged per profile.
    if (args.length === 1) return "";
    const opts = args[args.length - 1] as { name: string };
    notVerified.add(`Iterable helper "${opts.name}" is not emulated locally.`);
    return "";
  });
  hb.registerHelper("blockHelperMissing", function (this: unknown, ...args: unknown[]) {
    const opts = args[args.length - 1] as Opts & { name: string };
    if (["catalog", "catalogCollection", "catalogKeys"].includes(opts.name))
      notVerified.add("Iterable catalog lookups were not executed (live catalog data).");
    return "";
  });
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** A date in the common Java pattern letters Iterable uses (yyyy, MM, MMMM, dd, EEEE, HH, mm, ss), in UTC. */
function javaDate(d: Date, format: string): string {
  const two = (n: number) => String(n).padStart(2, "0");
  const month = MONTHS[d.getUTCMonth()]!;
  const day = DAYS[d.getUTCDay()]!;
  const parts: Record<string, string> = {
    yyyy: String(d.getUTCFullYear()),
    yy: String(d.getUTCFullYear()).slice(-2),
    MMMM: month,
    MMM: month.slice(0, 3),
    MM: two(d.getUTCMonth() + 1),
    M: String(d.getUTCMonth() + 1),
    dd: two(d.getUTCDate()),
    d: String(d.getUTCDate()),
    EEEE: day,
    EEE: day.slice(0, 3),
    HH: two(d.getUTCHours()),
    mm: two(d.getUTCMinutes()),
    ss: two(d.getUTCSeconds()),
  };
  return format.replace(
    /'([^']*)'|yyyy|yy|MMMM|MMM|MM|M|dd|d|EEEE|EEE|HH|mm|ss/g,
    (token, literal?: string) => literal ?? parts[token] ?? token,
  );
}

/**
 * Iterable comparisons on a bare field ({{#eq plan "pro"}}) that nothing protects. A comparison inside
 * {{#if plan}} (or the else of {{#unless plan}}) only runs when the field has a value, so it's safe.
 */
function unguardedComparisons(source: string): { tag: string; helper: string; field: string }[] {
  const out: { tag: string; helper: string; field: string }[] = [];
  const open: { field?: string; guardsBody: boolean; inElse: boolean }[] = [];
  const guarded = (field: string) => open.some((b) => b.field === field && b.guardsBody !== b.inElse);
  for (const m of source.matchAll(/\{\{~?\s*([#/^]?)\s*([^}]*?)\s*~?\}\}/g)) {
    const [, sigil, inner = ""] = m;
    const [name = "", ...args] = inner.split(/\s+/);
    if (sigil === "/") {
      open.pop();
      continue;
    }
    if (sigil === "^" || name === "else") {
      const top = open[open.length - 1];
      if (top) top.inElse = true;
      if (name !== "else" || args.length === 0) continue;
    }
    const cmp = /^\(?(eq|ifEq|ifNotEq|lt|gt|lte|gte)$/.exec(name);
    const field = args[0];
    if (cmp && field && /^[A-Za-z_][\w.]*$/.test(field) && !guarded(field))
      out.push({ tag: m[0].replace(/\s*~?\}\}$/, "").replace(/^(\S+\s+\S+).*$/, "$1"), helper: cmp[1]!, field });
    if (sigil === "#") {
      const simple = args.length === 1 && /^[A-Za-z_][\w.]*$/.test(args[0]!);
      open.push({ field: simple && (name === "if" || name === "unless") ? args[0] : undefined, guardsBody: name === "if", inElse: false });
    }
  }
  return out;
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
  {
    id: "personalization.dangling-punctuation",
    pattern: /^[ \t]*[,!?.;:](?=\s)|\w[ \t]+[,!?.;:](?=\s|$)/gm,
    message: 'a blank where a value should be (e.g. "Hi ,")',
  },
  {
    id: "personalization.literal-null",
    pattern: /\b(undefined|null|nil|NaN)\b|\[object Object\]/g,
    message: "a literal undefined/null/nil in the copy",
  },
];

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

export interface PersonalizationResult {
  findings: Finding[];
  notVerified: string[];
  variables: string[];
  renders: { persona: string; output: string | null; aborted?: string }[];
}

export async function checkPersonalization(source: string, platform: Platform, personas?: Persona[]): Promise<PersonalizationResult> {
  const findings: Finding[] = [];
  const notVerified = new Set<string>();
  const variables = referencedVariables(source, platform);
  const custom = Boolean(personas && personas.length > 0);
  const cast = custom ? personas! : defaultPersonas(variables);

  let src = source;
  if (platform === "braze") {
    src = normalizeBraze(source).replace(/\{\{\s*content_blocks\.([\w-]+)\s*\}\}/g, (_m, name: string) => {
      notVerified.add(`Content block "${name}" was not expanded; its contents are checked separately once an account is connected.`);
      return "";
    });
  }
  if (platform === "klaviyo") {
    // Only worth saying when the email actually has template logic to approximate.
    if (/\{%|\{\{/.test(src))
      notVerified.add("Klaviyo's template language was approximated with Liquid; uncommon tags may render differently.");
    src = src.replace(/\{%(-?)\s*elif\b/g, "{%$1 elsif");
  }

  if (platform === "iterable") {
    // Data feeds can use the alternative [[ ]] syntax; their values come from the feed at send time.
    src = src.replace(/\[\[[\s\S]*?\]\]/g, () => {
      notVerified.add("Data feed values ([[ … ]]) weren't fetched; check them in Iterable's preview with a real user.");
      return "data feed value";
    });
    // In Iterable, eq/ifEq/lt/gt on an empty or missing field fails the template, and the message
    // isn't sent to that person at all. Fields wrapped in defaultIfEmpty are safe.
    for (const c of unguardedComparisons(source)) {
      findings.push({
        checkId: "personalization.iterable-empty-comparison",
        severity: "warn",
        message: `"${c.tag}}}" compares ${c.field} directly; if it's empty for someone, Iterable fails the template and skips the send for them.`,
        evidence: c.tag,
        fix: `Wrap the field: {{#${c.helper} (defaultIfEmpty ${c.field} "") …}}, or put the comparison inside {{#if ${c.field}}}.`,
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
      const engine = liquidEngine(notVerified, platform);
      const tpl: Template[] = parseTolerant(engine, src, notVerified);
      for (const name of unknownFilters(engine, src))
        notVerified.add(
          `The "${name}" filter isn't emulated locally, so the copy was checked without it. Check that value in the platform's preview.`,
        );
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

  // Blanks are judged against a profile that has everything. A team's own personas may all be missing
  // a field, so with custom personas the comparison is a complete profile rendered just for this.
  const artifacts = (text: string) => ARTIFACTS.reduce((n, a) => n + count(text, a.pattern), 0);
  let baseline: PersonalizationResult["renders"][number] | undefined;
  let baselineText: string | undefined;
  if (custom) {
    try {
      baselineText = textOf(await render(contextFor(defaultPersonas(variables)[0]!, platform)));
    } catch {
      /* fall back to the cleanest of the given personas below */
    }
  } else baseline = renders.find((r) => r.output !== null);
  if (baselineText === undefined) {
    baseline ??= renders.filter((r) => r.output !== null).sort((a, b) => artifacts(textOf(a.output!)) - artifacts(textOf(b.output!)))[0];
    baselineText = baseline?.output ? textOf(baseline.output) : "";
  }
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
          evidence: text.match(new RegExp(`.{0,25}(${a.pattern.source}).{0,10}`, "m"))?.[0]?.trim(),
          fix: "Add a fallback (Liquid: | default: 'there' · Iterable: {{defaultIfEmpty x \"there\"}}) or wrap the line in an if.",
        });
      }
    }
  }

  return { findings, notVerified: [...notVerified], variables, renders };
}
