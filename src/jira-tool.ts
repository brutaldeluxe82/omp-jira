import { assertIssueKey, JiraClient, markdownToAdf } from "./jira-client";

export const JIRA_TOOL_OPS = ["issue_create", "issue_update", "issue_transition", "comment_create"] as const;


export type JiraToolOp = (typeof JIRA_TOOL_OPS)[number];

export interface JiraToolInput {
	op: JiraToolOp;
	issueKey?: string;
	project?: string;
	issueType?: string;
	summary?: string;
	description?: string;
	priorityId?: string;
	labels?: string[];
	assigneeAccountId?: string | null;
	parentIssueKey?: string;
	teamFieldId?: string;
	teamId?: string;
	transitionId?: string;
	transitionName?: string;
	comment?: string;
	confirm?: boolean;
}

export interface JiraToolResult {
	content: string;
	details: {
		op: JiraToolOp;
		issueKey?: string;
	};
}

interface CreatedIssue {
	key?: string;
	self?: string;
}

interface TransitionsResponse {
	transitions?: Array<{ id?: string; name?: string; to?: { name?: string } }>;
}

function requireNonBlank(value: string | undefined, name: string): string {
	if (!value?.trim()) throw new Error(`${name} is required for this Jira operation.`);
	return value.trim();
}

function optionalLabels(labels: string[] | undefined): string[] | undefined {
	if (!labels) return undefined;
	if (labels.some(label => !label.trim())) throw new Error("labels cannot contain empty values.");
	return labels.map(label => label.trim());
}

function applyTeamField(fields: Record<string, unknown>, input: JiraToolInput): void {
	if (input.teamId === undefined && input.teamFieldId === undefined) return;
	fields[requireNonBlank(input.teamFieldId, "teamFieldId")] = { id: requireNonBlank(input.teamId, "teamId") };
}

/** One confirmation-gated dispatcher for direct Jira issue mutations. */
export class JiraToolDispatcher {
	constructor(private readonly client: JiraClient = new JiraClient()) {}

	async execute(input: JiraToolInput, signal?: AbortSignal): Promise<JiraToolResult> {
		if (input.confirm !== true) throw new Error(`${input.op} requires confirm: true.`);
		switch (input.op) {
			case "issue_create":
				return this.create(input, signal);
			case "issue_update":
				return this.update(input, signal);
			case "issue_transition":
				return this.transition(input, signal);
			case "comment_create":
				return this.comment(input, signal);
		}
	}

	private async create(input: JiraToolInput, signal?: AbortSignal): Promise<JiraToolResult> {
		const issueType = input.issueType?.trim() || "Task";
		const isSubtask = /sub-?task/i.test(issueType);
		if (isSubtask && !input.parentIssueKey?.trim()) {
			throw new Error(`Issue type '${issueType}' requires parentIssueKey. Read jira://${requireNonBlank(input.project, "project")}/issue-types to confirm the hierarchy level, then provide the parent issue key.`);
		}
		const fields: Record<string, unknown> = {
			project: { key: requireNonBlank(input.project, "project") },
			issuetype: { name: issueType },
			summary: requireNonBlank(input.summary, "summary"),
		};
		if (input.description?.trim()) fields.description = markdownToAdf(input.description);
		if (input.priorityId?.trim()) fields.priority = { id: input.priorityId.trim() };
		const labels = optionalLabels(input.labels);
		if (labels) fields.labels = labels;
		if (input.assigneeAccountId?.trim()) fields.assignee = { accountId: input.assigneeAccountId.trim() };
		if (input.parentIssueKey?.trim()) fields.parent = { key: assertIssueKey(input.parentIssueKey) };
		applyTeamField(fields, input);
		const issue = await this.client.post<CreatedIssue>("/rest/api/3/issue", { fields }, signal);
		return { content: `Created Jira issue ${issue.key ?? "(key unavailable)"}.`, details: { op: input.op, issueKey: issue.key } };
	}

	private async update(input: JiraToolInput, signal?: AbortSignal): Promise<JiraToolResult> {
		const issueKey = assertIssueKey(requireNonBlank(input.issueKey, "issueKey"));
		const fields: Record<string, unknown> = {};
		if (input.summary !== undefined) fields.summary = requireNonBlank(input.summary, "summary");
		if (input.description !== undefined) fields.description = markdownToAdf(input.description);
		if (input.priorityId !== undefined) fields.priority = { id: requireNonBlank(input.priorityId, "priorityId") };
		const labels = optionalLabels(input.labels);
		if (labels) fields.labels = labels;
		if (input.assigneeAccountId !== undefined) fields.assignee = input.assigneeAccountId?.trim() ? { accountId: input.assigneeAccountId.trim() } : null;
		if (input.parentIssueKey !== undefined) fields.parent = { key: assertIssueKey(input.parentIssueKey) };
		applyTeamField(fields, input);
		if (Object.keys(fields).length === 0) throw new Error("issue_update requires at least one mutable field.");
		await this.client.put(`/rest/api/3/issue/${encodeURIComponent(issueKey)}`, { fields }, signal);
		return { content: `Updated Jira issue ${issueKey}.`, details: { op: input.op, issueKey } };
	}

	private async transition(input: JiraToolInput, signal?: AbortSignal): Promise<JiraToolResult> {
		const issueKey = assertIssueKey(requireNonBlank(input.issueKey, "issueKey"));
		const transitionId = input.transitionId?.trim() || await this.resolveTransitionId(issueKey, requireNonBlank(input.transitionName, "transitionName"), signal);
		await this.client.post<void>(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, { transition: { id: transitionId } }, signal);
		return { content: `Transitioned Jira issue ${issueKey} with transition ${transitionId}.`, details: { op: input.op, issueKey } };
	}

	private async resolveTransitionId(issueKey: string, transitionName: string, signal?: AbortSignal): Promise<string> {
		const response = await this.client.get<TransitionsResponse>(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, signal);
		const matching = (response.transitions ?? []).filter(transition => [transition.name, transition.to?.name].some(name => name?.toLowerCase() === transitionName.toLowerCase()));
		if (matching.length !== 1 || !matching[0].id) throw new Error(`Transition '${transitionName}' is unavailable or ambiguous for ${issueKey}. Read jira://${issueKey}/transitions to select an exact transition ID.`);
		return matching[0].id;
	}

	private async comment(input: JiraToolInput, signal?: AbortSignal): Promise<JiraToolResult> {
		const issueKey = assertIssueKey(requireNonBlank(input.issueKey, "issueKey"));
		await this.client.post<void>(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`, { body: markdownToAdf(requireNonBlank(input.comment, "comment")) }, signal);
		return { content: `Added comment to Jira issue ${issueKey}.`, details: { op: input.op, issueKey } };
	}
}
