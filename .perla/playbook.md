# Reviewer playbook — Org21-ai/n8n-nodes-org21

<!-- Condensed from 5 learning notes (2026-09-05 to 2026-10-06) by Claude; approved for use by Ofek, 2026-10-06.
     Only the perla-maintainers team (Ofek, Yoav) can land .perla/** (org push ruleset 24588193).
     Perla reads this from the BASE branch and treats it as trusted; edit accordingly. -->

## Dependabot reachability

- `package.json` has no runtime `dependencies` (only devDependencies and peerDependencies) and ships `"files": ["dist"]`; `grep -o 'require([^)]*)' dist/**/*.js` returns only `n8n-workflow`. So a lockfile bump can only reach the local build/release toolchain, never a consumer, and upstream CVE language describes code this package does not install for them. Check those two fields first, then the `"dev": true` / `"peer": true` flag per lock entry (`hasown` is peer-only) to say which dev tool is affected. ([#19](https://github.com/Org21-ai/n8n-nodes-org21/pull/19#pullrequestreview-5416024075), [#21](https://github.com/Org21-ai/n8n-nodes-org21/pull/21#pullrequestreview-5415575832))
- A Dependabot title can name one version line ("1.1.12 to 1.1.16") while the lock moves several majors of the same package side by side. Grep every `node_modules/.../<pkg>` entry rather than trusting the title or compare link, and confirm `entries x 3 lines == git diff --stat` to prove only version/resolved/integrity moved. ([#20](https://github.com/Org21-ai/n8n-nodes-org21/pull/20#pullrequestreview-5415991073))

## The vendored jira-check gate

- The vendored `jira-check` only started enforcing at 36604e0/8c423ac (PRs #23-#25, Aug 2026), its push handler exempts merges by parent count, and master history is all squash commits (one parent). Any bot PR, Dependabot especially (no DEV key by construction), therefore fails the required PR check and reddens master once squashed; the three earlier DEV-less Dependabot merges are not precedent. On any bot PR, check branch/title/body against the DEV regex and the merge strategy, even for a one-line lockfile bump. ([#26](https://github.com/Org21-ai/n8n-nodes-org21/pull/26#pullrequestreview-5415457767), [#27](https://github.com/Org21-ai/n8n-nodes-org21/pull/27#pullrequestreview-5415255907))
