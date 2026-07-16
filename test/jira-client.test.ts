import { describe, expect, it } from "bun:test";
import { loadJiraConfig, markdownToAdf } from "../src/jira-client";

describe("loadJiraConfig", () => {
	it("requires every tenant-specific value from the environment", () => {
		expect(() => loadJiraConfig({ JIRA_API_KEY: "token", JIRA_EMAIL: "agent@example.test" })).toThrow("JIRA_BASE_URL");
		expect(() => loadJiraConfig({ JIRA_API_KEY: "token", JIRA_BASE_URL: "https://example.atlassian.net" })).toThrow("JIRA_EMAIL");
	});

	it("uses only supplied environment values", () => {
		expect(loadJiraConfig({ JIRA_API_KEY: "token", JIRA_EMAIL: "agent@example.test", JIRA_BASE_URL: "https://example.atlassian.net/" })).toEqual({
		apiKey: "token",
		email: "agent@example.test",
		baseUrl: "https://example.atlassian.net",
	});
	});
});

describe("markdownToAdf", () => {
	it("converts common Markdown blocks and inline marks into Jira ADF", () => {
		const document = markdownToAdf("# Release\n\n**bold** and *italic* with `code` and [link](https://example.test)\n\n- first\n- second\n\n```ts\nconst ready = true;\n```");

		expect(document.content[0]).toEqual({ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Release" }] });
		expect(document.content[1]).toEqual({ type: "paragraph", content: [
			{ type: "text", text: "bold", marks: [{ type: "strong" }] },
			{ type: "text", text: " and " },
			{ type: "text", text: "italic", marks: [{ type: "em" }] },
			{ type: "text", text: " with " },
			{ type: "text", text: "code", marks: [{ type: "code" }] },
			{ type: "text", text: " and " },
			{ type: "text", text: "link", marks: [{ type: "link", attrs: { href: "https://example.test" } }] },
		] });
		expect(document.content[2]?.type).toBe("bulletList");
		expect(document.content[3]).toEqual({ type: "codeBlock", attrs: { language: "ts" }, content: [{ type: "text", text: "const ready = true;" }] });
	});
});
