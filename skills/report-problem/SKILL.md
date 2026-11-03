---
name: report-problem
description: Report a wrong result (a false alarm, a missed problem, or a confusing message) so it gets fixed and added to the test suite. Use when someone says "that's wrong", "false positive", "it missed this", "report a bug" or "send feedback" about crm-lifecycle-ops.
argument-hint: "[what was wrong]"
---

# Report a problem

Turn "that result was wrong" into a GitHub issue the maintainers can reproduce. Every confirmed
report becomes a regression test, so the same mistake can't come back.

## 1. Pin down what happened
Work it out from the conversation where you can; ask only for what's missing:
- **Type:** false alarm (flagged something fine) · missed problem (didn't flag something wrong) ·
  confusing message · crash/error · something else
- **Check id** if it's about a finding (e.g. `links.utm-inconsistent`). The `list_checks` tool has them all.
- **Expected vs. actual**, in one sentence each
- **Platform:** braze / klaviyo / iterable
- **The smallest snippet that shows it**: a few lines of template, not the whole email

## 2. Strip anything private (do this yourself, then show the person)
Replace real names, emails, phone numbers, customer or account IDs, API keys, internal URLs and real
company domains with placeholders (`Ana`, `ana@example.com`, `https://brand.example/...`). Keep the
template *syntax* exactly as it was; that's what reproduces the bug.

## 3. Show the draft and ask
Show the exact title and body that would be posted, then ask: **"Post this as a public GitHub issue?"**
Do not post without a clear yes. The repository is public.

Title format: `[wrong-result] <check id or area>: <one-line summary>`

Body:
```
**Type:** …
**Check id:** …
**Platform:** …
**Plugin version:** <version from the list_checks tool>
**Expected:** …
**Actual:** …

**Snippet (private details removed):**
<snippet in a code block>
```

## 4. Post it
- If `gh` is installed and signed in (`gh auth status`): write the body to a temp file and run
  `gh issue create --repo har5h98/crm-lifecycle-ops --title "<title>" --body-file <file> --label wrong-result`.
  If the label is rejected, retry without `--label`.
- Otherwise give them this link and the body to paste:
  https://github.com/har5h98/crm-lifecycle-ops/issues/new?template=wrong-result.yml
  (Don't put the body in the URL.)

Reply with the issue link and one line on what happens next: it becomes a test case, then gets fixed.
