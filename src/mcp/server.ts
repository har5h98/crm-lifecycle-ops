#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { checkEmail } from "../checks/email.js";
import { CHECKS } from "../checks/catalog.js";

// Read the version from the plugin manifest at runtime, so a release bump never changes dist/.
function pluginVersion(): string {
  try {
    const manifest = join(dirname(fileURLToPath(import.meta.url)), "../.claude-plugin/plugin.json");
    return (JSON.parse(readFileSync(manifest, "utf8")) as { version: string }).version;
  } catch {
    return "unknown";
  }
}
const VERSION = pluginVersion();
// Local-only usage log: check ids and counts, never email content. Feeds /ops-report
// (errors caught, time saved). Nothing leaves the machine.
const LOG_DIR = process.env.CLO_HOME ?? join(homedir(), ".crm-lifecycle-ops");
async function logRun(entry: Record<string, unknown>): Promise<void> {
  try {
    await mkdir(LOG_DIR, { recursive: true });
    await appendFile(join(LOG_DIR, "qa-log.jsonl"), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
  } catch {
    // Logging must never break a check.
  }
}

const server = new McpServer({ name: "crm-lifecycle-ops", version: VERSION });

const persona = z.object({
  name: z.string(),
  attributes: z.record(z.string(), z.unknown()).describe('Attribute values keyed by path, e.g. {"first_name": "Ana", "custom_attribute.loyalty_tier": "Gold"}'),
});

server.registerTool(
  "check_email",
  {
    title: "Check an email",
    description:
      "QA one email before it sends: HTML structure, Outlook conditionals, Gmail clipping, image alt text, links (non-production hosts, " +
      "malformed URLs, missing unsubscribe, UTM consistency) and personalization (renders the template for several synthetic personas and " +
      "flags blanks, nulls and unrendered syntax). Pass the HTML directly or a path to a local .html file. Read-only; sends nothing.",
    inputSchema: {
      html: z.string().optional().describe("The email HTML, including template tags."),
      file: z.string().optional().describe("Absolute path to a local .html file, used when html is not given."),
      platform: z.enum(["braze", "klaviyo", "iterable"]).describe("Which platform's template language the email uses."),
      name: z.string().optional(),
      subject: z.string().optional(),
      preheader: z.string().optional(),
      personas: z.array(persona).optional().describe("Synthetic test profiles. Leave empty to auto-generate complete / empty / edge-case personas."),
      check_links_live: z.boolean().optional().describe("Also request each link over the network (slower)."),
    },
  },
  async (args) => {
    const html = args.html ?? (args.file ? await readFile(args.file, "utf8") : undefined);
    if (!html) {
      return { isError: true, content: [{ type: "text", text: "Give either `html` or `file`." }] };
    }
    const report = await checkEmail({
      html,
      platform: args.platform,
      name: args.name ?? args.file,
      subject: args.subject,
      preheader: args.preheader,
      personas: args.personas,
      checkLinksLive: args.check_links_live,
    });
    await logRun({ tool: "check_email", platform: report.platform, summary: report.summary, checkIds: report.findings.map((f) => f.checkId) });
    return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
  },
);

server.registerTool(
  "list_checks",
  {
    title: "List all checks",
    description: "Every check this tool runs, with its id, severity and what it catches. Use it to explain a finding or to fill in a problem report.",
    inputSchema: {},
  },
  async () => ({ content: [{ type: "text", text: JSON.stringify({ version: VERSION, checks: CHECKS }, null, 2) }] }),
);

await server.connect(new StdioServerTransport());
