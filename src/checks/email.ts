import { summarize, type CheckReport, type Finding, type Persona, type Platform } from "../core/model.js";
import { checkHtml } from "./html.js";
import { checkLinks, checkLinksLive } from "./links.js";
import { checkPersonalization } from "./personalization.js";

export interface EmailInput {
  html: string;
  platform: Platform;
  name?: string;
  subject?: string;
  preheader?: string;
  personas?: Persona[];
  /** Also request every static link over the network. Slower; off by default. */
  checkLinksLive?: boolean;
}

function checkSubject(subject: string | undefined, preheader: string | undefined): Finding[] {
  const findings: Finding[] = [];
  if (subject === undefined) return findings;
  if (subject.trim() === "") {
    findings.push({ checkId: "copy.empty-subject", severity: "fail", message: "Subject line is empty." });
  } else if (subject.length > 60) {
    findings.push({ checkId: "copy.long-subject", severity: "info", message: `Subject is ${subject.length} characters; most mobile inboxes cut off around 40–60.` });
  }
  if (preheader !== undefined && preheader.trim() === "") {
    findings.push({ checkId: "copy.empty-preheader", severity: "warn", message: "Preheader is set but empty." });
  }
  return findings;
}

/** The whole /check-email pass: HTML, links, personalization and subject line, in one report. */
export async function checkEmail(input: EmailInput): Promise<CheckReport & { variables: string[] }> {
  const findings: Finding[] = [];
  const notVerified: string[] = [];

  findings.push(...checkHtml(input.html));
  findings.push(...checkLinks(input.html));

  const p = await checkPersonalization(input.html, input.platform, input.personas);
  findings.push(...p.findings);
  notVerified.push(...p.notVerified);

  // Subject lines are templates too: run them through the same renderer.
  if (input.subject) {
    const s = await checkPersonalization(input.subject, input.platform, input.personas);
    findings.push(...s.findings.map((f) => ({ ...f, message: `Subject line: ${f.message}` })));
  }
  findings.push(...checkSubject(input.subject, input.preheader));

  if (input.checkLinksLive) {
    const live = await checkLinksLive(input.html);
    findings.push(...live.findings);
    notVerified.push(...live.notVerified);
  } else {
    notVerified.push("Links were checked for format and host only, not requested over the network (set checkLinksLive to test them).");
  }

  const order = { fail: 0, warn: 1, info: 2 } as const;
  findings.sort((a, b) => order[a.severity] - order[b.severity]);

  return {
    target: input.name ?? "Pasted email",
    platform: input.platform,
    findings,
    notVerified: [...new Set(notVerified)],
    summary: summarize(findings),
    variables: p.variables,
  };
}
