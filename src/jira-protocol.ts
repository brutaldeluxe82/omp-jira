import type { InternalResource, InternalUrl, ProtocolHandler, ResolveContext } from "@oh-my-pi/pi-coding-agent/internal-urls";
import { assertIssueKey, JiraClient, renderAdf } from "./jira-client";

const SEARCH_LIMIT_DEFAULT = 50;
const SEARCH_LIMIT_MAX = 100;
const COMMENT_LIMIT_DEFAULT = 50;
const ISSUE_FIELDS = "summary,status,issuetype,priority,description,labels,assignee,reporter,parent,subtasks,project";

interface ParsedIssueUrl {
	kind: "issue" | "transitions" | "comments" | "hierarchy";
	issueKey: string;
	commentLimit?: number;
}

interface ParsedSearchUrl {
	kind: "search";
	jql: string;
	limit: number;
	nextPageToken?: string;
}

interface ParsedProjectTypesUrl {
	kind: "issueTypes";
	projectKey: string;
}

type ParsedUrl = ParsedIssueUrl | ParsedSearchUrl | ParsedProjectTypesUrl;

interface JiraUser {
	displayName?: string;
	accountId?: string;
}

interface JiraIssue {
	id?: string;
	key?: string;
	fields?: {
		summary?: string;
		status?: { name?: string };
		issuetype?: { name?: string };
		priority?: { name?: string };
		description?: unknown;
		labels?: string[];
		assignee?: JiraUser | null;
		reporter?: JiraUser | null;
		parent?: { key?: string; fields?: { summary?: string } };
		project?: { key?: string; name?: string };
		subtasks?: Array<{ key?: string; fields?: { summary?: string; status?: { name?: string } } }>;
	};
}

interface JiraSearchResponse {
	issues?: JiraIssue[];
	nextPageToken?: string;
	isLast?: boolean;
}

interface JiraTransitionsResponse {
	transitions?: Array<{ id?: string; name?: string; to?: { name?: string } }>;
}

interface JiraCommentsResponse {
	comments?: Array<{ id?: string; author?: JiraUser; created?: string; updated?: string; body?: unknown }>;
	total?: number;
}

interface JiraProjectIssueTypesResponse {
	issueTypes?: Array<{ id?: string; name?: string; description?: string; subtask?: boolean; hierarchyLevel?: number }>;
	total?: number;
}

function parsePositiveInteger(value: string | null, name: string, defaultValue: number, maximum: number): number {
	if (value === null) return defaultValue;
	if (!/^[1-9]\d*$/.test(value)) throw new Error(`${name} must be a positive integer.`);
	return Math.min(Number(value), maximum);
}


/** Parse the direct, read-only Jira URI family. */
export function parseJiraUrl(url: InternalUrl): ParsedUrl {
	const host = url.rawHost || url.hostname;
	const rawPath = url.rawPathname ?? url.pathname;
	const path = rawPath.replace(/^\//, "").replace(/\/$/, "");
	if (host.toLowerCase() === "search" && !path) {
		const jql = url.searchParams.get("jql")?.trim();
		if (!jql) throw new Error("jira://search requires a non-empty jql query parameter.");
		return {
			kind: "search",
			jql,
			limit: parsePositiveInteger(url.searchParams.get("limit"), "limit", SEARCH_LIMIT_DEFAULT, SEARCH_LIMIT_MAX),
			nextPageToken: url.searchParams.get("nextPageToken")?.trim() || undefined,
		};
	}
	if (/^[A-Z][A-Z0-9]+$/i.test(host) && path === "issue-types") return { kind: "issueTypes", projectKey: host.toUpperCase() };
	if (!host || path.split("/").filter(Boolean).length > 1) {
		throw new Error("Invalid jira:// URL. Use jira://<ISSUE-KEY>, jira://<ISSUE-KEY>/transitions|comments|hierarchy, jira://<PROJECT>/issue-types, or jira://search?jql=<JQL>.");
	}
	const issueKey = assertIssueKey(host);
	if (!path) return { kind: "issue", issueKey };
	if (path === "transitions") return { kind: "transitions", issueKey };
	if (path === "comments") return { kind: "comments", issueKey, commentLimit: parsePositiveInteger(url.searchParams.get("limit"), "limit", COMMENT_LIMIT_DEFAULT, COMMENT_LIMIT_DEFAULT) };
	if (path === "hierarchy") return { kind: "hierarchy", issueKey };
	throw new Error("Invalid jira:// issue sub-path. Use /transitions, /comments, or /hierarchy.");
}

function issueSummary(issue: JiraIssue): string {
	const fields = issue.fields ?? {};
	const labels = fields.labels?.length ? fields.labels.join(", ") : "none";
	const parent = fields.parent?.key ? `${fields.parent.key}${fields.parent.fields?.summary ? ` — ${fields.parent.fields.summary}` : ""}` : "none";
	const subtasks = fields.subtasks?.map(child => `- [${child.fields?.status?.name ?? "?"}] ${child.key ?? "?"} — ${child.fields?.summary ?? ""}`).join("\n") ?? "No sub-tasks.";
	return [
		`# ${issue.key ?? "?"}: ${fields.summary ?? "(no summary)"}`,
		"",
		`- **Type:** ${fields.issuetype?.name ?? "?"}`,
		`- **Status:** ${fields.status?.name ?? "?"}`,
		`- **Priority:** ${fields.priority?.name ?? "?"}`,
		`- **Project:** ${fields.project?.key ?? "?"} — ${fields.project?.name ?? "?"}`,
		`- **Assignee:** ${fields.assignee?.displayName ?? "Unassigned"}`,
		`- **Reporter:** ${fields.reporter?.displayName ?? "?"}`,
		`- **Parent:** ${parent}`,
		`- **Labels:** ${labels}`,
		"",
		"## Description",
		"",
		renderAdf(fields.description) || "No description.",
		"",
		"## Sub-tasks",
		"",
		subtasks,
	].join("\n");
}

/** Immutable Jira issue resources backed directly by Jira Cloud REST API v3. */
export class JiraProtocolHandler implements ProtocolHandler {
	readonly scheme = "jira";
	readonly immutable = true;

	constructor(private readonly client: JiraClient = new JiraClient()) {}

	async resolve(url: InternalUrl, context?: ResolveContext): Promise<InternalResource> {
		const parsed = parseJiraUrl(url);
		if (parsed.kind === "search") return this.search(parsed, url, context?.signal);
		if (parsed.kind === "issueTypes") return this.issueTypes(parsed.projectKey, url, context?.signal);
		if (parsed.kind === "issue") return this.issue(parsed.issueKey, url, context?.signal);
		if (parsed.kind === "transitions") return this.transitions(parsed.issueKey, url, context?.signal);
		if (parsed.kind === "hierarchy") return this.hierarchy(parsed.issueKey, url, context?.signal);
		return this.comments(parsed.issueKey, parsed.commentLimit as number, url, context?.signal);
	}

	private async issue(issueKey: string, url: InternalUrl, signal?: AbortSignal): Promise<InternalResource> {
		const issue = await this.client.get<JiraIssue>(`/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=${ISSUE_FIELDS}`, signal);
		return { url: url.href, content: issueSummary(issue), contentType: "text/markdown" };
	}

	private async issueTypes(projectKey: string, url: InternalUrl, signal?: AbortSignal): Promise<InternalResource> {
		const response = await this.client.get<JiraProjectIssueTypesResponse>(`/rest/api/3/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes?maxResults=100`, signal);
		const types = (response.issueTypes ?? []).sort((left, right) => (right.hierarchyLevel ?? 0) - (left.hierarchyLevel ?? 0) || (left.name ?? "").localeCompare(right.name ?? "")).map(type => `- Level ${type.hierarchyLevel ?? "?"}: ${type.name ?? "?"} (${type.subtask ? "sub-task" : "standard"})${type.description ? ` — ${type.description}` : ""}`);
		return { url: url.href, content: `# ${projectKey} issue types (${response.total ?? types.length})\n\n${types.length ? types.join("\n") : "No issue types available."}`, contentType: "text/markdown" };
	}

	private async transitions(issueKey: string, url: InternalUrl, signal?: AbortSignal): Promise<InternalResource> {
		const response = await this.client.get<JiraTransitionsResponse>(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, signal);
		const transitions = (response.transitions ?? []).map(transition => `- ${transition.id ?? "?"}: ${transition.name ?? "?"} → ${transition.to?.name ?? "?"}`);
		return { url: url.href, content: `# ${issueKey} transitions\n\n${transitions.length ? transitions.join("\n") : "No transitions available."}`, contentType: "text/markdown" };
	}

	private async hierarchy(issueKey: string, url: InternalUrl, signal?: AbortSignal): Promise<InternalResource> {
		const lineage: JiraIssue[] = [];
		let current = await this.hierarchyIssue(issueKey, signal);
		lineage.unshift(current);
		while (current.fields?.parent?.key) {
			current = await this.hierarchyIssue(current.fields.parent.key, signal);
			lineage.unshift(current);
		}
		const params = new URLSearchParams({ jql: `parent = "${issueKey}"`, maxResults: "100", fields: "summary,status,issuetype" });
		const children = await this.client.get<JiraSearchResponse>(`/rest/api/3/search/jql?${params}`, signal);
		const describe = (issue: JiraIssue) => `- [${issue.fields?.status?.name ?? "?"}] ${issue.key ?? "?"} — ${issue.fields?.summary ?? ""} (${issue.fields?.issuetype?.name ?? "?"})`;
		return { url: url.href, content: `# ${issueKey} hierarchy\n\n## Ancestor path\n\n${lineage.map(describe).join("\n")}\n\n## Direct children\n\n${(children.issues ?? []).length ? (children.issues ?? []).map(describe).join("\n") : "No direct children."}`, contentType: "text/markdown" };
	}

	private async hierarchyIssue(issueKey: string, signal?: AbortSignal): Promise<JiraIssue> {
		return this.client.get<JiraIssue>(`/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=summary,status,issuetype,parent`, signal);
	}

	private async comments(issueKey: string, limit: number, url: InternalUrl, signal?: AbortSignal): Promise<InternalResource> {
		const response = await this.client.get<JiraCommentsResponse>(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment?maxResults=${limit}`, signal);
		const comments = (response.comments ?? []).map(comment => [
			`## ${comment.author?.displayName ?? "?"} — ${comment.created ?? "?"}`,
			renderAdf(comment.body) || "(empty comment)",
		].join("\n\n"));
		return { url: url.href, content: `# ${issueKey} comments (${response.total ?? comments.length})\n\n${comments.length ? comments.join("\n\n") : "No comments."}`, contentType: "text/markdown" };
	}

	private async search(parsed: ParsedSearchUrl, url: InternalUrl, signal?: AbortSignal): Promise<InternalResource> {
		const params = new URLSearchParams({ jql: parsed.jql, maxResults: String(parsed.limit), fields: "summary,status,issuetype,priority" });
		if (parsed.nextPageToken) params.set("nextPageToken", parsed.nextPageToken);
		const response = await this.client.get<JiraSearchResponse>(`/rest/api/3/search/jql?${params}`, signal);
		const issues = (response.issues ?? []).map(issue => `- [${issue.fields?.status?.name ?? "?"}] ${issue.key ?? "?"} — ${issue.fields?.summary ?? ""} (${issue.fields?.issuetype?.name ?? "?"}, ${issue.fields?.priority?.name ?? "?"})`);
		const nextPage = response.nextPageToken ? (() => {
			const nextUrl = new URL(url.href);
			nextUrl.searchParams.set("nextPageToken", response.nextPageToken as string);
			return `\n\nNext page: ${nextUrl.href}`;
		})() : "";
		return { url: url.href, content: `# Jira search${response.isLast === false ? " (more results available)" : ""}\n\n${issues.length ? issues.join("\n") : "No matches."}${nextPage}`, contentType: "text/markdown" };
	}
}
