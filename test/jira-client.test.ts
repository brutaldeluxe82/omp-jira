import { describe, expect, it } from "bun:test";
import { loadJiraConfig } from "../src/jira-client";

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
