import { describe, expect, it } from "vitest";
import { checkAccessibility, checkPreheader, previewText } from "../src/checks/a11y.js";

const ids = (fs: { checkId: string }[]) => fs.map((f) => f.checkId);

describe("accessibility", () => {
  it("an accessible email passes", () => {
    const html =
      '<html lang="en"><body><table role="presentation"><tr><td style="font-size:16px"><a href="https://x.com/new">See the new arrivals</a> <a href="https://x.com/p"><img src="p.png" alt="Shop the sale"></a></td></tr></table></body></html>';
    expect(checkAccessibility(html)).toEqual([]);
  });
  it("catches missing lang, vague and nameless links, layout tables and tiny text", () => {
    const html =
      '<html><body><table><tr><td style="font-size:10px"><a href="https://x.com">Click here</a> <a href="https://x.com/i"><img src="a.png" alt=""></a></td></tr></table></body></html>';
    expect(ids(checkAccessibility(html)).sort()).toEqual(
      ["a11y.image-link-no-alt", "a11y.layout-table-role", "a11y.no-lang", "a11y.small-text", "a11y.vague-link-text"].sort(),
    );
  });
  it("doesn't flag fragments without an <html> tag, or 0–1px preheader tricks as small text", () => {
    expect(checkAccessibility('<span style="font-size:1px">Free shipping</span><p>Hi</p>')).toEqual([]);
  });
});

describe("preheader", () => {
  it("reads the hidden preheader, and the first visible text when there isn't one", () => {
    expect(previewText('<div style="display:none">Ends Sunday</div><p>Hi there</p>')).toEqual({
      hidden: "Ends Sunday",
      firstVisible: "Hi there",
    });
    expect(previewText("<style>p{}</style><p>View in browser</p>").firstVisible).toBe("View in browser");
  });
  it('flags "view in browser" as the inbox preview', () => {
    expect(ids(checkPreheader("<p>View this email in your browser</p><p>Sale</p>", { subject: "Sale" }))).toEqual([
      "copy.preheader-boilerplate",
    ]);
  });
  it("flags a preheader that repeats the subject, not one that adds to it", () => {
    expect(ids(checkPreheader("<p>x</p>", { subject: "Summer sale is here", preheader: "Summer sale is here: 25% off" }))).toEqual([
      "copy.preheader-repeats-subject",
    ]);
    expect(checkPreheader("<p>x</p>", { subject: "Summer sale is here", preheader: "25% off everything, ends Sunday" })).toEqual([]);
  });
});
