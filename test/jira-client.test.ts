import { describe, expect, it } from "bun:test";
import { JiraClient, loadJiraConfig, markdownToAdf } from "../src/jira-client";

describe("loadJiraConfig", () => {
	it("requires every tenant-specific value from the environment", () => {
		expect(() => loadJiraConfig({ JIRA_API_TOKEN: "token", JIRA_EMAIL: "agent@example.test" })).toThrow("JIRA_BASE_URL");
		expect(() => loadJiraConfig({ JIRA_API_TOKEN: "token", JIRA_BASE_URL: "https://example.atlassian.net" })).toThrow("JIRA_EMAIL");
	});

	it("reads the canonical JIRA_API_TOKEN name", () => {
		expect(loadJiraConfig({ JIRA_API_TOKEN: "token", JIRA_EMAIL: "agent@example.test", JIRA_BASE_URL: "https://example.atlassian.net/" })).toEqual({
			apiKey: "token",
			email: "agent@example.test",
			baseUrl: "https://example.atlassian.net",
		});
	});

	it("accepts JIRA_API_KEY as an alias when JIRA_API_TOKEN is absent", () => {
		expect(loadJiraConfig({ JIRA_API_KEY: "token", JIRA_EMAIL: "agent@example.test", JIRA_BASE_URL: "https://example.atlassian.net" })).toEqual({
			apiKey: "token",
			email: "agent@example.test",
			baseUrl: "https://example.atlassian.net",
		});
	});

	it("prefers JIRA_API_TOKEN when both names are present", () => {
		expect(loadJiraConfig({ JIRA_API_TOKEN: "canonical", JIRA_API_KEY: "alias", JIRA_EMAIL: "agent@example.test", JIRA_BASE_URL: "https://example.atlassian.net" })).toEqual({
			apiKey: "canonical",
			email: "agent@example.test",
			baseUrl: "https://example.atlassian.net",
		});
	});

	it("raises an explicit authentication error when neither token env var is set", () => {
		expect(() => loadJiraConfig({ JIRA_EMAIL: "agent@example.test", JIRA_BASE_URL: "https://example.atlassian.net" })).toThrow("Jira authentication is not configured");
	});
});

describe("JiraClient", () => {
	it("surfaces 401 responses as an authentication error naming both env var names", async () => {
		const seen: RequestInit[] = [];
		const fakeFetch = async (url: string | URL | Request, init?: RequestInit) => {
			seen.push(init as RequestInit);
			return new Response(JSON.stringify({ errorMessages: ["Invalid email or API token."] }), {
				status: 401,
				headers: { "Content-Type": "application/json" },
			});
		};
		const config = { baseUrl: "https://example.atlassian.net", email: "agent@example.test", apiKey: "token" };
		const client = new JiraClient(config, fakeFetch as unknown as typeof fetch);

		await expect(client.get("/rest/api/3/myself")).rejects.toThrow(/Jira authentication failed \(401\).*JIRA_API_TOKEN \(or JIRA_API_KEY\).*Invalid email or API token\./);

		const auth = (seen[0]?.headers as Record<string, string>)?.Authorization;
		expect(auth).toMatch(/^Basic /);
	});

	it("passes non-auth HTTP errors through as Jira REST status errors", async () => {
		const fakeFetch = async () =>
			new Response(JSON.stringify({ errorMessages: ["Issue Does Not Exist"] }), {
				status: 404,
				headers: { "Content-Type": "application/json" },
			});
		const config = { baseUrl: "https://example.atlassian.net", email: "agent@example.test", apiKey: "token" };
		const client = new JiraClient(config, fakeFetch as unknown as typeof fetch);

		await expect(client.get("/rest/api/3/issue/MISSING-1")).rejects.toThrow(/Jira REST 404: Issue Does Not Exist/);
		await expect(client.get("/rest/api/3/issue/MISSING-1")).rejects.not.toThrow("Jira authentication failed");
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
