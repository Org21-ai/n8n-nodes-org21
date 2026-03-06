# @org21/n8n-nodes-org21

n8n community node that **sniffs workflow metadata, logs, timing, and errors** from any flow — then triggers a sub-flow via **webhook** or **n8n API**.

Use it for observability, auditing, debugging, or orchestrating complex multi-workflow pipelines.

## Installation

### Community Nodes (recommended)

1. Go to **Settings > Community Nodes** in your n8n instance
2. Select **Install a community node**
3. Enter `@org21/n8n-nodes-org21`
4. Agree to the risks and click **Install**

### Manual

```bash
cd ~/.n8n/nodes
npm install @org21/n8n-nodes-org21
```

## Nodes

### Flow Sniffer

Drop this node into any workflow to capture execution data and trigger a sub-flow.

#### What it captures

| Toggle | Data | Default |
|--------|------|---------|
| **Metadata** | Workflow ID/name, execution ID, node name, timestamp | On |
| **Item Data** | The actual JSON items passing through the node | On |
| **Timing** | Execution timing, input/output item counts | On |
| **Errors** | Error details from items with errors | On |

#### Trigger modes

- **Webhook POST** — POST sniffed data to any URL (typically a sub-flow's Webhook trigger)
- **n8n API** — Trigger a specific workflow via the n8n REST API (requires API key)

#### Options

- **Pass Through** — When enabled (default), original items pass through unchanged so the main flow continues normally. When disabled, the node outputs the sniffed payload instead.
- **Additional Headers** — Add custom HTTP headers to the trigger request.

## Credentials

### Org21 API (n8n API Key)

Required only when using **n8n API** trigger mode. Enter your n8n instance API key.

Generate one at: **Settings > API > Create API Key** in your n8n instance.

## Example use cases

1. **Audit trail** — Sniff every execution and POST to a logging sub-flow that writes to a database
2. **Error monitoring** — Capture errors and trigger an alerting workflow (Slack, email, PagerDuty)
3. **Pipeline orchestration** — Chain workflows together by sniffing completion data and triggering the next stage
4. **Cost tracking** — Capture execution metadata and aggregate it in a reporting workflow

## Compatibility

- n8n >= 1.0.0
- Node.js >= 22

## License

MIT
