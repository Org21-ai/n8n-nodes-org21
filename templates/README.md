# Workflow templates

Exported n8n workflow JSONs that showcase the **Org21-Observer** node (published as `n8n-nodes-org21`). Templates mirror what's published under the `@ofekdekel` account in the [n8n template gallery](https://n8n.io/workflows/).

## Templates

| # | File | Summary |
|---|------|---------|
| 1 | `01-slack-error-alerts.json` | Drop Observer inline; sub-flow posts rich error context to Slack. |
| 2 | `02-weekly-timing-digest.json` | Ingest Observer events to Postgres; Monday cron posts top-10 slowest nodes (7-day avg) to Slack. Includes the `CREATE TABLE` DDL in a sticky note. |
| 3 | `03-auto-jira-on-failure.json` | Observer errors → Jira issue with full workflow/node/error context + Slack notification. Includes dedupe strategy + PII redaction guidance stickies. |

## Importing locally

1. In n8n, click **Workflows → New → ⋯ → Import from File**.
2. Select the JSON.
3. Configure credentials (none are baked into the JSON — that's deliberate).
4. Copy the sub-flow webhook URL into the Observer's `Webhook URL` field.
5. Execute.

## Publishing to the n8n gallery

1. Import the JSON into a clean n8n instance.
2. Verify it runs end-to-end without leaking any credentials back into the node params.
3. Re-export via **Canvas → ⋯ → Download**.
4. Submit at https://n8n.io/creators/ with a markdown description using `##` H2 headings (n8n's guideline — no HTML tags).
5. When n8n approves the template, add the gallery URL to the table above.

## Guidelines (from the n8n submission page)

- **Sticky notes are mandatory** — explain inputs, the Observer, and the sub-flow.
- **No hardcoded API keys** — every credential must come from n8n's Credentials store.
- **Markdown only** in the description (no `<html>` tags).
- **Original work** — templates that copy someone else's workflow get the account banned.
