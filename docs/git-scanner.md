# Org21 Git Scanner

Scan your GitHub or GitLab organization to discover services, features, and code ownership — then upload the results to the Org21 platform for automatic knowledge-graph enrichment.

Supports **GitHub**, **GitHub Enterprise**, **GitLab.com**, and **self-hosted GitLab**.

---

## What the scanner reads (and does not read)

The scanner reads **repository metadata only**. It never opens, stores, or transmits source-code content.

| Category | What we read | Why |
|---|---|---|
| Repository | Name, description, primary language, last-push date | Identify your services |
| README | First heading and first paragraph only | Give services a human name |
| Sub-modules | Presence of build files (`package.json`, `pyproject.toml`, `pom.xml`, …) | Identify features within a service |
| Directory tree | Names of top-level directories and file extension counts | Classify services (IaC, deployment, application) |
| Contributors | Login, display name, commit count, **email** (where visible on the Git side) | Code-ownership signal + identity bridging across Jira / HR / Git |
| Collaborators | Permission level (admin, write, read) | Strongest ownership signal |
| CODEOWNERS | File pattern → owner mapping | Explicit ownership declarations |
| First commit author | Login | Proxy for repo creator |
| AI SDK usage | Keyword presence in code search (OpenAI / Anthropic / LangChain / Gemini / …) | AI-stack discovery |
| Visibility | Private, public, or (GitLab) internal | Privacy-aware downstream processing |
| Archived status | Boolean | Track inactive services |

No file content, no commit diffs, no secrets, no issues, no PRs are read.

---

## Privacy and security

- **Runs on your machine** — the scanner is a local Python CLI; metadata is gathered and the output JSON is written to your own filesystem.
- **Nothing leaves your machine during the scan** — Org21 only sees the metadata **after you choose to upload the JSON** to the dashboard.
- **Read-only credentials** — no write, delete, or admin-action permissions are required.
- **Credentials stay local** — tokens/passwords are never sent to Org21.
- **Revocable** — delete the token (or change the password) to revoke access instantly.
- **Basic-auth supported** — for environments that restrict token creation (e.g. self-hosted GitLab with LDAP).
- **Self-hosted GitLab** — scanner runs entirely inside your network when pointed at an internal `--url`.
- **Dry-run mode** — pass `--debug` to generate the JSON and have Org21 ingest it *without* publishing to the knowledge graph, so you can preview exactly what we'd learn before you commit.

The scanner is open to review. You can read what it does by inspecting the JSON it writes before uploading.

---

## Quick start

### 1. Install

```bash
pip install --upgrade org21-git-scan
```

Python 3.9+. Use `--upgrade` so you pick up the latest diagnostic logging and GitLab fixes.

> **Windows / PowerShell:** if `org21-git-scan` returns *command not found*, your Python `Scripts` directory isn't on `PATH`. Find the exe with `pip show -f org21-git-scan` and either call it by full path or add `Scripts` to `PATH`.

### 2. Create an access token

Choose the path for your Git provider. Read-only is enough in every case.

**GitHub — classic personal access token (simplest):**

1. Go to <https://github.com/settings/tokens> → **Generate new token (classic)**.
2. Tick exactly two scopes: `repo` and `read:org`.
3. Click **Generate** and copy the `ghp_…` string.
4. **If your organization enforces SAML SSO**, click **Configure SSO** next to the new token on the token list page and authorize it for your organization. Without this step the scanner gets `401 Unauthorized`.

**GitHub — fine-grained personal access token (tighter scoping):**

1. <https://github.com/settings/personal-access-tokens/new>.
2. **Resource owner** → your organization. **Repository access** → All repositories.
3. Grant **Read-only** on: Contents, Metadata, Administration, Pull requests.
4. Grant **Read-only** on: Organization → Members.
5. Generate. If SSO-enforced, authorize the token for your org via the button that appears.

Fine-grained tokens may require organization-admin approval before they become active.

**GitLab — group access token (recommended for GitLab):**

1. Your group → **Settings → Access Tokens**.
2. Role: **Reporter**. Scopes (all read-only): Repository read, Group read, Member read, Global Search read.
3. Generate and copy the `glpat_…` string.

Group access tokens are preferred because they skip the SAML session-establishment step that personal access tokens need on SSO-enforced GitLab groups.

**GitLab.com or self-hosted — personal access token:**

1. <https://gitlab.com/-/user_settings/personal_access_tokens> (or your instance URL).
2. Scopes: `read_api`, `read_repository`.
3. If your GitLab group enforces SAML, visit the group once in a browser **before** scanning to establish the SSO session.

**Sanity-check your token before scanning:**

```bash
# Does the token work at all?
curl -H "Authorization: Bearer $TOKEN" https://api.github.com/user

# Does it see your org?
curl -H "Authorization: Bearer $TOKEN" https://api.github.com/orgs/YourOrgName
```

If the first succeeds but the second returns 404, the token needs SSO authorization (see above).

### 3. Run the scanner

```bash
# GitHub with token
org21-git-scan --provider github --org YourOrgName --token ghp_your_token

# GitHub Enterprise with username/password
org21-git-scan --provider github --org YourOrgName \
  --username your_user --password your_pass

# GitLab.com with token
org21-git-scan --provider gitlab --org YourGroupName --token glpat_your_token

# Self-hosted GitLab with token
org21-git-scan --provider gitlab --org YourGroupName \
  --token glpat_your_token --url https://gitlab.internal.company.com

# Preview only — generate JSON, ingest for review, do NOT publish to the graph
org21-git-scan --provider github --org YourOrgName --debug
```

The scan produces a `git-metadata.json` file in your current directory. Typical duration is 2–3 minutes for a 50-repo organization.

Environment variables also work: `GITHUB_TOKEN`, `GITLAB_TOKEN`, `GIT_USERNAME`, `GIT_PASSWORD`.

### 4. Upload to Org21

1. Log in to your Org21 dashboard.
2. **Settings → Integrations → Git**.
3. Click **Upload Scan Results**.
4. Select your `git-metadata.json`.

Services, features, and ownership appear in the knowledge graph within minutes.

---

## Options

| Flag | Purpose |
|---|---|
| `--provider {github,gitlab}` | Git provider, defaults to `github`. |
| `--org ORG` | Organization or group name. Required. |
| `--token TOKEN` | Access token. Or set `GITHUB_TOKEN` / `GITLAB_TOKEN`. |
| `--username USER` + `--password PASS` | Basic auth alternative (GitHub Enterprise, self-hosted GitLab). Or set `GIT_USERNAME` / `GIT_PASSWORD`. |
| `--url URL` | Self-hosted GitLab base URL. |
| `--output, -o OUTPUT` | Output file path. Defaults to `git-metadata.json`. |
| `--max-repos N` | Cap the number of repos scanned. Defaults to 100. |
| `--verbose` | Detailed progress log. |
| `--debug` | Dry-run: mark the output JSON as debug so the Org21 pipeline analyzes but does not publish to the knowledge graph. |
| `--bot-patterns PATTERNS` | Comma-separated case-insensitive regexes of bot logins to filter out of contributors, collaborators, CODEOWNERS, and first-commit author. A curated default list covers Dependabot, Renovate, GitHub Actions, semantic-release, and typical `[bot]` suffixes. Pass `--bot-patterns ''` to disable filtering. |

---

## Output format

```json
{
  "org": "YourOrgName",
  "provider": "github",
  "scanned_at": "2026-04-20T10:30:00Z",
  "repos": [
    {
      "name": "auth-service",
      "description": "Authentication and authorization service",
      "readme_heading": "Auth Service",
      "readme_summary": "Multi-tenant authentication with OAuth2, PKCE, and session management.",
      "language": "Python",
      "languages": { "Python": 45000, "Shell": 2000 },
      "file_extensions": { ".py": 120, ".yaml": 15, ".md": 8 },
      "last_push": "2026-04-07T15:30:00Z",
      "visibility": "private",
      "archived": false,
      "contributors": [
        { "login": "alice", "name": "Alice Smith", "commits": 142, "email": "alice@company.com" }
      ],
      "collaborators": [
        { "login": "alice", "name": "Alice Smith", "permission": "admin" }
      ],
      "codeowners": [
        { "pattern": "/src/oauth/", "owners": ["@alice", "@bob"] }
      ],
      "sub_modules": [
        { "path": "api-gateway", "name": "api-gateway", "build_file": "package.json" }
      ],
      "created_by": "alice",
      "admins": ["alice"],
      "uses_ai": true,
      "ai_references": ["openai", "langchain"]
    }
  ]
}
```

---

## How Org21 uses the data

| Input from the scan | Where it surfaces in the knowledge graph |
|---|---|
| Repositories | **Services** with human-readable names |
| Sub-modules and domain directories | **Features** within services |
| Contributors, CODEOWNERS, admins | **Ownership** — who owns which service |
| Contributor emails | **Identity bridging** across Jira, Git, and HR |
| File extensions | Service classification (application vs. IaC vs. deployment) |
| AI references | AI-stack discovery (which services use which AI SDKs) |

This data cross-references with other connectors (Jira, HiBob, NetSuite) to build a complete picture of your technology landscape.

---

## Scheduling

```bash
# Daily at 02:00 via cron
0 2 * * * GITHUB_TOKEN=ghp_xxx org21-git-scan --provider github --org YourOrg \
  -o /path/to/git-metadata.json
```

Re-upload the generated file to the dashboard after each scheduled scan, or wire the upload step into your pipeline.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `Error: Access token required` | Set `--token` or the matching env var. |
| `401 Unauthorized` on the first org or group call | Token expired, revoked, or not SSO-authorized. For GitHub click **Configure SSO** next to the token. For GitLab open the group once in a browser to establish the SSO session. Group access tokens avoid this step entirely. |
| `403 Forbidden` | Token scope gap. Re-check that you granted every scope listed under step 2 above. GitLab often means `read_repository` is missing. |
| `404 Not Found` on some fields | Expected for repos without CODEOWNERS or a README — harmless. |
| Many `api_call_failed context=<repo>/<field> error=status=403` lines | Scope gap; the message names the failing endpoint. Grant the matching permission and rerun. |
| `Rate limit exceeded` | Wait and retry, or use a token with higher limits. |
| Self-hosted GitLab SSL error | Make sure your GitLab URL uses a valid certificate. |
| `command not found` / `not recognized` on Windows | Python `Scripts` folder isn't on `PATH`. `pip show -f org21-git-scan` will print the location of `org21-git-scan.exe`. |
| PowerShell: `Missing expression after unary operator '--'` | A bash-style `\` line continuation was used. PowerShell uses backtick `` ` `` for line continuation — or keep the whole command on one line. |

---

## Support

For anything unexpected, reach out at <support@org21.ai> with the relevant log lines and your `git-metadata.json` (feel free to redact before sending).
