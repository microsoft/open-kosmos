# Branch Cleanup Checklist: `yanhu/soapy-pomelo` vs `main`

**Total: 15 commits | 2021 files changed | -480,679 lines**

---

## Removed Feature Modules

| # | Module | Scope |
|---|--------|-------|
| 1 | **Microsoft Integrations (Teams/Outlook/Graph/MSAL/SharePoint)** | 18 Teams/Outlook builtin tools, Graph API client, MSAL auth, SharePoint document search, Teams calendar, remote channel, Azure Bot |
| 2 | **CDN Library Marketplace** | MCP/Agent/Skill/SubAgent library browser, CDN fetcher, auto-update service, `IN-LIBRARY` source type, `remoteVersion` field, ClawHub/GitHub skill search |
| 3 | **Git-based Profile Sync** | Remote profile sync via Git |
| 4 | **User Task (Todo)** | Right-side panel, task list, Briefing system |
| 5 | **Text-to-Speech (TTS)** | Voice read-aloud feature |
| 6 | **Floating Toolbar** | Floating toolbar UI component |
| 7 | **Memory System** | mem0 vector store, long-term memory, semantic search |
| 8 | **Application Insights Telemetry** | AnalyticsManager singleton, 15 event types, DAU reporting, Dashboard SQL |
| 9 | **Doctor / Bug Report** | AI diagnostic assistant, log analysis, GitHub Issue auto-creation, Azure relay service |
| 10 | **Microsoft Alias System** | `alias_microsoft` to `@microsoft.com` AAD email conversion, `aadAccount` field |

---

## Removed Infrastructure

| Item | Description |
|------|-------------|
| **Release CI/CD** | `.github/workflows/release.yml` (1300 lines) |
| **Azure Bot Deployment** | `.github/workflows/deploy-azure-bot.yml` |
| **azure-bot/ subproject** | Complete Azure Bot directory |
| **updater/ subproject** | Windows/Mac auto-updater |
| **resources/examples/** | `mcp_lib/`, `agent_lib.json`, `skills_lib.json` and other library resources |
| **docs/dashboard/** | Telemetry Dashboard SQL queries |
| **docs/teams-*, docs/design/msal-*, docs/remote-*, docs/agency-*, docs/browser-auth-*** | Design docs for removed features |

---

## Modified (Non-Deletion Changes)

| Item | Description |
|------|-------------|
| **Brand Rename** | OpenKosmos → OpenKosmos (README, package.json, brands/config, LICENSE) |
| **License Change** | Proprietary → MIT open source |
| **Profile Migration** | Version downgraded from 3 to 2, removed V3 Teams field migration |
| **Source Type** | Removed `'IN-LIBRARY'`, kept only `'ON-DEVICE' | 'PLUGIN'` |
| **Build Config** | Removed `APPINSIGHTS_CONNECTION_STRING`, `DISABLE_ANALYTICS`, MSAL externals |
| **manageSkillsFacade** | Source kept only `'device'`, removed `clawhub`/`github` |
| **Feature Flags** | Removed Teams/remoteChannel/agencyCLI/TTS related flags |
| **ai.prompt Docs** | Comprehensive update, removed all references to deleted features |

---

## Intentionally Retained Microsoft References

| Category | Reason |
|----------|--------|
| Browser Control (Edge browser paths) | Edge is a supported browser |
| Security Guards (OAuth logout, Cookie protection) | Prevents AI from destroying system auth |
| MCP OAuth (Microsoft as provider) | Generic OAuth support |
| Azure OpenAI (LLM provider) | Model vendor |
| Office Online Preview | Remote file preview feature |
| GitHub Enterprise SSO | Login flow |

---

## Commit History

```
1329f5b8 chore(branding): rename Kosmos/OpenKosmos to OpenKosmos
129acb8e chore(ci): remove release CI/CD workflow
78ac1d95 docs(license): change from proprietary to MIT open source license
60fe3b8e refactor(cleanup): remove Microsoft copyright headers and Teams migration code
7d7eece6 refactor(cleanup): remove Microsoft alias system, doctor module, and remaining Teams/MSAL leftovers
3603f4f7 docs(cleanup): remove stale CDN library, MSAL, and SharePoint references from docs and comments
0f4bdf42 refactor(cleanup): remove remaining Teams/Outlook/Library/Analytics leftovers
bb605f33 refactor(analytics): remove Application Insights telemetry service and all call sites
a8a5e298 refactor(cleanup): remove remaining MSAL, SharePoint, TTS, Toolbar, and library leftovers
b79829ab refactor(cleanup): remove library entry points and User Task right pane UI
4bb64e6b refactor(cleanup): remove Text-to-Speech (TTS) feature
23cdfd83 refactor(cleanup): remove User Task feature
e665e71d refactor(cleanup): remove Git-based profile sync feature
9a572d06 refactor(cleanup): remove CDN library marketplace and auto-update features
a8a3bc91 refactor(cleanup): remove Microsoft integrations, Azure services, Toolbar, and Memory features
```
