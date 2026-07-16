import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { InternalUrlRouter } from "@oh-my-pi/pi-coding-agent/internal-urls";
import { JiraProtocolHandler } from "./jira-protocol";
import { JiraToolDispatcher, JIRA_TOOL_OPS, type JiraToolInput } from "./jira-tool";

/** Register read-only Jira URIs and confirmation-gated direct REST mutations. */
export default function jiraExtension(pi: ExtensionAPI): void {
	const router = InternalUrlRouter.instance();
	if (!router.getHandler("jira")) router.register(new JiraProtocolHandler());

	const { z } = pi.zod;
	const dispatcher = new JiraToolDispatcher();
	pi.registerTool({
		name: "jira",
		label: "Jira",
		description: "Jira mutations: create, update, transition, and comment on issues. For reads, use jira://<ISSUE-KEY>, jira://<ISSUE-KEY>/transitions, jira://<ISSUE-KEY>/hierarchy, jira://<ISSUE-KEY>/comments, jira://<PROJECT>/issue-types, and jira://search?jql=<JQL> URIs — not this tool. Work-item changes require confirm: true.",
		parameters: z.object({
			op: z.enum(JIRA_TOOL_OPS).describe("Jira operation"),
			issueKey: z.string().optional().describe("Jira issue key, for example PROJECT-123"),
			project: z.string().optional().describe("Project key for issue_create"),
			issueType: z.string().optional().describe("Issue type name for issue_create; defaults to Task. Sub-task types require parentIssueKey. Read jira://<PROJECT>/issue-types for available types."),
			summary: z.string().optional().describe("Issue summary for create or update"),
			description: z.string().optional().describe("Markdown description parsed into Jira ADF for create or update"),
			priorityId: z.string().optional().describe("Jira priority ID"),
			labels: z.array(z.string()).optional().describe("Complete replacement label list for create or update"),
			assigneeAccountId: z.string().nullable().optional().describe("Atlassian account ID; null unassigns on issue_update"),
			parentIssueKey: z.string().optional().describe("Parent issue key for create or update"),
			teamFieldId: z.string().optional().describe("Jira custom-field ID for team assignment; required with teamId"),
			teamId: z.string().optional().describe("Atlassian team UUID for issue_create or issue_update; requires teamFieldId"),
			transitionId: z.string().optional().describe("Transition ID; read jira://<KEY>/transitions to discover it"),
			transitionName: z.string().optional().describe("Exact transition or target-status name; resolved against live transitions"),
			comment: z.string().optional().describe("Markdown comment parsed into Jira ADF"),
			confirm: z.boolean().optional().describe("Must be true for every Jira mutation"),
		}),
		approval: "write",
		async execute(_toolCallId, params, signal) {
			const result = await dispatcher.execute(params as JiraToolInput, signal);
			return { content: [{ type: "text", text: result.content }], details: result.details };
		},
	});
}
