import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { checkEmail } from "../checks/email.js";
import type { Platform, Severity } from "../core/model.js";
import { DEFAULT_RULES, loadRules, type Rulebook } from "../core/rules.js";

// `crm-lifecycle-ops check <files or folders>`: the email checks without Claude, for CI pipelines and
// pre-commit hooks in repos that hold email templates. Exits 1 when a finding reaches the --fail-on level
// so a pipeline can stop a broken email from shipping. Deterministic: it uses the built-in rules unless a
// rules file is named (--rules or CLO_RULES), never whatever /setup saved on this machine, so the same
// command gives the same verdict on every laptop and in CI.

const HELP = `Usage: crm-lifecycle-ops check <file.html | folder>... [options]
       crm-lifecycle-ops check --demo     (try it on the bundled sample emails)

Checks email HTML with the same rule-based checks as /check-email and exits 1 if anything
reaches the --fail-on level.

Options:
  --platform braze|klaviyo|iterable   Template language (default: detected from the file; shown as
                                      "guessed" when nothing in the file gives it away)
  --subject "..."                     Subject line to check with the email
  --preheader "..."                   Preheader to check with the email
  --transactional                     Receipts, password resets: no unsubscribe required
  --rules <path>                      House rules file, e.g. one committed to the repo (default: the
                                      built-in rules, or CLO_RULES if set). /setup saves yours to
                                      ~/.crm-lifecycle-ops/rules.json
  --fail-on fail|warn                 Exit 1 on blocking problems only (default) or on warnings too
  --json                              Machine-readable output
  --demo                              Check the sample emails that ship with the package
  -h, --help                          Show this help
`;

const ICON: Record<Severity, string> = { fail: "✗", warn: "!", info: "i" };

interface Options {
  paths: string[];
  platform?: Platform;
  subject?: string;
  preheader?: string;
  transactional: boolean;
  rules?: string;
  failOn: "fail" | "warn";
  json: boolean;
  demo: boolean;
}

function parse(argv: string[]): Options | string {
  const o: Options = { paths: [], transactional: false, failOn: "fail", json: false, demo: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    try {
      if (a === "-h" || a === "--help") return HELP;
      else if (a === "--platform") {
        const p = value();
        if (!["braze", "klaviyo", "iterable"].includes(p)) return `Unknown platform "${p}". Use braze, klaviyo or iterable.`;
        o.platform = p as Platform;
      } else if (a === "--subject") o.subject = value();
      else if (a === "--preheader") o.preheader = value();
      else if (a === "--transactional") o.transactional = true;
      else if (a === "--rules") o.rules = value();
      else if (a === "--fail-on") {
        const f = value();
        if (f !== "fail" && f !== "warn") return `--fail-on takes "fail" or "warn".`;
        o.failOn = f;
      } else if (a === "--json") o.json = true;
      else if (a === "--demo") o.demo = true;
      else if (a.startsWith("-")) return `Unknown option ${a}.\n\n${HELP}`;
      else o.paths.push(a);
    } catch (e) {
      return (e as Error).message;
    }
  }
  if (o.demo) {
    const samples = demoFolder();
    if (!samples) return "The sample emails aren't in this install. Try: npx crm-lifecycle-ops@latest check --demo";
    o.paths.push(samples);
  }
  return o.paths.length ? o : HELP;
}

/** The sample emails shipped in the package (examples/emails), from the bundle in dist/ or from src/cli/. */
function demoFolder(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  return [join(here, "../examples/emails"), join(here, "../../examples/emails")].find((p) => existsSync(p));
}

async function htmlFiles(path: string): Promise<string[]> {
  const s = await stat(path);
  if (s.isFile()) return [path];
  const out: string[] = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = join(path, entry.name);
    if (entry.isDirectory()) out.push(...(await htmlFiles(full)));
    else if ([".html", ".htm"].includes(extname(entry.name).toLowerCase())) out.push(full);
  }
  return out.sort();
}

/** The template language, when the file gives it away; undefined when nothing does. */
export function platformFromSyntax(html: string): Platform | undefined {
  if (/\{\{\s*\$\{|\{\{\s*custom_attribute\.|content_blocks\.\$\{|\babort_message\b/.test(html)) return "braze";
  if (/\{\{\s*person\.|\{%\s*(unsubscribe|manage_preferences|web_view)\b|\|\s*default:\s*'/.test(html)) return "klaviyo";
  if (/\{\{#(if|ifEq|each|unless)\b|\{\{defaultIfEmpty\b|\{\{unsubscribeUrl\}\}/.test(html)) return "iterable";
  return undefined;
}

/** Best guess at the template language, so a mixed folder needs no flags. Falls back to Braze. */
export function detectPlatform(html: string): Platform {
  return platformFromSyntax(html) ?? "braze";
}

/** Runs the CLI and returns the process exit code. */
export async function runCheckCli(argv: string[], write: (s: string) => void = (s) => process.stdout.write(s)): Promise<number> {
  const opts = parse(argv);
  if (typeof opts === "string") {
    write(opts.endsWith("\n") ? opts : `${opts}\n`);
    return opts === HELP ? 0 : 2;
  }
  const envRules = process.env.CLO_RULES?.trim();
  const rulesFile = opts.rules ?? (envRules && !envRules.startsWith("${") ? envRules : undefined);
  let rules: Rulebook = DEFAULT_RULES;
  if (rulesFile) {
    try {
      const loaded = await loadRules(rulesFile);
      if (!loaded.exists) {
        write(`Can't find the rules file ${rulesFile}\n`);
        return 2;
      }
      rules = loaded.rules;
    } catch (e) {
      write(`${(e as Error).message}\n`);
      return 2;
    }
  }
  const rulesLabel = rulesFile ? `Rules: ${rulesFile}` : "Rules: built-in defaults (--rules uses your team's file)";

  const files: string[] = [];
  for (const p of opts.paths) {
    try {
      files.push(...(await htmlFiles(p)));
    } catch {
      write(`Can't read ${p}\n`);
      return 2;
    }
  }
  if (!files.length) {
    write("No .html files found.\n");
    return 2;
  }

  const results: (Awaited<ReturnType<typeof checkEmail>> & { file: string; platformGuessed: boolean })[] = [];
  for (const file of files) {
    const html = await readFile(file, "utf8");
    const detected = opts.platform ?? platformFromSyntax(html);
    const platform = detected ?? "braze";
    const r = await checkEmail(
      { html, platform, name: file, subject: opts.subject, preheader: opts.preheader, transactional: opts.transactional },
      rules,
    );
    results.push({ file, platformGuessed: !detected, ...r });
  }

  // One subject or preheader given for a whole folder is judged against every email in it.
  const shared = [opts.subject !== undefined && "--subject", opts.preheader !== undefined && "--preheader"].filter(Boolean).join(" and ");
  const notes =
    shared && results.length > 1
      ? [`${shared} was applied to all ${results.length} files. Check one file at a time to give each email its own.`]
      : [];

  const failing = results.filter((r) => r.summary.fail > 0 || (opts.failOn === "warn" && r.summary.warn > 0));
  if (opts.json) {
    write(
      `${JSON.stringify({ passed: failing.length === 0, failOn: opts.failOn, rules: rulesFile ?? "defaults", notes, files: results }, null, 2)}\n`,
    );
    return failing.length ? 1 : 0;
  }
  // The CLI never requests links, so that note applies to every file; it's said once at the end instead.
  const LINKS_NOTE = /^Links were checked for format and host only/;
  const unverified = (r: (typeof results)[number]) => r.notVerified.filter((n) => !LINKS_NOTE.test(n));
  for (const r of results) {
    const open = unverified(r);
    const v = r.summary.fail
      ? "✗ Don't send"
      : r.summary.warn
        ? "! Fix before sending"
        : open.length
          ? `✓ Ready, except ${open.length} part${open.length > 1 ? "s" : ""} not checked`
          : "✓ Ready";
    const shown = opts.demo ? basename(r.file) : relative(process.cwd(), r.file);
    write(`\n${shown && !shown.startsWith("..") ? shown : r.file}  ${v}  (${r.platform}${r.platformGuessed ? ", guessed" : ""})\n`);
    for (const f of r.findings) write(`  ${ICON[f.severity]} ${`${f.checkId} `.padEnd(38)} ${f.message}\n`);
    // Never let "Ready" imply that something it couldn't run passed.
    for (const n of open) write(`  ? ${"not verified ".padEnd(38)} ${n}\n`);
  }
  const total = results.reduce((t, r) => ({ fail: t.fail + r.summary.fail, warn: t.warn + r.summary.warn }), { fail: 0, warn: 0 });
  write(
    `\n${results.length} file${results.length === 1 ? "" : "s"} checked: ${total.fail} blocking, ${total.warn} warnings. ` +
      `${failing.length ? `${failing.length} failed (--fail-on ${opts.failOn}).` : "Passed."}\n` +
      `${rulesLabel}. Links were checked for format and host, not opened.\n` +
      notes.map((n) => `Note: ${n}\n`).join(""),
  );
  return failing.length ? 1 : 0;
}
