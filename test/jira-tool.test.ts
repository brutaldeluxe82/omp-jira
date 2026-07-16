import { describe, expect, it } from "bun:test";
import { JiraToolDispatcher } from "../src/jira-tool";

interface RecordedCall {
	method: "get" | "post" | "put";
	path: string;
	body?: unknown;
}

function clientRecorder(calls: RecordedCall[]) {
	return {
		async get(path: string) {
			calls.push({ method: "get", path });
			return { transitions: [{ id: "81", name: "Done", to: { name: "Done" } }] };
		},
		async post(path: string, body: unknown) {
			calls.push({ method: "post", path, body });
			return path === "/rest/api/3/issue" ? { key: "PROJECT-456" } : undefined;
		},
		async put(path: string, body: unknown) {
			calls.push({ method: "put", path, body });
		},
	};
}

describe("JiraToolDispatcher", () => {
	it("requires explicit confirmation before every mutation", async () => {
		const dispatcher = new JiraToolDispatcher(clientRecorder([]) as never);
		await expect(dispatcher.execute({ op: "issue_create", project: "PROJECT", summary: "Must not create" })).rejects.toThrow("confirm: true");
	});

	it("creates an issue with direct REST fields and valid ADF", async () => {
		const calls: RecordedCall[] = [];
		const dispatcher = new JiraToolDispatcher(clientRecorder(calls) as never);

		const result = await dispatcher.execute({ op: "issue_create", project: "PROJECT", summary: "Direct API issue", description: "Line one\nLine two", issueType: "Task", priorityId: "2", labels: ["platform"], parentIssueKey: "PROJECT-123", confirm: true });

		expect(calls).toEqual([{ method: "post", path: "/rest/api/3/issue", body: { fields: { project: { key: "PROJECT" }, issuetype: { name: "Task" }, summary: "Direct API issue", description: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: "Line one Line two" }] }] }, priority: { id: "2" }, labels: ["platform"], parent: { key: "PROJECT-123" } } } }]);
		expect(result.content).toBe("Created Jira issue PROJECT-456.");
	});

	it("resolves a transition name from the live issue transition schema", async () => {
		const calls: RecordedCall[] = [];
		const dispatcher = new JiraToolDispatcher(clientRecorder(calls) as never);

		await dispatcher.execute({ op: "issue_transition", issueKey: "PROJECT-123", transitionName: "Done", confirm: true });

		expect(calls).toEqual([
			{ method: "get", path: "/rest/api/3/issue/PROJECT-123/transitions" },
			{ method: "post", path: "/rest/api/3/issue/PROJECT-123/transitions", body: { transition: { id: "81" } } },
		]);
	});

	it("updates labels as an explicit replacement and never creates issue fields implicitly", async () => {
		const calls: RecordedCall[] = [];
		const dispatcher = new JiraToolDispatcher(clientRecorder(calls) as never);

		await dispatcher.execute({ op: "issue_update", issueKey: "PROJECT-123", labels: ["retry", "platform"], confirm: true });

		expect(calls).toEqual([{ method: "put", path: "/rest/api/3/issue/PROJECT-123", body: { fields: { labels: ["retry", "platform"] } } }]);
	});

	it("sets a team through the caller-provided custom field", async () => {
		const calls: RecordedCall[] = [];
		const dispatcher = new JiraToolDispatcher(clientRecorder(calls) as never);

		await dispatcher.execute({ op: "issue_update", issueKey: "PROJECT-123", teamFieldId: "customfield_12345", teamId: "00000000-0000-4000-8000-000000000001", confirm: true });

		expect(calls).toEqual([{ method: "put", path: "/rest/api/3/issue/PROJECT-123", body: { fields: { customfield_12345: { id: "00000000-0000-4000-8000-000000000001" } } } }]);
	});

	it("posts Markdown comments as rendered Jira ADF", async () => {
		const calls: RecordedCall[] = [];
		const dispatcher = new JiraToolDispatcher(clientRecorder(calls) as never);

		await dispatcher.execute({ op: "comment_create", issueKey: "PROJECT-123", comment: "# Result\n\n**ready**", confirm: true });

		expect(calls).toEqual([{ method: "post", path: "/rest/api/3/issue/PROJECT-123/comment", body: { body: { type: "doc", version: 1, content: [
			{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Result" }] },
			{ type: "paragraph", content: [{ type: "text", text: "ready", marks: [{ type: "strong" }] }] },
		] } } }]);
	});

	it("rejects sub-task creation without a parent issue key before hitting the REST API", async () => {
		const dispatcher = new JiraToolDispatcher(clientRecorder([]) as never);
		await expect(dispatcher.execute({ op: "issue_create", project: "LF", issueType: "Sub-task", summary: "Orphan", confirm: true })).rejects.toThrow("parentIssueKey");
	});
});
