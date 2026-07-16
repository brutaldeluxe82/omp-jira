# OMP Jira resources

Oh My Pi extension providing immutable Jira Cloud REST API reads and one confirmation-gated `jira` operation dispatcher. It uses the Jira REST API directly with an API token; it does not invoke `acli`.

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `JIRA_API_KEY` | Yes | Atlassian API token. |
| `JIRA_EMAIL` | Yes | Email address associated with the API token. |
| `JIRA_BASE_URL` | Yes | Jira Cloud site URL, for example `https://your-site.atlassian.net`. |

The token is read only from the process environment and never written to disk or rendered in a tool result.

## Read URI contract

| URI | Resolves to |
| --- | --- |
| `jira://PROJECT-123` | Issue summary, fields, ADF description, and sub-tasks. |
| `jira://PROJECT-123/transitions` | Currently available transition IDs and target statuses. |
| `jira://PROJECT-123/hierarchy` | Ancestor path and direct children, resolved through the live `parent` relation. |
| `jira://PROJECT/issue-types` | Project issue types, including each type's Jira hierarchy level and sub-task classification. |
| `jira://PROJECT-123/comments` | Latest comments rendered from Atlassian Document Format. |
| `jira://search?jql=project%20%3D%20PROJECT&limit=50` | JQL result list. |

`jira://search` requires a non-empty `jql`. Search results cap at 100 per request. If Jira returns a next-page token, the result includes a ready-to-read URI with `nextPageToken`. Issue keys are validated before an API path is constructed.

## Write tool contract

`jira` is one op-based dispatcher: select `op`, then provide only the applicable fields. Every mutation requires both tool approval and `confirm: true`.

| Operation | Required fields | Effect |
| --- | --- | --- |
| `issue_create` | `project`, `summary`, `confirm: true` | Creates an issue. `issueType` defaults to `Task`; accepts description, priority, labels, assignee account ID, parent key, and an optional `teamFieldId`/`teamId` pair. |
| `issue_update` | `issueKey`, one mutable field, `confirm: true` | Atomically updates summary, description, priority, labels, assignee, parent, or an optional `teamFieldId`/`teamId` pair. |
| `issue_transition` | `issueKey`, `transitionId` or `transitionName`, `confirm: true` | Performs an available transition. Name resolution is exact and refuses ambiguous results. |
| `comment_create` | `issueKey`, `comment`, `confirm: true` | Adds a plain-text comment. |

Descriptions and comments are converted into valid plain-text Atlassian Document Format (ADF). For richer structures, read the issue first and send an explicit update through a future ADF-specific operation; this initial surface deliberately avoids accepting unvalidated arbitrary documents.

Examples:

```text
read jira://PROJECT-123
read jira://PROJECT-123/transitions
read 'jira://search?jql=project%20%3D%20PROJECT%20AND%20status%20!%3D%20Done&limit=20'

jira(op="issue_transition", issueKey="PROJECT-123", transitionName="Done", confirm=true)
jira(op="issue_update", issueKey="PROJECT-123", labels=["platform", "retry"], confirm=true)
jira(op="issue_update", issueKey="PROJECT-123", teamFieldId="customfield_12345", teamId="<team-uuid>", confirm=true)
```

## Install

```sh
omp install github:brutaldeluxe82/omp-jira
```

Restart Oh My Pi after installing.

## Verification

```sh
bun test
bun run check
```
