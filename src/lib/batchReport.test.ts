import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { Account } from "../types";
import { createBatchReportWorkbook } from "./batchReport";

function worksheetXml(accounts: readonly Account[]): string {
  const files = unzipSync(createBatchReportWorkbook({ accounts, testStates: {}, columns: ["name"] }));
  const worksheet = files["xl/worksheets/sheet1.xml"];
  if (!worksheet) throw new Error("The XLSX worksheet is missing.");
  return strFromU8(worksheet);
}

describe("batch report workbook", () => {
  it("replaces XML 1.0 forbidden characters while retaining normal Unicode", () => {
    const invalidCharacters = ["\u0000", "\u0008", "\u000B", "\u000C", "\u000E", "\u001F", "\uFFFE", "\uFFFF", "\uD800", "\uDC00"];
    const invalidText = invalidCharacters.join("|");
    const replacementText = invalidCharacters.map(() => "\uFFFD").join("|");
    const xml = worksheetXml([{
      id: 1,
      name: `before${invalidText}after 中文\u{1F642}\tline\nbreak\rend`,
      platform: "openai",
      accountType: "oauth",
      status: "active",
    }]);

    expect(xml).toContain(`before${replacementText}after 中文\u{1F642}\tline\nbreak\rend`);
    expect(xml).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/);
  });

  it("keeps formula-prefix protection after XML normalization", () => {
    const xml = worksheetXml([{
      id: 1,
      name: "=SUM(A1:A2)",
      platform: "openai",
      accountType: "oauth",
      status: "active",
    }]);

    expect(xml).toContain("&apos;=SUM(A1:A2)");
  });
});
