# n8n-nodes-org21 — Developer Guide

Guide for developing, testing, and publishing the Org21 n8n community node package.

## Prerequisites

- Node.js >= 22
- npm
- Access to the [n8n-nodes-org21](https://github.com/Org21-ai/n8n-nodes-org21) GitHub repo

## Project Structure

```
n8n-nodes-org21/
├── credentials/
│   ├── Org21Api.credentials.ts                # Legacy n8n API-key credential (X-N8N-API-KEY)
│   ├── Org21KeycloakOAuth2Api.credentials.ts  # Keycloak OAuth2 client_credentials (extends oAuth2Api)
│   └── org21.svg                              # Icon for credentials panel
├── nodes/
│   └── FlowSniffer/
│       ├── FlowSniffer.node.ts     # Node logic (export class Formatter, displayed as "Org21-Observer")
│       ├── FlowSniffer.node.json   # Codex metadata (categories, aliases)
│       └── org21.svg               # Node icon
├── icons/
│   └── org21.svg                   # Source icon
├── dist/                           # Build output (do not edit directly)
├── package.json
├── tsconfig.json
└── DEVELOPER_GUIDE.md              # This file
```

## Setup (First Time)

```bash
git clone https://github.com/Org21-ai/n8n-nodes-org21.git
cd n8n-nodes-org21
npm install
```

## Build

```bash
npm run build
```

This compiles TypeScript to `dist/` and copies static files (icons, JSON).

To start fresh (recommended when things look stale):

```bash
rm -rf dist
npm run build
```

## Run Locally (Dev Mode)

```bash
npm run dev
```

This starts a local n8n instance at **http://localhost:5678** with the node auto-loaded. Changes to `.ts` files require restarting `npm run dev`.

The dev server stores its data in `~/.n8n-node-cli/.n8n/`.

## Making Changes

### Changing the node display name

Edit `nodes/FlowSniffer/FlowSniffer.node.ts`:
- `displayName` — what appears in the n8n node panel
- `defaults.name` — default label when dragging the node onto the canvas

**Do NOT change** the `name` field (currently `flowSniffer`) — this is the internal identifier. Changing it breaks existing workflows.

### Changing the icon

1. Place the new SVG file in `nodes/FlowSniffer/` (next to the `.ts` file)
2. The SVG must be clean: no `<!DOCTYPE>`, use `px` not `pt`, keep dimensions small (e.g., `width="60" height="60"`)
3. Update the `icon` field in `FlowSniffer.node.ts` if the filename changed: `icon: 'file:yourIcon.svg'`
4. Also place a copy in `credentials/` if you want the credentials panel to use the same icon

### Changing credentials

There are two credential types and they're independent:

- **`credentials/Org21Api.credentials.ts`** — credential `name` is `org21Api`. Plain API-key credential (`X-N8N-API-KEY`) for the legacy n8n-API trigger mode.
- **`credentials/Org21KeycloakOAuth2Api.credentials.ts`** — credential `name` is `org21KeycloakOAuth2Api`, `extends = ['oAuth2Api']`. The Keycloak path; n8n's OAuth2 framework handles the `client_credentials` token exchange and caching. The credential pre-fills `grantType`, `accessTokenUrl`, `authentication`, and `additionalBodyProperties` (for the `audience=api otel` body param) as `hidden` fields, exposing only `Keycloak URL`, `Realm`, `Client ID`, and `Client Secret` to the user.

Both credential `name`s are referenced in `nodes/FlowSniffer/FlowSniffer.node.ts` (in the `credentials` array on the node description and in the `httpRequestWithAuthentication.call` sites) — keep them in sync. They're also listed in `package.json` under `n8n.credentials`.

> Never call `httpRequest` after `getCredentials` in the same function — the `@n8n/community-nodes/no-http-request-with-manual-auth` lint rule flags it. Use `httpRequestWithAuthentication` instead, or extract any unauthenticated HTTP call into a top-level helper function (the rule is function-scoped). See `postWithoutAuth` in `FlowSniffer.node.ts` for the pattern.

### Adding or modifying Custom Fields

The "Custom Fields" feature uses a `fixedCollection` with `multipleValues: true`. Each field entry has:
- `name` (string) — the key
- `fieldType` (options) — determines how `value` is parsed: `string`, `number`, `boolean`, `array`, `object`, `binary`
- `value` (string) — supports expressions natively via n8n

Type coercion happens in the `execute()` method under the `// ── Custom fields` section. To add a new type:
1. Add a new option to the `fieldType` options array in the `properties` section
2. Add a `case` in the `switch (fieldType)` block in `execute()` to handle parsing

### Changing node behavior

All logic is in `nodes/FlowSniffer/FlowSniffer.node.ts` inside the `execute()` method.

## Lint

```bash
npm run lint        # Check for issues
npm run lint:fix    # Auto-fix issues
```

## Publishing to npm

### 1. Bump the version

Update `version` in `package.json` (follow semver):
- Patch (`0.1.4` → `0.1.5`): bug fixes, name changes
- Minor (`0.1.4` → `0.2.0`): new features
- Major (`0.1.4` → `1.0.0`): breaking changes

### 2. Build and publish

```bash
npm run publish:manual
```

This runs lint, builds, and publishes to npm with public access.

You must be logged into npm first:

```bash
npm login
```

### 3. Verify

Check the package page: https://www.npmjs.com/package/n8n-nodes-org21

### 4. Update in production n8n

In your production n8n instance:
1. Go to **Settings > Community Nodes**
2. Find `n8n-nodes-org21`
3. Click **Update** (if already installed) or **Install** (if new)

Or via CLI on the n8n server:

```bash
cd ~/.n8n/nodes
npm install n8n-nodes-org21@latest
# Restart n8n
```

## Git Workflow

```bash
# Make your changes
git add .
git commit -m "DEV-xxx: Description of changes"
git push origin main
```

Commit messages must include a Jira key (DEV-xxx) per SOC 2 compliance.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Icon not showing | Place SVG next to the node `.ts` file, use `icon: 'file:name.svg'` (no relative paths). Restart n8n + hard refresh (`Ctrl+Shift+R`). |
| Node not appearing | Check `package.json` → `n8n.nodes` points to the correct `dist/` path. Rebuild and restart. |
| Old version still showing | Delete `dist/`, rebuild, restart n8n. Clear browser cache. |
| npm publish fails | Run `npm login` first. Ensure `version` in `package.json` is incremented. |
| Legacy API-key credential not connecting | Verify the `test` section in `Org21Api.credentials.ts` has correct URL patterns. |
| Keycloak credential not connecting | Verify `Keycloak URL` + `Realm` resolve to a reachable `/realms/{realm}/protocol/openid-connect/token` endpoint and that the `Client ID` / `Client Secret` are valid client_credentials. n8n's oAuth2 framework reports the underlying error on first token fetch. |
