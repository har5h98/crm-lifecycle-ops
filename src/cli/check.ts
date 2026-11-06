import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { checkEmail } from "../checks/email.js";
import type { Platform, Severity } from "../core/model.js";
import { loadRules } from "../core/rules.js";

// `crm-lifecycle-ops check <files or folders>`: the email checks without Claude, for CI pipelines and
// pre-commit hooks in repos that hold email templates. Same rules, same verdicts; exits 1 when a
// finding reaches the --fail-on level so a pipeline can stop a broken email from shipping.

const HELP = `Usage: crm-lifecycle-ops check <file.html | folder>... [options]

Checks email HTML with the same rule-based checks as /check-email and exits 1 if anything
reaches the --fail-on level.

Options:
  --platform braze|klaviyo|iterable   Template language (default: detected from the file)
  --subject "..."                     Subject line to check with the email
  --preheader "..."                   Preheader to check with the email
  --transactional                     Receipts, password resets: no unsubscribe required
  --rules <path>                      House rules file (default: the one /setup saved)
  --fail-on fail|warn                 Exit 1 on blocking problems only (default) or on warnings too
  --json                              Machine-readable output
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
}

function parse(argv: string[]): Options | string {
  const o: Options = { paths: [], transactional: false, failOn: "fail", json: false };
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
      else if (a.startsWith("-")) return `Unknown option ${a}.\n\n${HELP}`;
      else o.paths.push(a);
    } catch (e) {
      return (e as Error).message;
    }
  }
  return o.paths.length ? o : HELP;
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

/** Best guess at the template language, so a mixed folder needs no flags. */
export function detectPlatform(html: string): Platform {
  if (/\{\{\s*\$\{|\{\{\s*custom_attribute\.|content_blocks\.\$\{|\babort_message\b/.test(html)) return "braze";
  if (/\{\{\s*person\.|\{%\s*(unsubscribe|manage_preferences|web_view)\b|\|\s*default:\s*'/.test(html)) return "klaviyo";
  if (/\{\{#(if|ifEq|each|unless)\b|\{\{defaultIfEmpty\b|\{\{unsubscribeUrl\}\}/.test(html)) return "iterable";
  return "braze";
}

/** Runs the CLI and returns the process exit code. */
export async function runCheckCli(argv: string[], write: (s: string) => void = (s) => process.stdout.write(s)): Promise<number> {
  const opts = parse(argv);
  if (typeof opts === "string") {
    write(opts.endsWith("\n") ? opts : `${opts}\n`);
    return opts === HELP ? 0 : 2;
  }
  if (opts.rules) process.env.CLO_RULES = opts.rules;
  const { rules } = await loadRules();

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

  const results = [];
  for (const file of files) {
    const html = await readFile(file, "utf8");
    const platform = opts.platform ?? detectPlatform(html);
    const r = await checkEmail(
      { html, platform, name: file, subject: opts.subject, preheader: opts.preheader, transactional: opts.transactional },
      rules,
    );
    results.push({ file, ...r });
  }

  const failing = results.filter((r) => r.summary.fail > 0 || (opts.failOn === "warn" && r.summary.warn > 0));
  if (opts.json) {
    write(`${JSON.stringify({ passed: failing.length === 0, failOn: opts.failOn, files: results }, null, 2)}\n`);
    return failing.length ? 1 : 0;
  }
  for (const r of results) {
    const v = r.summary.fail ? "✗ Don't send" : r.summary.warn ? "! Fix before sending" : "✓ Ready";
    const shown = relative(process.cwd(), r.file);
    write(`\n${shown && !shown.startsWith("..") ? shown : r.file}  ${v}  (${r.platform})\n`);
    for (const f of r.findings) write(`  ${ICON[f.severity]} ${f.checkId.padEnd(34)} ${f.message}\n`);
  }
  const total = results.reduce((t, r) => ({ fail: t.fail + r.summary.fail, warn: t.warn + r.summary.warn }), { fail: 0, warn: 0 });
  write(
    `\n${results.length} file${results.length === 1 ? "" : "s"} checked: ${total.fail} blocking, ${total.warn} warnings. ` +
      `${failing.length ? `${failing.length} failed (--fail-on ${opts.failOn}).` : "Passed."}\n`,
  );
  return failing.length ? 1 : 0;
}
