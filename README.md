# n8n-nodes-org21

n8n custom community node package that sniffs workflow metadata, items, timing, and errors from any n8n flow and forwards them to an Org21 sub-flow (webhook or n8n REST API) for AI-spend observability and orchestration.

## What it does

The package ships one node — `Org21-Observer` (internal name `flowSniffer`, displayed under the **Miscellaneous** category) — that drops inline anywhere on an n8n canvas and:

1. Captures `workflow.{id,name,active}`, `executionId`, `node.{name,type}`, and an ISO timestamp via `IExecuteFunctions.getWorkflow()` / `getExecutionId()` / `getNode()`.
2. Captures the JSON payload of every input item, plus `inputItemCount` and `executionStartMs` timing, and any `item.error` records.
3. Allows free-form `customFields` (string / number / boolean / array(JSON) / object(JSON) / binary) merged into the payload.
4. Triggers a sub-flow in one of two modes:
   - **Webhook POST** (`triggerMode=webhook`) — `POST <Webhook URL>` with the assembled JSON payload.
   - **n8n API** (`triggerMode=n8nApi`) — `POST {baseUrl}/api/v1/workflows/{workflowId}/run`.
5. Adds `triggerDurationMs` after the sub-flow returns.
6. Emits original input items downstream by default (`passThrough=true`), so the Observer is non-invasive.

By default, the sub-flow it points at is the Org21 metric-ingest pipeline that converts each event into OTEL `AIModelPipeline` metric envelopes (DELTA temporality) and ships them to the Org21 backend for cost / token attribution.

## Where it fits

Per `architecture/PLATFORM_OVERVIEW.md`, n8n is the workflow-automation tier of the Org21 platform; this repo is the **Flow Sniffer / Custom Node** portion of that tier:

```
n8n Workflow Engine → Flow Sniffer (this repo) → Sub-flow → otel-collector → ingest-metrics
```

The Observer is what makes Org21 visibility "BYO" for n8n: any customer running n8n can `npm install n8n-nodes-org21` into their own instance, drop the node into existing workflows, and start emitting the same metric shape that the rest of the platform ingests from native AI-spend connectors (OpenAI, Anthropic, Vertex, Bedrock, etc.). DEV-226 splits each LLM event into the four-part `AIModelPipeline` series — input tokens, output tokens, cache-read tokens, cache-creation tokens — using DELTA temporality so the collector aggregates them server-side rather than fighting cumulative resets across n8n executions.

## Install (npm install in n8n custom dir)

End-user installation, on any self-hosted n8n instance:

```bash
# Recommended path — n8n's Community Nodes UI:
#   Settings → Community Nodes → Install a community node → "n8n-nodes-org21"

# Or from the n8n custom-nodes directory:
cd ~/.n8n/nodes
npm install n8n-nodes-org21
# then restart n8n
```

For end-to-end setup against an Org21 tenant (Keycloak realm, Key Service per-workflow secret, sub-flow URL), follow:

> https://github.com/Org21-ai/architecture/blob/main/guides/n8n-nodes-installation-guide.md

Compatibility: **n8n >= 1.0.0**, **Node.js >= 22**.

## Build & run (dev workflow)

```bash
git clone https://github.com/Org21-ai/n8n-nodes-org21.git
cd n8n-nodes-org21
npm install

npm run build         # n8n-node build → tsc + copy SVGs/JSON into dist/
npm run build:watch   # tsc --watch (no asset copy)
npm run dev           # n8n-node dev — local n8n at http://localhost:5678 with this node hot-loaded
npm run lint          # n8n-node lint
npm run lint:fix      # n8n-node lint --fix
```

Dev-mode n8n state lives in `~/.n8n-node-cli/.n8n/`. `tsconfig.json` targets `es2019`, `commonjs`, `strict: true`; build output is emitted to `dist/` (the only directory shipped to npm — see `"files": ["dist"]` in `package.json`).

Manual publish (when not relying on the tag-driven CI release):

```bash
npm run publish:manual   # = npm run lint && npm run build && npm publish --access public
```

## Configuration (n8n credentials, OTEL endpoint)

The node ships two credential types and a node-level `Authentication` selector that picks between them (or none):

| Node `authMethod`        | Credential type (n8n name)                                              | Defined in                                                | Used by                                                                                |
| ------------------------ | ----------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `none` *(default)*       | —                                                                       | —                                                         | Unauthenticated webhook POST. Useful for fire-and-forget local sub-flows.              |
| `keycloak`               | **`Org21 Keycloak OAuth2 API`** (`org21KeycloakOAuth2Api`, extends `oAuth2Api`) | `credentials/Org21KeycloakOAuth2Api.credentials.ts`       | Webhook mode against the Org21 OTEL ingestion path. OAuth2 `client_credentials` flow.  |
| `apiKey` *(legacy)*      | **`Org21 Legacy API`** (`org21Api`)                                     | `credentials/Org21Api.credentials.ts`                     | n8n API trigger mode against a self-hosted n8n; not for Org21 metric ingest.           |

The Keycloak token exchange is delegated entirely to n8n's built-in oAuth2 framework via `httpRequestWithAuthentication` — n8n handles token fetch, caching, refresh, and audit logging. The credential pre-fills the standard `oAuth2Api` fields:

- `grantType: 'clientCredentials'`
- `accessTokenUrl` computed from `Keycloak URL` + `Realm`: `{keycloakUrl}/realms/{realm}/protocol/openid-connect/token`
- `authentication: 'body'` (Keycloak prefers form-body client auth)
- `sendAdditionalBodyProperties: true` with `additionalBodyProperties: '{"audience":"api otel"}'` — the same audience scoping the previous inline implementation used. n8n forwards this to `client-oauth2` (see `n8n-core/dist/execution-engine/.../request-helper-functions.js::createOAuth2Client`).

Outgoing requests get `Authorization: Bearer <jwt>` (auto-injected by n8n) and `X-Org21-Source: formatter` (added by the node). User-facing fields on the credential are just `Keycloak URL`, `Realm` (default `org21`), `Client ID`, and `Client Secret`.

`Client ID` / `Client Secret` are issued per-workflow by the Org21 **Key Service** (placeholder shown in the credential UI: `sa-acme-corp__my-workflow`), so a leaked secret only blasts a single workflow. The OAuth2 token has `aud=metric-ingest` (also `api`) so the `otel-collector` accepts it on the metric-ingest path; the alternative static `sk_otel_s1_*` bearer (via `otel-auth-proxy`) is not used here — n8n always uses OAuth2 client_credentials.

The legacy API-key credential test pings `GET {baseUrl}/api/v1/workflows`. The Keycloak credential is validated implicitly by n8n's oAuth2 framework on first token fetch.

The **OTEL endpoint** itself is not configured on the node — it is the Webhook URL, which by convention points at a sub-flow that forwards into the Org21 collector. The collector authenticates the Bearer the Observer attaches.

> **Migration from 0.1.x.** The pre-0.2.0 `org21Api` credential carried both auth modes inside an `Auth Method` field on the credential itself, with hand-rolled Keycloak token exchange in the node. After 0.2.0, the Keycloak fields are gone from `org21Api`; existing Keycloak users must create a new `Org21 Keycloak OAuth2 API` credential, re-enter `Keycloak URL` / `Realm` / `Client ID` / `Client Secret`, and pick `Authentication: Keycloak (OAuth2)` on the node.

## Public surface (nodes published, parameters)

`package.json` declares:

```json
"n8n": {
  "n8nNodesApiVersion": 1,
  "strict": true,
  "credentials": [
    "dist/credentials/Org21Api.credentials.js",
    "dist/credentials/Org21KeycloakOAuth2Api.credentials.js"
  ],
  "nodes":       ["dist/nodes/FlowSniffer/FlowSniffer.node.js"]
}
```

So the package publishes exactly **one node** and **two credentials**.

### Node: `Org21-Observer` (`flowSniffer`)

- `inputs`: `[Main]`
- `outputs`: `[Main]`
- `usableAsTool`: `true` (selectable from AI Agent / Tools nodes)
- `credentials`: conditional on `authMethod` — `org21KeycloakOAuth2Api` when `keycloak`, `org21Api` when `apiKey`, none when `none`

Parameters (full list, in declaration order):

| Parameter            | Type                          | Default     | Notes                                                                                                                |
| -------------------- | ----------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------- |
| `authMethod`         | options                       | `none`      | `none` \| `keycloak` \| `apiKey` — gates which credential slot the node shows                                        |
| `triggerMode`        | options                       | `webhook`   | `webhook` \| `n8nApi` (`n8nApi` requires `authMethod=apiKey` for the `baseUrl`)                                      |
| `webhookUrl`         | string (required)             | —           | Shown only when `triggerMode=webhook`                                                                                |
| `workflowId`         | string (required)             | —           | Shown only when `triggerMode=n8nApi`                                                                                 |
| `includeMetadata`    | boolean                       | `true`      | Workflow + execution + node + timestamp                                                                              |
| `includeItemData`    | boolean                       | `true`      | Raw `item.json` for every input item                                                                                 |
| `includeTiming`      | boolean                       | `true`      | `sniffedAt`, `inputItemCount`, `executionStartMs`, `triggerDurationMs`                                               |
| `includeErrors`      | boolean                       | `true`      | Per-item `{itemIndex, error}` pulled from `item.error`                                                               |
| `passThrough`        | boolean                       | `true`      | Return original `items` unchanged (otherwise output the sniffed payload)                                             |
| `customFields`       | fixedCollection (multiValues) | `{}`        | `{name, fieldType, value}` × N — types: `string`/`number`/`boolean`/`array`/`object`/`binary`                        |
| `additionalHeaders`  | fixedCollection (multiValues) | `{}`        | `{name, value}` headers added to outbound HTTP                                                                       |

Outbound payload shape (any subset, depending on toggles):

```json
{
  "metadata":     { "workflowId", "workflowName", "workflowActive", "executionId", "nodeName", "nodeType", "timestamp" },
  "items":        [ /* item.json[] */ ],
  "timing":       { "sniffedAt", "inputItemCount", "executionStartMs", "triggerDurationMs" },
  "errors":       [ { "itemIndex", "error": { "message", "name" } } ],
  "customFields": { /* user-defined */ }
}
```

Outbound headers (always): `Content-Type: application/json`, `X-Org21-Source: formatter`. Plus `Authorization: Bearer <jwt>` when Keycloak auth is configured, or `X-N8N-API-KEY` for legacy API-key mode.

### Codex metadata (`FlowSniffer.node.json`)

```
node:        n8n-nodes-org21.flowSniffer
categories:  ["Miscellaneous"]
aliases:     ["formatter", "metadata", "logs", "observability", "monitor", "trigger", "sub-flow", "org21"]
```

### OTEL emission shape

The Observer itself emits a generic JSON envelope (above). The downstream sub-flow is what materializes the Org21-canonical OTEL shape:

- **Instrumentation scope**: `AIModelPipeline`
- **Aggregation temporality**: **DELTA** (per-execution increments — the collector handles roll-up)
- **Per-event split (DEV-226)**: every LLM call becomes **four** metric points on the same series, distinguished by attributes:
  1. `input_tokens`
  2. `output_tokens`
  3. `cache_read_input_tokens`
  4. `cache_creation_input_tokens`
- Authenticated as a Keycloak service account with `aud=metric-ingest`.

## Layout

```
n8n-nodes-org21/
├── credentials/
│   ├── Org21Api.credentials.ts                Legacy n8n API-key credential
│   ├── Org21KeycloakOAuth2Api.credentials.ts  Keycloak OAuth2 client_credentials (extends oAuth2Api)
│   └── org21.svg
├── nodes/
│   └── FlowSniffer/
│       ├── FlowSniffer.node.ts   Node logic (export class Formatter)
│       ├── FlowSniffer.node.json Codex metadata
│       └── org21.svg
├── icons/org21.svg               Source icon
├── docs/git-scanner.md
├── templates/                    Reference n8n workflow JSONs
│   ├── 01-slack-error-alerts.json
│   ├── 02-weekly-timing-digest.json
│   ├── 03-auto-jira-on-failure.json
│   └── README.md
├── dist/                         Build output (shipped to npm)
├── .github/workflows/
│   ├── release.yml               Tag-triggered npm publish (v*)
│   └── jira-check.yml            Reuses Org21-ai/pipelines/.github/workflows/jira-check.yml@main
├── DEVELOPER_GUIDE.md            Detailed dev / publish runbook
├── package.json                  n8n-node CLI scripts; declares the node + credential paths
├── tsconfig.json                 strict, es2019, commonjs, outDir=./dist
├── eslint.config.mjs
└── .npmrc                        @org21:registry=https://registry.npmjs.org/
```

## Tests

There is no automated test suite in this repo. Pre-publish validation is:

- `npm run lint` — `n8n-node lint` (catches the n8n community-node ruleset).
- `npm run dev` — interactive smoke test in a local n8n at `http://localhost:5678`.
- The reference workflow JSONs in `templates/` (`01-slack-error-alerts.json`, `02-weekly-timing-digest.json`, `03-auto-jira-on-failure.json`) are the manual end-to-end fixtures — import each into a clean n8n, configure credentials, and verify the sub-flow fires.

CI runs `npm ci && npm run build && npm run lint` on `v*` tag pushes (`.github/workflows/release.yml`), then `npm publish --provenance --access public`.

## Conventions

- **Trunk-based development** — commit straight to `main`, no feature branches or PRs.
- **Jira-tagged commits** — every commit message must reference a `DEV-xxx` key (SOC 2). Enforced in CI by `Org21-ai/pipelines/.github/workflows/jira-check.yml@main` on push and PR.
- **Don't rename `name: 'flowSniffer'`** — that's the persisted node identifier; renaming it breaks every existing workflow that uses the Observer. Change `displayName` and `defaults.name` if you need to rebrand. (See `DEVELOPER_GUIDE.md`.)
- **Versioning** — semver in `package.json`. Tag `vX.Y.Z` to trigger the npm publish workflow.
- **Icons** — clean SVGs (no `<!DOCTYPE>`, `px` not `pt`), placed alongside the `.ts` file and referenced via `icon: 'file:org21.svg'`.
- **`dist/` is the only published artifact** (`"files": ["dist"]`).
- **Auth defaults to `none` on the node** — production deployments must explicitly pick `Keycloak (OAuth2)` and attach an `Org21 Keycloak OAuth2 API` credential with a per-workflow Key Service secret. The legacy n8n API key is reserved for self-hosted-n8n trigger mode and is not for Org21 metric ingest.
- **Always use `https://auth.org21.ai`** as the Keycloak issuer (public hostname) when validating Bearers downstream — even from inside the cluster.

## Related

- `Org21-ai/architecture` — `PLATFORM_OVERVIEW.md` (Flow Sniffer placement in the n8n tier), chapter 02 (data-plane / OTEL), `guides/n8n-nodes-installation-guide.md` (end-user setup).
- `Org21-ai/pipelines` — reusable `standard-ci.yml` and `jira-check.yml` workflows; this repo only consumes `jira-check.yml`.
- `Org21-ai/otel-collector`, `otel-auth-proxy` — receive the metrics this node emits; honor `aud=metric-ingest` Keycloak JWTs.
- `Org21-ai/ingest-metrics`, `Org21-ai/query-platform` — downstream of the collector; convert Observer events into the AI-spend metric model.
- `Org21-ai/architecture/CICD_new_repo.md` — repo-bootstrapping conventions referenced by this package's CI.
- npm: https://www.npmjs.com/package/n8n-nodes-org21
- GitHub: https://github.com/Org21-ai/n8n-nodes-org21
