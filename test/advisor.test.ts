import { describe, expect, it } from "vitest";
import { RULES, majorsCrossed } from "../src/upgrade/rules.js";
import { byRule, rulesFor, scanFile } from "../src/upgrade/scan.js";
import { compareVersions, hasAppChecks, isOutdated, versionParts } from "../src/upgrade/versions.js";
import { schemaChecks } from "../src/advice/schemaChecks.js";
import { formatChecks, formatUpgrade } from "../src/advice/format.js";
import type { ParseSchema } from "../src/client/parse.js";

// cloud code written for Parse Server 2 (like the sofi app's)
const OLD_CODE = `
Parse.Cloud.define('hello', function (request, response) {
  // response.success('in a comment');
  response.success("Hello");
});
Parse.Cloud.job("cleanup", function (request, status) {
  query.find({ success: function (items) { status.success("done"); }, error: status.error });
});
const p = new Parse.Promise();
Parse.Cloud.httpRequest({ url: "https://example.com" });
Parse.Cloud.beforeSaveFile((request) => {});
`;

describe("versions", () => {
  it("reads and compares image tags", () => {
    expect(versionParts("release-6.5.11-ubi8-node18")).toEqual([6, 5, 11]);
    expect(compareVersions("release-8.6.117", "release-6.5.11-preview")).toBeGreaterThan(0);
    expect(hasAppChecks("release-6.5.11-preview")).toBe(true);
    expect(hasAppChecks("release-4.1.0-node18-rc2")).toBe(false);
    expect(isOutdated("release-3.6.0")).toBe(true);
    expect(isOutdated("release-6.5.11")).toBe(false);
    expect(majorsCrossed(3, 6)).toEqual([4, 5, 6]);
  });
});

describe("scanning cloud code for an upgrade", () => {
  it("finds what breaks between the majors crossed, not in comments", () => {
    const found = scanFile("main.js", OLD_CODE, rulesFor(2, 8));
    const ids = byRule(found).map((g) => g.rule.id);
    expect(ids).toEqual(expect.arrayContaining(["response-success", "job-status", "backbone-callbacks", "parse-promise", "http-request", "file-triggers"]));
    const response = found.filter((f) => f.rule.id === "response-success");
    expect(response.map((f) => f.line)).toEqual([4]);
    // the breaking ones first
    expect(byRule(found)[0]!.rule.severity).toBe("breaks");
  });

  it("only applies the rules of the majors crossed", () => {
    expect(rulesFor(3, 6).every((r) => r.major > 3 && r.major <= 6)).toBe(true);
    const found = scanFile("main.js", OLD_CODE, rulesFor(3, 6));
    expect(found.some((f) => f.rule.id === "response-success")).toBe(false);
    expect(found.some((f) => f.rule.id === "http-request")).toBe(true);
  });

  it("checks aggregation stages only where there are aggregations", () => {
    const rule = RULES.filter((r) => r.id === "aggregate-syntax");
    expect(scanFile("a.js", "const x = { limit: 10 };", rule)).toEqual([]);
    expect(scanFile("a.js", "q.aggregate([{ match: { a: 1 } }]);", rule)).toHaveLength(1);
  });
});

describe("the schema checks for older versions", () => {
  const classes: ParseSchema[] = [
    { className: "_User", fields: {}, classLevelPermissions: { find: { "*": true } } },
    { className: "Post", fields: {}, classLevelPermissions: { create: { "*": true }, update: { "*": true }, delete: { "*": true }, addField: {} } },
    { className: "Note", fields: {}, classLevelPermissions: { create: {}, update: {}, delete: {}, addField: { "*": true } } },
    { className: "_Session", fields: {} },
  ];

  it("say what the app servers' checks say", () => {
    const byId = Object.fromEntries(schemaChecks(classes).map((c) => [c.id, c]));
    expect(byId["public-user-find"]!.state).toBe("warning");
    expect(byId["public-write"]!.state).toBe("fail");
    expect(byId["public-write"]!.message).toMatch(/1 classes .*: Post\./);
    // _User has no addField set: public; Note allows it; _Session isn't checked
    expect(byId["public-add-field"]!.message).toMatch(/2 classes .*: _User, Note\./);
  });

  it("put problems first, each with what to do", () => {
    const text = formatChecks(schemaChecks(classes)).join("\n");
    expect(text.indexOf("Classes writable by everyone")).toBeLessThan(text.indexOf("Public listing"));
    expect(text).toMatch(/What to do: In the Data Browser/);
  });
});

describe("the upgrade plan", () => {
  it("lists fixes with places and sources, and a way back", () => {
    const rules = rulesFor(2, 6);
    const text = formatUpgrade({
      app: "sofi",
      from: "2.8.4",
      to: "6.5.11",
      toTag: "release-6.5.11",
      majors: majorsCrossed(2, 6),
      rules,
      findings: scanFile("main.js", OLD_CODE, rules),
      filesScanned: 1,
      filesSkipped: [],
      rollback: "release-2.8.4",
    });
    expect(text).toMatch(/Major versions crossed: 3, 4, 5, 6\./);
    expect(text).toMatch(/Fix before upgrading/);
    expect(text).toMatch(/main\.js:4 {2}response\.success\("Hello"\);/);
    expect(text).toMatch(/Source: https:\/\/github\.com\/parse-community\/parse-server\/blob\/3\.0\.0\/3\.0\.0\.md/);
    expect(text).toMatch(/create_app with parseServerVersion "release-6\.5\.11"/);
    expect(text).toMatch(/back to "release-2\.8\.4"/);
  });
});
