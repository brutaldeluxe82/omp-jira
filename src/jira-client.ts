import { markdownToAdf as convertMarkdownToAdf } from "marklassian";


export interface JiraConfig {
	baseUrl: string;
	email: string;
	apiKey: string;
}

export interface JiraErrorPayload {
	errorMessages?: string[];
	errors?: Record<string, string>;
	message?: string;
}

export interface AdfNode {
	type: string;
	text?: string;
	attrs?: Record<string, unknown>;
	marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
	content?: AdfNode[];
}

export interface AdfDocument {
	type: "doc";
	version: 1;
	content: AdfNode[];
}

export type JiraFetch = typeof fetch;

export function loadJiraConfig(environment: NodeJS.ProcessEnv = process.env): JiraConfig {
	// JIRA_API_TOKEN is the canonical Atlassian name ("API token" in the UI);
	// JIRA_API_KEY is accepted as an alias for environment configurations that already use it.
	const apiKey = environment.JIRA_API_TOKEN || environment.JIRA_API_KEY;
	const baseUrl = environment.JIRA_BASE_URL?.replace(/\/$/, "");
	const email = environment.JIRA_EMAIL;
	if (!apiKey) throw new Error("Jira authentication is not configured: set JIRA_API_TOKEN (or JIRA_API_KEY) to an Atlassian API token. Create one at https://id.atlassian.com/manage-profile/security/api-tokens and expose it only through this environment variable.");
	if (!baseUrl) throw new Error("JIRA_BASE_URL is required, for example https://your-site.atlassian.net.");
	if (!email) throw new Error("JIRA_EMAIL is required for Jira API token authentication.");
	return { baseUrl, email, apiKey };
}

export function assertIssueKey(value: string): string {
	const key = value.trim();
	if (!/^[A-Z][A-Z0-9]+-\d+$/i.test(key)) throw new Error(`Invalid Jira issue key '${value}'.`);
	return key.toUpperCase();
}

/** Convert Markdown syntax into the rich-text ADF document Jira Cloud REST v3 requires. */
export function markdownToAdf(markdown: string): AdfDocument {
	return convertMarkdownToAdf(markdown);
}

export function renderAdf(document: unknown): string {
	if (!document || typeof document !== "object") return "";
	return renderNode(document as AdfNode).replace(/\n{3,}/g, "\n\n").trim();
}

function renderNode(node: AdfNode): string {
	const content = (node.content ?? []).map(renderNode).join("");
	switch (node.type) {
		case "text":
			return node.text ?? "";
		case "paragraph":
			return `${content}\n\n`;
		case "heading":
			return `${"#".repeat(Number(node.attrs?.level) || 1)} ${content}\n\n`;
		case "bulletList":
			return `${content}\n`;
		case "orderedList":
			return `${content}\n`;
		case "listItem":
			return `- ${content.trim()}\n`;
		case "codeBlock":
			return `\`\`\`\n${content.trimEnd()}\n\`\`\`\n\n`;
		case "hardBreak":
			return "\n";
		case "rule":
			return "---\n\n";
		default:
			return content;
	}
}

/** Direct Jira Cloud REST API client using Basic authentication and an API token. */
export class JiraClient {
	constructor(
		private readonly config?: JiraConfig,
		private readonly requestFetch: JiraFetch = fetch,
	) {}

	async get<T>(path: string, signal?: AbortSignal): Promise<T> {
		return this.request<T>(path, { method: "GET", signal });
	}

	async post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
		return this.request<T>(path, { method: "POST", body: JSON.stringify(body), signal });
	}

	async put(path: string, body: unknown, signal?: AbortSignal): Promise<void> {
		await this.request<void>(path, { method: "PUT", body: JSON.stringify(body), signal });
	}

	private async request<T>(path: string, init: RequestInit): Promise<T> {
		const config = this.config ?? loadJiraConfig();
		const authorization = Buffer.from(`${config.email}:${config.apiKey}`).toString("base64");
		const response = await this.requestFetch(`${config.baseUrl}${path}`, {
			...init,
			headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Basic ${authorization}`, ...init.headers },
		});
		if (!response.ok) {
			const body = await response.text();
			let details: JiraErrorPayload | undefined;
			try {
				details = JSON.parse(body) as JiraErrorPayload;
			} catch {
				// Jira occasionally returns plain text through a proxy.
			}
			const message = details?.errorMessages?.join("; ") || Object.entries(details?.errors ?? {}).map(([field, error]) => `${field}: ${error}`).join("; ") || details?.message || body.slice(0, 500) || response.statusText;
			if (response.status === 401 || response.status === 403) {
				throw new Error(`Jira authentication failed (${response.status}). Verify JIRA_EMAIL and JIRA_API_TOKEN (or JIRA_API_KEY) and that the token has not been revoked. Underlying response: ${message}`);
			}
			throw new Error(`Jira REST ${response.status}: ${message}`);
		}
		if (response.status === 204) return undefined as T;
		return (await response.json()) as T;
	}
}
