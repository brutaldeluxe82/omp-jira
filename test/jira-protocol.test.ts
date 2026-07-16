import { describe, expect, it } from "bun:test";
import type { InternalUrl } from "@oh-my-pi/pi-coding-agent/internal-urls";
import { JiraProtocolHandler, parseJiraUrl } from "../src/jira-protocol";

function internalUrl(value: string): InternalUrl {
	const url = new URL(value) as InternalUrl;
	Object.assign(url, { rawHost: url.host, rawPathname: url.pathname });
	return url;
}

describe("jira:// parser", () => {
	it("accepts issue, transition, hierarchy, type, comment, and JQL search paths", () => {
		expect(parseJiraUrl(internalUrl("jira://PROJECT-123"))).toEqual({ kind: "issue", issueKey: "PROJECT-123" });
		expect(parseJiraUrl(internalUrl("jira://PROJECT-123/transitions"))).toEqual({ kind: "transitions", issueKey: "PROJECT-123" });
		expect(parseJiraUrl(internalUrl("jira://PROJECT-123/hierarchy"))).toEqual({ kind: "hierarchy", issueKey: "PROJECT-123" });
		expect(parseJiraUrl(internalUrl("jira://PROJECT/issue-types"))).toEqual({ kind: "issueTypes", projectKey: "PROJECT" });
		expect(parseJiraUrl(internalUrl("jira://PROJECT-123/comments?limit=10"))).toEqual({ kind: "comments", issueKey: "PROJECT-123", commentLimit: 10 });
		expect(parseJiraUrl(internalUrl("jira://search?jql=project%20%3D%20PROJECT&limit=20&nextPageToken=token-5"))).toEqual({ kind: "search", jql: "project = PROJECT", limit: 20, nextPageToken: "token-5" });
	});

	it("rejects unsafe paths and unbounded searches", () => {
		expect(() => parseJiraUrl(internalUrl("jira://search"))).toThrow("jql");
		expect(() => parseJiraUrl(internalUrl("jira://PROJECT-123/unknown"))).toThrow("sub-path");
		expect(() => parseJiraUrl(internalUrl("jira://../../rest"))).toThrow("Invalid Jira issue key");
	});
});

describe("JiraProtocolHandler", () => {
	it("renders ADF issue details as Markdown", async () => {
		const paths: string[] = [];
		const client = {
			async get(path: string) {
				paths.push(path);
				return {
					key: "PROJECT-123",
					fields: {
						summary: "Action retryability",
						status: { name: "In Progress" },
						issuetype: { name: "Initiative" },
						priority: { name: "High" },
						project: { key: "PROJECT", name: "Example Project" },
						description: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: "Direct REST works." }] }] },
					},
				};
			},
		};
		const handler = new JiraProtocolHandler(client as never);

		const result = await handler.resolve(internalUrl("jira://PROJECT-123"));

		expect(paths[0]).toContain("/rest/api/3/issue/PROJECT-123");
		expect(handler.immutable).toBe(true);
		expect(result.content).toContain("# PROJECT-123: Action retryability");
		expect(result.content).toContain("Direct REST works.");
	});
});
