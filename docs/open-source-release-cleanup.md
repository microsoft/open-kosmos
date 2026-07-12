# Open-Source Release Cleanup Record

**Status:** Repository-controlled gates passed; external approvals and publication controls pending
**Inventory snapshot:** 2026-07-11
**Target:** Public open-source release

**Repository gate owner:** Integration branch

The 2026-07-11 baseline contains 134 checkboxes. Each checkbox is mapped below to a
repository-controlled gate or an explicitly pending external/manual control. A checked
box must cite durable evidence; merging source changes alone is not evidence for
infrastructure decommissioning, credential rotation, legal approval, or release sign-off.

### Baseline evidence

| Evidence ID | Command or inspection | Result |
|---|---|---|
| `EV-BASE-01-UNIT` | `npm test` | PASS: 1,334 files; 31,103 tests passed; 2 skipped |
| `EV-BASE-02-TYPECHECK` | `npm run typecheck` | PASS |
| `EV-BASE-03-BUILD` | `npm run build:vite` | PASS |
| `EV-BASE-04-STATIC` | `npm run check:public-release` | Expected FAIL: 10,832 unreviewed matches, 27 removed paths, and 6 missing public-policy files |
| `EV-BASE-05-REFS` | `npm run audit:public-release:refs` | 17 refs require external review; this audit is non-blocking for repository-controlled status |
| `EV-FINAL-01-REPOSITORY` | Final integration harness with E2E and artifacts | PASS: all `G1` through repository-controlled `G5` checks; 243 changed source files meet diff coverage; 33 E2E tests pass; packaged text scan has zero findings |
| `EV-FINAL-ASAR-CONTENTS` | Extracted `app.asar` content scan | PASS: 5,954 files scanned with zero unreviewed matches |
| `EV-FINAL-REFS` | `npm run audit:public-release:refs` | 18 refs require external owner review/deletion; repository-controlled status remains PASS |

The static baseline failures are cleanup work, not reviewed exclusions.

## Purpose

This record defines repository content that must be removed, replaced, or independently reviewed before publishing the project. It covers source code, tests, fixtures, documentation, configuration, build and release automation, persisted-data contracts, generated assets, Git references, and Git history.

In this document, **end to end** means the complete feature path, not only Playwright E2E tests:

`UI -> renderer state -> preload/IPC -> main-process service -> remote endpoint/runtime -> cache or persistence -> update path -> tests and documentation`

Deleting only a visible entry point or remote fetcher is not sufficient.

### Scope boundary

The cleanup scope includes privately operated Microsoft/Kosmos endpoints, all Azure-hosted product infrastructure, Azure service integrations, Microsoft 365 tenant-data APIs, hard-coded tenant/organization/repository targets, embedded service credentials or resource identifiers, and the complete local feature path that exposes them.

The following are explicitly excluded from removal:

- GitHub Copilot authentication, model discovery, and inference APIs.
- Microsoft services that are publicly available at no cost, such as Bing web/image search, Microsoft Edge downloads, public Microsoft documentation, and public build tooling.
- Provider-neutral protocol support that can be used without Microsoft-owned infrastructure, including generic MCP OAuth and user-configured HTTP MCP servers.
- Public GitHub functionality and user-configured GitHub repositories.
- The README team section, including approved team-member names, roles, and contact information.

An excluded public API is still in scope when the repository hard-codes a private tenant, private repository, internal client registration, internal endpoint, or internal credential broker on top of it.

### Confirmed removal decisions

- Remove Doctor end to end because its issue-submission flow depends on the Azure-hosted relay and its implementation is coupled to internal diagnostics and repository infrastructure. Do not retain a reduced Doctor implementation in this release.
- Remove CDN-backed Agent, Skill, and MCP catalogs end to end. Do not retain dormant fetchers, configurable URL support, optional marketplace behavior, or local example catalogs that preserve the remote product contract.
- Remove Azure Bot and Remote Channel end to end. Do not retain a provider-neutral or user-configurable relay mode in this release.
- Preserve the README team-member introduction. This approved public attribution is not an internal-identity cleanup target.

### Endpoint classification

| Classification | Endpoint or capability families | Required treatment |
|---|---|---|
| Remove | `cdn.kosmos-ai.com`, Kosmos `azurewebsites.net` relays, Azure OpenAI presets, Application Insights resources | Delete all consumers and configuration; decommission or rotate infrastructure |
| Remove | Microsoft Graph, Teams chatsvc/CSA/Skype, Substrate, Outlook, SharePoint, Azure DevOps, Microsoft tenant login/token flows | Delete complete feature, authentication, persistence, UI, test, and documentation paths |
| Remove | Doctor, hard-coded private GitHub repositories, and relay-issued GitHub tokens | Delete the complete Doctor feature and its private issue-submission path |
| Remove | CDN, Agent/Skill/MCP Libraries, Azure Bot, and Remote Channel | Delete end to end; do not preserve configurable or dormant variants |
| Retain | GitHub Copilot authentication and model APIs | Preserve and regression-test |
| Retain | Public no-cost Microsoft services such as Bing search, Edge downloads, public documentation, and public build tooling | Preserve unless bundled with private credentials or internal defaults |
| Retain | Generic MCP HTTP/OAuth support and user-configured public GitHub integration | Preserve without Microsoft-specific defaults, fixtures, or registrations |
| Retain | README team-member introduction | Preserve approved names, roles, and contact information |
| Review | `www.kosmos-ai.com` public website links | Retain only after product/legal confirms the public site and content are suitable for the open-source project |

## Release Gate

The public release is blocked until all workstreams below are complete and the final audit confirms:

- No PM Studio branding, assets, configuration, routes, strings, tests, documentation, branches, tags, or release artifacts remain.
- No tool or runtime path can access Microsoft-internal or tenant data.
- No application path depends on Kosmos Azure App Services, Azure OpenAI, Azure CLI, Application Insights, internal SharePoint, internal Teams relay infrastructure, or private GitHub repositories.
- No Doctor, Azure Bot, Remote Channel, CDN, or remote Agent/Skill/MCP catalog implementation remains, including optional or user-configurable variants.
- No remote Agent/Skill/MCP browse, install, search, or update path remains.
- No runtime code, prompt, UI, test, script, or document accesses `cdn.kosmos-ai.com`.
- The application still supports local Agent, Skill, and MCP creation, import, configuration, persistence, and execution where those capabilities do not depend on removed services.
- A clean clone builds and tests without internal credentials, Microsoft tenant access, Agency CLI, or Kosmos CDN access.

## 1. PM Studio Brand and Git References

### Known repository content

The active brand configuration is already Kosmos-only (`scripts/brand-config.js`, `brands/kosmos/`, and `src/shared/constants/branding.ts`), but stale PM Studio references remain:

- `docs/i18n-prd.md`
- `docs/i18n-tech-doc.md`
- `src/renderer/lib/i18n/locales/en/enPart4.ts`
- `src/renderer/lib/i18n/locales/zh-CN/zhCNPart4.ts`
- `src/renderer/components/layout/__tests__/WindowsTitleBar.supplemental.test.tsx`

### Known Git branches

The 2026-07-11 inventory found these local or remote references:

- `user/yanhu/task-pm-studio-only`
- `yanhu-microsoft-cleanup-pm-studio-release`
- `origin/jinghuama-microsoft-pm-studio-fre-prototype-ref`
- `origin/user/jianliwei/pm-studio-disable-toolbar`
- `origin/user/jianliwei/pm-studio-icon`
- `origin/user/luna/fix-pm-studio-create-agent-defaults`
- `origin/user/luna/fix-pm-studio-default-tools`
- `origin/user/luna/pm-studio-remove-interactive-card`
- `origin/user/yanhu/task-pm-studio-only`
- `origin/user/yueyingchen/pm-studio-default-model`
- `origin/yanhu-microsoft-cleanup-pm-studio-release`

This list is a snapshot, not a permanent allowlist. Repeat the branch and tag inventory immediately before publication.

### Required actions

- [x] Remove stale PM Studio strings, translation keys, tests, documentation, screenshots, icons, package metadata, and generated artifacts.
- [x] Remove PM Studio-specific conditionals and configuration rather than leaving dead brand branches.
- [ ] Delete PM Studio branches and tags from the publication remote after required archival approval.
- [ ] Review pull-request refs, release attachments, Actions artifacts, package registries, and cached documentation for PM Studio content.
- [ ] Re-run case-insensitive searches for `pm studio`, `pm-studio`, `pm_studio`, and `pmstudio` across the final worktree, branches, tags, and published artifacts.

## 2. Microsoft Tenant Data, Authentication, and Agency CLI

### Data-access implementation

Treat the following as one removal boundary:

- `src/main/lib/microsoftGraph/` and its tests and module documentation.
- `src/main/lib/teams/TeamsIPC.ts`, its tests, and `src/shared/ipc/teams.ts`.
- Microsoft-data built-in tools under `src/main/lib/mcpRuntime/builtinTools/`, including Teams chat/channel/calendar, Outlook mail, SharePoint search/read, meeting transcript, Teams image download, user/org lookup, and Azure DevOps work-item tools.
- Tool registration, definitions, routing, prompt text, and parity tests in `builtinToolsManager.ts`, `teamsAndOutlookToolDefinitions.ts`, `azureToolDefinitions.ts`, `globalSystemPrompt.ts`, and their tests.
- Authentication, token cache, refresh, browser-session extraction, browser-profile leasing, Microsoft settings, and consent UI that exist only to support removed Microsoft data paths.
- App-level Microsoft persistence in `src/main/lib/userDataADO/types/app.ts` and `appCacheManager.ts`, including `MicrosoftConfig`, `browser-teams`, `azure-ad-app`, `graphClientId`, and `alwaysAllowM365AuthRequest`.
- Microsoft alias conversion in `src/main/lib/auth/aliasUtils.ts` and its callers/tests.
- Python broker/bootstrap support under `resources/microsoftGraph/`.
- Teams image protocol registration, Teams/Outlook link handling, and startup wiring in `src/main/main.ts`.
- Preload/IPC surfaces in `src/preload/main.ts`, `src/preload/teams/`, `src/shared/ipc/teams.ts`, and startup IPC registration.
- SharePoint document materialization in `src/main/startup/ipc/index.ts`, the `sharepoint:writeDocuments` preload API, generated `.sharepoint.md` files, and related tests.
- Renderer Microsoft settings, Teams chat selectors, workspace providers, styles, routes, localization, and tests.
- Teams/Outlook briefing and scheduler integration in:
  - `src/renderer/lib/chat/teamsScheduleSync.ts`
  - `src/renderer/components/chat/agent-editor/useScheduleTeamsPrefetch.ts`
  - `src/renderer/components/chat/agent-editor/BriefingSourcesSection.tsx`
  - `src/renderer/components/chat/agent-editor/AddScheduleOverlay.tsx`
  - `.github/prompts/catch-me-up-project-briefs.prompt.md`
  - `.github/prompts/connect-teams-outlook-and-schedule-briefs.prompt.md`
- Eval Case SharePoint submission, including the hard-coded Microsoft alias and shared-folder URL:
  - `src/main/lib/evalCase/`
  - `src/main/startup/ipc/eval-case.ts`
  - `src/shared/ipc/evalCase.ts`
  - `src/shared/types/evalCaseTypes.ts`
  - `src/preload/evalCase/`
  - `src/renderer/ipc/evalCase.ts`
  - `src/renderer/components/chat/EvalCaseSubmit*`
- Internal endpoint examples such as `edge-growth-brain-staging.azurewebsites.net` and `api.microsoft.ai` in MCP OAuth/config tests and documentation.
- Microsoft-specific dependencies and packaging rules that become unused after removal, including MSAL packages.

The Graph module reaches both documented Microsoft Graph endpoints and Teams-internal endpoints, including chatsvc, CSA, Skype, Substrate, Outlook, and SharePoint hosts. All are part of the same cleanup boundary.

### Agency CLI runtime implementation

Remove Agency CLI as an end-to-end runtime capability:

- `src/main/lib/runtime/AgencyCLIManager.ts`
- Agency-related code in `src/main/lib/runtime/RuntimeManager.ts`
- Agency IPC contracts and preload methods
- `kosmosFeatureAgencyCLI` definitions and tests
- FRE background installation in `src/renderer/components/fre/useFreSetup.ts`
- Runtime Settings status, install, and uninstall UI
- removed Agency/M365 catalog merge behavior and related tests
- `docs/agency_mcp_servers/`
- Agency sections in `src/main/lib/runtime/ai.prompt.md`, `src/main/lib/mcpRuntime/ai.prompt.md`, renderer FRE documentation, architecture documents, and release notes

### Required actions

- [x] Remove each data-access tool from registration, schemas, execution routing, tool-search inventory, system prompts, and tests.
- [x] Remove the underlying Graph, Teams, SharePoint, Outlook, transcript, organization, and Azure DevOps clients and credentials.
- [x] Remove Microsoft auth configuration, token caches, browser extraction, consent dialogs, profile schema fields, aliases, and persisted credentials.
- [x] Remove IPC channels and preload types on both sides of every deleted contract.
- [x] Remove renderer settings, Teams selectors, briefing sources, schedule prefetch, loading state, feature flags, localization strings, analytics events, and error copy for deleted capabilities.
- [x] Remove Eval Case automatic SharePoint upload end to end. No separate local-only eval-case export existed to retain.
- [x] Remove Agency CLI detection, installation, uninstallation, PATH injection, self-heal, status checks, and MCP discovery.
- [x] Remove now-unused dependencies, environment variables, permissions, packaging entries, fixtures, mocks, and documentation.
- [x] Verify that generic MCP OAuth remains provider-neutral; do not accidentally delete standards-based OAuth support solely because Microsoft was one supported issuer.
- [x] Audit logs and test fixtures for tenant names, aliases, URLs, IDs, tokens, email addresses, SharePoint paths, Teams payloads, and Azure DevOps organization/project names.

Compatibility policy: loading an older `auth.json` strips the retired
`ghcAuth.aadAccount` field and immediately rewrites the sanitized file locally.
The migration preserves GitHub and Copilot tokens and performs no network access.

## 3. Azure Bot Relay and Remote Channel

The previous inventory mentioned remote-channel attachments but missed the complete hosted service and desktop integration. Remove the entire Azure-hosted Teams relay product path.

### Azure-hosted relay service

- The complete `azure-bot/` project, including:
  - Microsoft Agents SDK adapter and Teams bot protocol.
  - Redis-backed bindings, connection secrets, conversation references, and pub/sub.
  - WebSocket relay, proactive messages, attachment metadata, adaptive cards, and test adapter.
  - Teams app manifests and environment files.
  - Docker/deployment files, package manifests, tests, and module documentation.
- `.github/workflows/deploy-azure-bot.yml`, including Microsoft tenant ID, App Service/resource-group names, OIDC permissions, Azure login, deployment, and health checks.
- Hard-coded Azure App Service targets:
  - `kosmos-bot-prod.azurewebsites.net`
  - `kosmos-bot-test-fab2bsbshxdrggh9.koreacentral-01.azurewebsites.net`

### Desktop remote-channel integration

- The complete `src/main/lib/remoteChannel/` module and tests.
- Managed relay defaults and `remoteChannels` profile schema in `src/main/lib/userDataADO/types/profile.ts`, plus cache, migration, sanitizer, CRUD, and tests.
- `DEVELOPMENT_RELAY_SERVICE_URL` and `PRODUCTION_RELAY_SERVICE_URL` build/environment plumbing.
- Relay definitions in `scripts/vite/defines.ts`, `webpack.main.config.js`, `.env.example`, workflows, and tests.
- Remote-channel IPC and preload/renderer bridges:
  - `src/shared/ipc/remoteChannel.ts`
  - `src/preload/remoteChannel/`
  - `src/renderer/ipc/remoteChannel.ts`
  - startup IPC registration
- Remote Channel settings, navigation, routes, styles, localization, feature flags, and tests.
- `manage_remote_channel` built-in tool registration, execution, prompt inventory, and tests.
- Scheduler completion notifications and `notifyOnCompletion` semantics tied to Teams remote channels.
- Remote-session source metadata, session demotion/migration logic, command handling, attachment storage, and chat UI markers.
- Doctor's dependency on the relay token broker is removed with the complete Doctor feature under the Azure-services workstream.

### Required actions

- [ ] Decommission external Azure environments, variables, secrets, deployment artifacts, app registrations, Redis resources, and Teams app registrations.
- [x] Delete the Azure relay service and deployment workflow.
- [x] Remove the desktop WebSocket client, binding UX, encrypted relay credential files, profile settings, feature flags, IPC, preload, renderer UI, tools, tests, `docs/remote-control.md`, Azure Bot docs, Teams manifest examples, and global architecture references.
- [x] Remove remote-channel scheduler notifications while preserving local scheduler execution.
- [x] Add backward-compatible profile/session cleanup so persisted `remoteChannels`, remote credentials, and `source.type = "remote"` records do not crash or reconnect.
- [x] Do not retain a configurable, provider-neutral, or disabled Remote Channel implementation; remove the feature contract end to end.

## 4. Azure Services, Tooling, and Telemetry

### Application Insights analytics

- `src/main/lib/analytics/`, including embedded production/development connection strings, device IDs, persisted user aliases, event buffering, startup/shutdown hooks, and tests.
- Analytics IPC/preload surfaces in `src/main/startup/ipc/analytics.ts`, `src/shared/ipc/analytics.ts`, `src/preload/analytics/`, and `src/preload/main.ts`.
- Analytics calls spread across auth, chat, skills, profile, prompt cards, and startup.
- `applicationinsights` dependency and transitive Azure telemetry packages.
- `APPINSIGHTS_CONNECTION_STRING`, `DISABLE_ANALYTICS`, and `ACTIVE_USER_THRESHOLD_MIN` build/environment wiring.
- Vite/Webpack compile-time definitions in `scripts/vite/defines.ts`, `webpack.main.config.js`, and `webpack.renderer.config.js`.
- `scripts/test-app-insights.js`, `scripts/test-analytics-events.ts`, App Insights docs, analytics docs, E2E analytics controls, and dashboard/telemetry SQL.

The connection strings and Application IDs are resource identifiers embedded in source and documentation. Treat them as exposed infrastructure metadata and rotate/decommission the associated resources.

Compatibility policy: the stable installation UUID remains required for local
entity IDs and sync markers, but no telemetry consumes it. On first access,
`analytics-device-id` is atomically renamed to `installation-device-id`; the old
telemetry-specific file is removed without changing the UUID.

### Azure CLI

- The complete `src/main/lib/azureCli/` module and tests.
- `azure_cli_execute`, `azureToolDefinitions.ts`, tool registration/routing, interactive auth cards, and tests.
- Azure status, install, uninstall, login, PATH, and runtime IPC in `RuntimeManager.ts`.
- Preload runtime methods, Runtime Settings dependency rows, localization, feature flags, and tests.
- Azure CLI PRDs, plans, architecture documentation, and setup instructions.

### Azure OpenAI

- `src/main/lib/llm/AzureOpenAIModelApi.ts` and tests.
- `llm:callAzureOpenAI` startup IPC handler and preload bridge.
- `PRESET_MODEL_GPT4O_*` and `PRESET_MODEL_GPT41_*` compile-time definitions and environment configuration.
- Vite/Webpack definitions in `scripts/vite/defines.ts`, `webpack.main.config.js`, and `webpack.renderer.config.js`.
- Azure OpenAI references in LLM architecture and project documentation.

Do not remove GitHub Copilot-backed LLM utilities or user-configurable non-Azure model providers as part of this workstream.

### Doctor

Remove Doctor as a complete product feature. Its current issue-submission tool fetches a temporary GitHub token from the Azure relay and targets the private `gim-home/Kosmos` repository. The public release will not preserve a reduced, local-only, or pre-filled-URL Doctor variant.

- The complete `src/main/lib/doctor/` module, including agent configuration, LLM client, runner, manager, diagnostics, log-query support, chat-session readers, tools, and tests.
- `src/main/lib/doctor/tools/createGithubIssue.ts`, `DEFAULT_RELAY_SERVICE_URL`, `/github/issue-token`, and the private repository target.
- Doctor IPC and preload/renderer bridges:
  - `src/main/startup/ipc/doctor.ts`
  - `src/shared/ipc/doctor.ts`
  - `src/preload/doctor/`
  - `src/renderer/ipc/doctor.ts`
- Doctor renderer state and UI:
  - `src/renderer/states/doctor.atom.ts`
  - `src/renderer/components/doctor/`
  - User menu/layout entry points, status indicators, interactive forms, styles, localization, and tests.
- Doctor documentation, prompts, feature flags, startup registration, app knowledge, diagnostics artifacts, and packaging references.

### Required actions

- [x] Remove Application Insights initialization and event calls from startup, shutdown, auth, chat, skills, profile, and renderer IPC.
- [x] Remove embedded connection strings, analytics identifiers, local analytics identity files, dependencies, scripts, dashboards, docs, and CI flags.
- [x] Remove Azure CLI management and tool execution end to end.
- [x] Remove Azure OpenAI adapter, IPC/preload method, preset environment variables, tests, and docs.
- [x] Remove Doctor end to end, including its Azure relay dependency, private GitHub issue flow, diagnostics tools, IPC/preload contracts, renderer UI/state, tests, and documentation.
- [x] Regenerate lockfiles and packaging metadata after dependency removal.
- [ ] Decommission or rotate Azure resources and credentials outside the repository; source deletion alone is insufficient.

## 5. Remote Agent, Skill, and MCP Catalog Features

This workstream removes remote catalog products end to end while preserving only independent on-device Agent, Skill, and MCP management capabilities.

### Main-process and persistence surfaces

- removed Agent, MCP, and Skill remote-catalog fetchers
- remote-catalog-only portions of shared asset helpers
- remote install and activation paths
- `src/main/lib/startupUpdate/` Agent/Skill/MCP remote-version pipeline
- remote Agent/MCP/Skill catalog IPC handlers in `src/main/startup/ipc/`
- compatibility source metadata such as `IN-LIBRARY` and `remoteVersion`, plus removed remote update checks and cache directories under `userData/assets/{agent,mcp,skills}`
- removed built-in remote-catalog tools and facades, including template lookup, search, install, and update actions
- Example catalog fixtures under `resources/examples/agent/` and `resources/examples/mcp_lib/`

Do not blindly remove persisted fields until all callers and backward compatibility are reviewed. Existing profiles may contain `source: "IN-LIBRARY"` and `remoteVersion`; the public build must load them safely without network access.

### Renderer surfaces

- removed remote Agent catalog views
- removed remote Skill and MCP catalog views
- remote catalog entries in management views, add menus, Agent editor tabs, chat headers, and creation flows
- Routes in `src/renderer/routes/AppRoutes.tsx`
- remote catalog styles and localization strings
- Preload APIs, renderer types, state, loading/error UI, and tests

### Documentation and tests

Remove or rewrite remote catalog behavior in:

- `src/main/lib/skill/ai.prompt.md`
- `src/main/lib/runtime/ai.prompt.md`
- `src/main/lib/startupUpdate/ai.prompt.md`
- `src/main/lib/mcpRuntime/ai.prompt.md`
- `src/renderer/components/chat/ai.prompt.md`
- related PRDs, technical designs, migration guides, global prompt documentation, telemetry documentation, and examples under `docs/` and `ai.prompt/`
- Unit, integration, and E2E selectors/tests for remote catalog browse, search, install, and update behavior

### Required actions

- [x] Remove remote catalog navigation, routes, cards, menus, search, detail, install, and update UX.
- [x] Remove fetchers, caches, IPC, preload methods, built-in tools, startup refresh, and version comparison paths used only by remote catalogs.
- [x] Remove configurable catalog URL support, dormant feature flags, local remote-catalog fixtures, example catalog files, and compatibility facades that preserve the remote catalog contract.
- [x] Preserve on-device Agent creation/import, Skill import/install, and MCP configuration unless another workstream explicitly removes them.
- [x] Replace catalog-specific empty states and onboarding with local-device actions where needed.
- [x] Add a compatibility policy for profiles that contain legacy origin metadata; loading must not fail or trigger network access.
- [x] Update architecture and product documentation so “registry” or installed local configuration is not incorrectly described as a remote catalog.

Compatibility policy: persisted `source: "IN-LIBRARY"` and `remoteVersion`
fields are tolerated as inert legacy metadata. They do not initiate network
access, version comparison, update prompts, or read-only behavior. A local edit
may normalize the resource to `ON-DEVICE`.

## 6. Kosmos CDN Access

This workstream overlaps with Library removal but is broader. Remove every CDN consumer and the CDN abstraction end to end. Do not preserve a user-configurable or alternative public CDN mode in this release.

### Known direct consumers

- Removed Agent, Skill, and MCP catalog fetchers, packages, and renderer views
- Application and updater downloads:
  - `src/main/lib/autoUpdate/updaterFetcher.ts`
  - `src/main/lib/autoUpdate/updateManager.ts`
  - `src/main/lib/autoUpdate/cdnUpdateChecker.ts`
  - updater scripts, release workflows, tests, and `docs/cdn-updaters-config.md`
- Deprecated extension-based browser automation downloads and related manager
  flows, tests, and module documentation.
- Prompt-hosted setup instructions:
  - `src/main/lib/chat/globalSystemPrompt.ts`
  - `resources/examples/setup/playwright-setup.prompt.md`
- CDN-hosted UI images and caches:
  - `src/renderer/components/chat/ChatZeroStates.tsx`
  - `src/main/lib/cache/quickStartImageCacheManager.ts`
- Environment and build wiring:
  - `DEVELOPMENT_BASE_CDN_URL`
  - `PRODUCTION_BASE_CDN_URL`
  - `RELEASE_CDN_URL`
  - Vite/Webpack defines, `.env*`, release scripts, tests, and documentation
- Release and fixture surfaces missed by the initial inventory:
  - `.github/workflows/release.yml`
  - `scripts/prepare-release.js`
  - `scripts/test-cdn-update.js`
  - `scripts/debug-update-check.js`
  - removed Agent and MCP catalog fixtures
  - `resources/examples/setup/playwright-setup.prompt.md`
  - `src/renderer/components/fre/README.md`
  - `docs/example/system_prompts/kobi.md`
  - `ai.prompt/workflows.md`

### Required actions

- [x] Remove all hard-coded `cdn.kosmos-ai.com` URLs and default fallbacks.
- [x] Remove all CDN environment variables, configurable URL support, shared URL helpers, and build-time define plumbing.
- [x] Remove the CDN-based auto-update implementation; do not preserve a configurable CDN updater.
- [x] Bundle required static assets locally or remove the dependent feature.
- [x] Remove CDN download/install paths for the legacy browser extension; retain no feature whose required runtime lacks redistribution rights.
- [x] Remove remotely hosted prompt instructions; ship required instructions in the repository or application package.
- [x] Remove CDN tests, debug scripts, release upload logic, cache behavior, docs, and user-facing VPN/internal-network guidance.
- [x] Verify startup, FRE, settings, chat zero states, and offline operation do not make CDN requests.

The legacy browser extension was removed in full. Its required native server was available
only through the Kosmos CDN, and this repository did not establish redistribution
rights for bundling that binary in the open-source release. The independent
embedded browser and public Bing/Edge integrations remain.

## 7. Internal Governance, Samples, and Cross-Cutting Cleanup

- [x] Remove or replace `.github/acl/access.yml`; it is an internal GIM ACL containing employee/account identities.
- [x] Remove or replace `.github/compliance/inventory.yml`; it contains Microsoft employee email ownership metadata.
- [x] Replace internal owners and account aliases in `.github/CODEOWNERS`, `.github/policies/branch-protection.yml`, and `.github/ISSUE_TEMPLATE/JitAccess.yml`.
- [x] Remove `.github/workflows/pr-events-notify-kosmos-dev-for-luna.yml`; it targets a named internal account and a private team Discord webhook/channel.
- [x] Remove internal repository targets and instructions from `.github/prompts/issue.prompt.md`, architecture docs, workflow docs, and secrets setup docs.
- [x] Remove or rewrite Teams/Outlook workflow prompts and update `.github/prompts/kosmos-review.prompt.md` so it no longer requires checks for deleted product modules.
- [x] Retain reviewed public contact and team email addresses while removing internal aliases, tenant IDs, client IDs, subscription IDs, resource groups, App Service names, SharePoint sharing links, and private repository names.
- [x] Sanitize internal MCP examples such as `api.microsoft.ai` and `edge-growth-brain-staging.azurewebsites.net`, even when they appear only in tests or documentation.
- [x] Review `resources/examples/agent/`, `resources/examples/mcp_lib/`, `resources/examples/skills_lib/`, and `resources/examples/app.json` for Microsoft-specific agents, servers, contacts, URLs, and credentials.
- [x] Review `_microsoft` alias defaults and examples in Sync settings. User-configured public GitHub sync may remain, but internal account naming conventions must not be the default.
- [x] Remove dead feature flags, IPC contracts, preload APIs, types, routes, imports, dependencies, package scripts, build externals, and allowlist entries created solely for removed code.
- [x] Update `ai.prompt.md` files and global architecture documents in the same changes as their implementation.
- [x] Update PRDs and technical documents so product behavior, architecture, and implementation remain aligned.
- [x] Remove or sanitize screenshots, recordings, traces, snapshots, SQL/dashboard queries, telemetry dimensions, sample profiles, and fixture payloads.
- [ ] Review licenses and redistribution rights for retained binaries, icons, model files, browser extensions, prompts, sample agents, and skills.
- [ ] Review all secrets and credentials even if they are believed to be expired. Rotate any credential that ever appeared in a commit or artifact.
- [ ] Review GitHub Actions environments, repository variables, secrets names, deployment targets, release jobs, and artifact retention.
- [x] Review `.gitignore` and packaging manifests to confirm internal files cannot be reintroduced into public release bundles.
- [ ] Preserve and verify the README team-member introduction; do not remove approved public attribution while sanitizing internal identities elsewhere.

## 8. Public-Mirror Lessons and Open-Source Baseline

The `microsoft/open-kosmos` `main` history was reviewed as a reference implementation. Apply its useful branding, governance, artifact, and infrastructure cleanup controls to the current repository, but do not adopt its clean-history export model or its retained configurable CDN, Library, or Remote Channel behavior.

Reference use is intentionally narrow:

- Commits `4ec54ab`, `4c55164`, and `31c6a9d` are branding-surface guidance.
- Commit `d9fe1f9` is historical CI-structure guidance only.
- Do not cherry-pick `6bec113` or `e2567e8`.
- Public HEAD `e2567e84` is not cleanup evidence: it retains configurable CDN,
  Libraries, Remote Channel, and Doctor behavior; removes generic MCP OAuth; omits
  workflows; uses clean-snapshot history; and does not prove legacy user-data
  migration.
- Final compatibility evidence must independently cover provider-neutral MCP OAuth,
  legacy Library-origin metadata, legacy remote-session metadata, and migration from
  legacy KOSMOS user-data, log, and cache paths.

### OpenKosmos brand migration

The public mirror migrated the complete product identity from KOSMOS/Kosmos to OpenKosmos/openkosmos. The current release must perform the same class of repository-wide migration rather than changing only visible UI strings.

- [x] Rename brand directories, renderer assets, icons, workspace files, installer assets, package names, product names, descriptions, authorship metadata, and default brand configuration.
- [x] Update application IDs, executable names, shortcut names, window titles, installer filenames, artifact names, native-messaging host names, custom protocols, and packaging metadata.
- [x] Update user-data directories, log filenames, screenshot filenames, temporary directories, cache paths, runtime paths, and generated file prefixes with an explicit migration/compatibility policy.
- [x] Rename public code identifiers and feature-flag keys that expose the old product brand where compatibility does not require retaining them.
- [x] Remove legacy browser-extension registration scripts, native host manifests, adapters, extensions, examples, tests, fixtures, snapshots, and active documentation.
- [x] Replace repository, issue, contribution, release, clone, feedback, homepage, and update links with approved public targets.
- [ ] Scan source files, generated bundles, binary metadata, package archives, installers, source maps, and Git history for stale `KOSMOS`, `Kosmos`, `kosmos-*`, and `kosmos_*` branding.

This brand migration does not authorize retaining `www.kosmos-ai.com` or Kosmos CDN links; those remain governed by their separate removal/review decisions.

### Public repository governance

- [ ] Maintain approved canonical copies/templates for `LICENSE`, `NOTICE`, `SECURITY.md`, `SUPPORT.md`, and `CODE_OF_CONDUCT.md`; do not generate legal or governance text with an LLM. The current reference copies and provenance record are stored under `docs/open-source-release-templates/`.
- [x] Copy the MIT license text exactly from the approved canonical source and modify only the permitted copyright holder/year fields.
- [x] Copy Microsoft-standard security and code-of-conduct blocks from their approved upstream templates without paraphrasing.
- [ ] Treat `NOTICE` and `SUPPORT.md` as controlled templates with explicit project-specific fields; complete those fields through owner/legal review rather than freeform generation.
- [ ] Record each template's authoritative source URL or repository/ref, version or retrieval date, permitted substitutions, and approving owner so future updates are reproducible.
- [x] Add an automated exact-text or normalized-checksum check for the invariant template sections while allowing only documented project-specific fields to differ.
- [x] Ensure the license identifier is consistent in `package.json`, package lockfiles, distributable packages, installers, README, and third-party notices.
- [x] Replace placeholder sections in public policy templates before publication; do not ship unresolved maintainer TODOs.
- [x] Add public contribution, issue-reporting, security-reporting, support, release, and maintainer guidance.
- [ ] Preserve the approved README team-member introduction while ensuring every listed member has approved the public name, role, and contact information.
- [ ] Generate and review third-party license/notice material for runtime dependencies, bundled binaries, browser extensions, models, icons, prompts, examples, and copied source.
- [ ] Explicitly review Voice/Whisper components, native binaries and addons, Google search tools, and their transitive dependencies for license compatibility, source availability, redistribution rights, attribution, platform packaging, and public download/runtime dependencies. Remove any component that cannot be legally and independently distributed.

### Samples, historical documents, and generated artifacts

- [x] Remove internal CHANGELOG entries, release notes, design drafts, migration plans, postmortems, architecture exports, screenshots, and recordings that reveal internal products, incidents, infrastructure, identities, or unreleased plans.
- [x] Remove or sanitize example profiles, app configuration, chat sessions, schedules, agents, skills, MCP catalogs, authentication caches, logs, traces, crash bundles, evaluation data, and generated indexes.
- [x] Remove internal prompts and automation instructions for commits, releases, reviews, issue filing, tenant workflows, and private repositories unless rewritten for the public repository.
- [x] Inspect HTML, presentations, images, archives, patches, source maps, lockfiles, test snapshots, binary metadata, and generated output; plain-text source scans alone are insufficient.

### Existing GitHub Actions reuse and cleanup

The current GitHub Actions are the baseline for the public repository. Reuse generic validation and packaging workflows rather than deleting and rebuilding all CI.

- [x] Retain and adapt the existing PR workflows for unit tests, type checking, file length, internationalization, design-system validation, bundle size, and E2E testing.
- [x] Delete `deploy-azure-bot.yml` with the Azure Bot product.
- [x] Delete `pr-events-notify-kosmos-dev-for-luna.yml` and its employee-specific Discord webhook/channel automation.
- [x] Reuse the existing `release.yml` structure, but remove Kosmos CDN defaults, PM Studio service secrets, removed-feature environment variables, internal repository targets, and any organization-only assumptions.
- [x] Remove Azure OIDC login, tenant/subscription/resource IDs, private environments, private package feeds, internal webhooks, employee-specific automation, and obsolete secret names from retained workflows.
- [ ] Review signing and notarization inputs separately; retain the existing release steps only when the public repository has approved secret ownership and release permissions.
- [x] Use least-privilege GitHub Actions permissions, pin third-party actions, avoid untrusted-event interpolation, and document which jobs are safe for forked pull requests.
- [x] Verify PR validation can build and test without organization secrets, internal runners, Azure credentials, Kosmos infrastructure, or Microsoft tenant access.

## 9. Recommended Execution Order

1. Freeze feature development for the cleanup window.
2. Remove PM Studio file content and Git references.
3. Remove Microsoft tenant-data tools, authentication, Eval Case SharePoint upload, and Agency CLI.
4. Remove the Azure Bot relay and desktop Remote Channel feature end to end.
5. Remove Application Insights, Azure CLI, Azure OpenAI, and Doctor end to end.
6. Remove remote Agent/Skill/MCP catalog features.
7. Remove every remaining Kosmos CDN consumer and the CDN abstraction end to end.
8. Complete the OpenKosmos repository-wide brand, path, package, native-host, and artifact migration.
9. Remove internal governance metadata, private targets, samples, historical documents, dead contracts, dependencies, tests, and generated artifacts.
10. Add approved open-source policy files and sanitize the existing GitHub Actions for public reuse.
11. Run automated scans and complete a manual security/privacy/license review.
12. Build and test from a clean clone in an environment with no internal access.
13. Publish only after security, privacy, legal, and engineering owners sign off.

## 10. Verification Checklist

### Integration gate catalog

| Gate | Automation or evidence | Repository controlled |
|---|---|---|
| `G1` | `npm run check:public-release` scans tracked text and validates removed paths and required public files. Reviewed exceptions require exact family/path/line patterns, an owner, and a justification in `scripts/public-release-scan-exclusions.json`. | Yes |
| `G2` | `npm run check:impact -- <changed-files>`, TypeScript compilation, import resolution, and focused structural tests prove deleted contracts have no stale callers. | Yes |
| `G3` | Focused Vitest/Playwright tests cover persisted-data compatibility, offline startup, retained local Agent/Skill/MCP workflows, local scheduling, route/IPC fail-closed behavior, and brand-path migration. | Yes |
| `G4` | Full repository gates: unit/integration tests, typecheck, Vite build, retained E2E, file length, i18n, design-system, dark-mode, bundle, and coverage checks as applicable. | Yes |
| `G5` | `npm run audit:public-release:artifacts` plus package/archive, binary metadata, source-map, installer, and third-party notice inspection. | Partly; signing and legal conclusions remain external |
| `G6` | `npm run audit:public-release:refs` inventories stale local/remote refs; publication remote branches, tags, PR refs, caches, registries, and hosted artifacts require owner action. | No |
| `G7` | Canonical-template provenance/checksums, dependency license inventory, redistribution review, and third-party notice approval. | No final approval |
| `G8` | Hosting owners decommission Azure resources, app registrations, environments, secrets, and rotate every exposed credential. | No |
| `G9` | Security, privacy, legal/open-source, release, signing/notarization, team-attribution, and engineering owner approvals. | No |

Run `npm run verify:public-release:integration -- --workstream <name> --base
<pre-merge-commit> --head <post-merge-commit>` after each committed integration.
The harness writes an ignored report named for the stable evidence ID. Use
`--workstream final --include-e2e --include-artifacts` only on a host capable of
Electron E2E and packaging; omitting either flag must be recorded as a verification
gap rather than a pass.

Checkbox IDs below are their one-based order in this record as of the inventory
snapshot. The ranges are exhaustive across all 134 inventory entries.

| Checkbox IDs | Required gate(s) | Notes |
|---|---|---|
| `OSR-001..002` | `G1`, `G2` | PM Studio worktree content and dead brand branches |
| `OSR-003` | `G6`, `G9` | Remote branch/tag deletion after archival approval; pending externally |
| `OSR-004` | `G5`, `G6`, `G9` | Hosted PR/release/Actions/package/cache review; pending externally |
| `OSR-005` | `G1`, `G5`, `G6` | Final PM Studio worktree, artifact, and ref scans |
| `OSR-006..015` | `G1`, `G2`, `G3`, `G4` | Tenant data, auth, Agency, generic OAuth retention, fixtures, and docs |
| `OSR-016` | `G1`, `G2`, `G6`, `G8` | Repository relay deletion plus hosted Azure/Teams cleanup |
| `OSR-017..021` | `G1`, `G2`, `G3`, `G4` | Desktop Remote Channel removal and persisted-data compatibility |
| `OSR-022..027` | `G1`, `G2`, `G4` | Analytics, Azure CLI/OpenAI, Doctor, lockfile, and packaging removal |
| `OSR-028` | `G8`, `G9` | Azure decommissioning and credential rotation; pending externally |
| `OSR-029..035` | `G1`, `G2`, `G3`, `G4` | Library removal, retained local workflows, compatibility, and docs |
| `OSR-036..039` | `G1`, `G2`, `G3`, `G5` | CDN removal and local assets |
| `OSR-040` | `G1`, `G2`, `G5`, `G7` | Browser Control distribution and legal review |
| `OSR-041..043` | `G1`, `G2`, `G3`, `G5` | Local prompts, scripts/docs cleanup, and offline network checks |
| `OSR-044..057` | `G1`, `G2`, `G4`, `G5` | Governance identities, examples, contracts, docs, and generated data |
| `OSR-058` | `G5`, `G7`, `G9` | Retained asset/license review; pending external approval |
| `OSR-059` | `G6`, `G8`, `G9` | Secret history review and credential rotation; pending externally |
| `OSR-060..062` | `G1`, `G2`, `G3`, `G4` | Actions, packaging reinsertion controls, and README attribution retention |
| `OSR-063..069` | `G1`, `G2`, `G3`, `G5`, `G6` | OpenKosmos identity, migration policy, artifacts, and history |
| `OSR-070..071` | `G7`, `G9` | Canonical legal copies and permitted substitutions |
| `OSR-072` | `G1`, `G7` | Exact Microsoft-standard policy blocks |
| `OSR-073` | `G7`, `G9` | NOTICE/SUPPORT controlled-field completion |
| `OSR-074..075` | `G1`, `G4`, `G7` | Template provenance and invariant checksum automation |
| `OSR-076` | `G1`, `G5`, `G7` | License identifier consistency |
| `OSR-077..078` | `G1`, `G2`, `G4` | Placeholder removal and public contributor guidance |
| `OSR-079` | `G3`, `G9` | README attribution retention plus member approval |
| `OSR-080..081` | `G5`, `G7`, `G9` | Third-party notices and high-risk redistribution review |
| `OSR-082..085` | `G1`, `G5`, `G9` | Historical/sample/generated content and non-text artifact inspection |
| `OSR-086..090` | `G1`, `G2`, `G4` | Retained public CI and release workflow sanitization |
| `OSR-091` | `G7`, `G9` | Signing/notarization secret ownership; pending externally |
| `OSR-092..093` | `G1`, `G4` | Actions permissions, pinning, fork safety, and secret-free validation |
| `OSR-094` | `G1`, `G5`, `G6` | PM Studio final static gate |
| `OSR-095..109` | `G1`, `G2`, `G5` | Final endpoint, feature, identity, brand, and artifact static gates |
| `OSR-110` | `G1`, `G7`, `G9` | Complete policy set with no unresolved controlled fields |
| `OSR-111..127` | `G3`, `G4` | Behavioral, offline, compatibility, retained-workflow, and CI checks |
| `OSR-128..132` | `G4` | Impact, tests, typecheck, Vite build, and retained E2E |
| `OSR-133` | `G5` | Packaged artifact inspection |
| `OSR-134` | `G5`, `G7`, `G9` | Final notice/license approval against shipped dependency tree |

### Dependency-aware merge ledger

Do not integrate a workstream until its owner reports a stable commit or PR and its
branch-level checks. After each integration, rerun the listed focused tests before
starting the next row.

| Order | Workstream | Source branch | Stable owner evidence | Integration commit | Post-merge checks | Status |
|---:|---|---|---|---|---|---|
| 1 | Microsoft tenant data and Agency CLI | PRs #942, #946, and #947 | Owners: `479621da2` + `292de4516` + final patch `4ce388ed` (clean equivalent tree `a6852d224`); late immutable residue patches `d2c0289e8` + `379808086` + `084ec29d1`; core deletion, zero-residue, provider-neutral OAuth, and local-only legacy stripping audits PASS | `0fecb39f8` plus surgical integration resolutions `d5b7997ec`, `2c3f131e8`, and `67b6df190` | `EV-INT-01-TENANT` and late-residue rerun PASS: diff, impact, full tests, typecheck; Office-prefix focused tests and Vite build PASS | Integrated |
| 2 | Azure Bot and Remote Channel | `yanhu-microsoft-remove-remote-channels` | Owner: `7a5c1276a`; all required GitHub checks PASS after E2E rerun completed without the prior post-assertion worker teardown timeout | `3eee0b63e` | `EV-INT-02-REMOTE` PASS: diff, impact, full tests, typecheck; focused persistence/IPC/scheduler/renderer tests and Vite build PASS | Integrated |
| 3 | Azure services and Doctor | `yanhu-microsoft-remove-azure-services` | Owner: `eba015716`; independent scope audit and all required GitHub checks PASS; Browser Control doctor scripts remain owned by row 4 | `66aea7e61` | `EV-INT-03-AZURE` PASS: diff, impact, full tests, typecheck; 1,835 focused startup/runtime/IPC/renderer tests and Vite build PASS | Integrated |
| 4 | Agent/Skill/MCP Library and CDN | PRs #943 and #948 | Owners: `cda6fb100` + immutable correct-topology remediation `7ea9f816f`; independent audit found and the integration branch removed final stale mocks/docs/fixture naming and whitespace; exact Browser Control, remote catalog, CDN, and Graph scans PASS | `e3ef8ce2e` plus local-workflow correction `cd3446327` | `EV-INT-04-LIBRARY` PASS: diff, impact, full tests, typecheck; 477 residue tests, 89 local-tool routing tests, design, dark mode, i18n, file length, and Vite build PASS | Integrated |
| 5 | OpenKosmos brand migration | PR #944 | Owner: `4617aec46`; all required GitHub checks PASS; independent user-data migration, token-cache rename, legacy-brand, and deletion-boundary audits PASS | `b3eaa08e3` | `EV-INT-05-BRAND` PASS: diff, impact, full tests, typecheck; 181 focused migration/OAuth/branding tests, design, dark mode, i18n, file length, exact source scans, and Vite build PASS | Integrated |
| 6 | Public governance and workflows | PR #940 | Owner: `1781d00b8`; all repository-controlled GitHub checks PASS, including E2E and Public Governance; `GitOps/Inventory` remains an external repository-control blocker | `543556c1e` | `EV-INT-06-GOVERNANCE` PASS: diff, impact, full tests, typecheck; public governance, release scan, design, dark mode, i18n, file length, and Vite build PASS; publication-blocking exclusions cleared | Integrated |
| 7 | Cross-cutting integration cleanup | Integration branch | `EV-FINAL-01-REPOSITORY`, final review remediation evidence, and extracted `EV-FINAL-ASAR-CONTENTS` PASS; 18 stale refs recorded by `EV-FINAL-REFS` as external publication controls | Review remediation `1f9a09d61`; latest-main delete-wins merge `97a34f85d` | Full repository-controlled `G1` through `G5` gates PASS, including 244-file diff coverage, 33 E2E tests, package build, zero findings across 905 packaged files and 5,954 extracted `app.asar` files, and OpenKosmos bundle metadata inspection | Complete; external sign-off pending |

### Static searches

- [ ] No PM Studio matches in the final worktree, branches, tags, or published artifacts.
- [x] No `cdn.kosmos-ai.com`, `DEVELOPMENT_BASE_CDN_URL`, `PRODUCTION_BASE_CDN_URL`, or `RELEASE_CDN_URL` matches outside this record.
- [x] No Agency CLI manager, feature flag, installer command, IPC method, or documentation remains.
- [x] No Microsoft data tool is registered, documented, searchable, or executable.
- [x] No `graph.microsoft.com`, Teams internal API, Outlook API, SharePoint tenant, Microsoft login/token, or Azure DevOps endpoint remains outside approved public-service fixtures.
- [x] No `azurewebsites.net`, `applicationinsights.azure.com`, Azure OpenAI endpoint, embedded App Insights connection string, Azure tenant/subscription/resource identifier, or Azure deployment workflow remains.
- [x] No Remote Channel relay, Teams bot, relay credential, `remoteChannels` profile field, remote-session source, scheduler remote notification, configurable relay mode, or dormant Remote Channel contract remains.
- [x] No Doctor module, route, menu item, state, IPC/preload contract, diagnostic tool, issue-submission flow, test, or documentation remains.
- [x] No `gim-home/Kosmos`, `ai-microsoft/Kosmos.app`, internal SharePoint sharing URL, or internal ACL/compliance identity remains.
- [x] No Azure CLI manager, built-in tool, runtime status, installer, Settings row, or IPC method remains.
- [x] No `llm:callAzureOpenAI`, `AzureOpenAIModelApi`, or `PRESET_MODEL_GPT*` Azure preset remains.
- [x] No remote Agent/Skill/MCP catalog route, menu, fetcher, built-in tool, startup updater, or cache remains.
- [x] No configurable CDN/catalog URL, CDN helper, optional marketplace mode, catalog fixture, or dormant remote-catalog compatibility layer remains.
- [x] No internal hostname, tenant identifier, organization name, access token, client secret, certificate, or private package feed remains.
- [ ] No stale KOSMOS/Kosmos product identity remains in application IDs, paths, native hosts, package metadata, installers, logs, assets, generated output, or publishable history.
- [x] No internal CHANGELOG, sample profile/chat/evaluation data, private automation prompt, architecture export, or generated artifact remains.
- [ ] Open-source license, notice, security, support, conduct, contribution, and issue-reporting documents are complete and contain no unresolved template TODOs.

Run repository-wide case-insensitive scans with `.git`, dependencies, generated output, and this record excluded. At minimum, scan the following pattern families:

```text
pm[-_ ]?studio
cdn\.kosmos-ai\.com|BASE_CDN_URL|RELEASE_CDN_URL
azurewebsites\.net|applicationinsights|APPINSIGHTS|PRESET_MODEL_GPT|RELAY_SERVICE_URL
graph\.microsoft\.com|login\.(microsoftonline|windows)\.(com|net)
teams\.microsoft\.com|teams\.cloud\.microsoft|chatsvc|api\.spaces\.skype\.com|substrate\.office\.com
sharepoint\.com|dev\.azure\.com|api\.microsoft\.ai
gim-home/Kosmos|ai-microsoft/Kosmos\.app|_microsoft
AgencyCLI|agency_cli|remoteChannels|manage_remote_channel|llm:callAzureOpenAI|Doctor|create_github_issue
```

Every match must be deleted, replaced with a neutral public example, or recorded in a reviewed exclusions manifest with an owner and justification. Microsoft contact email addresses are not prohibited. Do not treat comments, tests, snapshots, prompts, documentation, source maps, generated bundles, or Git history as harmless matches.

### Behavioral checks

- [x] A clean install reaches the main UI without Microsoft authentication, Agency CLI, or CDN connectivity.
- [x] Startup, shutdown, and ordinary UI interaction emit no Application Insights traffic.
- [x] Scheduler runs locally without Teams briefing dependencies or remote-channel notifications.
- [x] Existing profiles containing Microsoft config, relay config, or remote-session metadata load without reconnecting or corrupting data.
- [x] No Doctor UI, background process, diagnostics collection, or Azure/GitHub request can start.
- [x] Local Agent creation/import works.
- [x] Local Skill import, installation, activation, and removal work.
- [x] Local and user-configured MCP server creation, connection, editing, and removal work.
- [x] Startup and FRE make no request to Kosmos infrastructure.
- [x] Removed routes and IPC channels fail closed and have no stale callers.
- [x] Existing profiles containing removed Library metadata load without corruption or network access.
- [x] Setting CDN or Relay environment variables does not reactivate removed CDN, Library, or Remote Channel behavior.
- [ ] The README retains the approved team-member introduction.
- [x] Existing installations either migrate safely to the OpenKosmos user-data/log/cache paths or follow an explicitly approved clean-install policy.
- [x] Retained PR workflows run without internal runners or organization secrets and enforce the approved test, build, coverage, and security gates.
- [x] The sanitized release workflow contains no Kosmos CDN defaults, PM Studio service secrets, Azure Bot deployment, private targets, or removed-feature configuration.
- [x] Offline startup and core local workflows succeed.

### Engineering checks

- [x] `npm run check:impact -- <changed-files>` reports no missed module documentation.
- [x] Relevant unit and integration tests pass.
- [x] `npm run typecheck` passes.
- [x] `npm run build:vite` passes.
- [x] `npm run test:e2e` passes for the retained public workflows.
- [x] Packaged artifacts contain no removed strings, endpoints, binaries, source maps, or documentation.
- [ ] Third-party notices and license metadata match the final dependency tree and bundled artifacts.

## 11. Sign-Off

| Area | Owner | Evidence | Required external action | Status |
|------|-------|----------|--------------------------|--------|
| Engineering | Repository maintainer | `EV-FINAL-01-REPOSITORY` is repository-green | Review the final PR and grant engineering release approval | Pending |
| Security | Security owner | Zero-findings source/artifact scans; 18 stale refs inventoried | Review history/refs, dependency audit findings, permissions, and credential-rotation evidence | Pending |
| Privacy | Privacy owner | Tenant, telemetry, and remote-channel code removed | Complete the public data-flow and telemetry review | Pending |
| Legal/Open Source | Legal/Open Source owner | Canonical template checks and generated dependency inventory | Approve copyright/trademark/icon/model/native-binary redistribution and resolve seven unknown license entries | Pending |
| Infrastructure | Hosting and identity owners | Repository callers and deployment workflows removed | Decommission Azure/CDN/bot/app-registration resources and rotate every affected credential | Pending |
| Release | Release owner | OpenKosmos arm64 app packages; metadata and extracted `app.asar` scans pass | Delete/approve the 18 stale refs, provide approved signing/notarization credentials, inspect signed artifacts, and grant release approval | Pending |
