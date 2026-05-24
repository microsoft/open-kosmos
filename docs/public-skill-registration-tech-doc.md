# Public Skill Registration Technical Design

> Version: 1.1.0 | Date: 2026-03-24

## 1. Overview

This document turns the investigated public-Skill incident into an implementable Kosmos design.

The core problem is not acquisition. Kosmos can already obtain Skill content through library downloads, local packages, AI-authored files, or public web workflows.

The core problem is formal installation.

This design extends the existing `Add Skill From Device` capability into a single managed device-install path that supports `.zip`, `.skill`, and `folder`, and makes all future public Skill flows converge on that path.

## 2. Current State

### 2.1 Supported Managed Install Paths Today

Today, two flows are formally supported:

1. Skill Library install
2. Local package import via `.zip` or `.skill`

Both converge to the same managed chain:

1. validate package
2. read Skill metadata
3. copy or move Skill into `profiles/<alias>/skills/<name>/`
4. call `profileCacheManager.addSkill(...)` or `updateSkill(...)`

Relevant current components:

1. `src/main/lib/skill/skillLibraryFetcher.ts`
2. `src/main/lib/skill/skillDeviceImporter.ts`
3. `src/main/lib/skill/skillManager.ts`
4. `src/main/lib/userDataADO/profileCacheManager.ts`

### 2.2 Current Runtime Consumption Model

Runtime Skill resolution does not scan the disk. It resolves only from:

1. Agent reference names in `chat.agent.skills`
2. installed registry entries in `profile.skills`

`AgentChat` builds the chat Skill snapshot by resolving Agent Skill names against `profile.skills`. If a Skill name is not in the registry, it becomes missing and is excluded from the valid Skill list.

Relevant current components:

1. `src/main/lib/chat/agentChat.ts`
2. `src/main/lib/chat/skillSnapshotBuilder.ts`

### 2.3 Known Failure Mode

The investigated conversation produced this state:

1. Skill folder existed on disk
2. Agent referenced the Skill name
3. `get_skill_installation_state` returned `NotAdded`
4. `profile.skills` was missing the entry

At runtime, `buildChatSkillSnapshot(...)` resolved only valid registry entries, so the Skill remained missing even though the files were physically present.

### 2.4 Current UX Gap

Renderer currently supports:

1. Add from Library
2. Add from Device package

It does not provide a first-class flow for:

1. selecting an existing Skill folder through the same device-install entry
2. selecting `SKILL.md` and installing from its parent folder
3. repairing a bound-but-unregistered Skill through the same installation semantics

Additionally, chat install affordances are narrow today:

1. `GeneratedFileCards` only exposes install for `.skill`
2. `installSkillFromFilePath(...)` delegates to package import semantics

## 3. Design Principles

1. Preserve `profile.skills` as the only installed-skill authority.
2. Converge every non-library install source onto one formal device-install API.
3. Do not auto-trust public Skill content.
4. Keep runtime deterministic: installation affects next-turn Skill snapshot, not current in-flight generation.
5. Normalize on canonical `SKILL.md` path during managed install.
6. Reuse the existing `Apply Skill To Agents` UX after successful install.
7. Both `Add Skill From Device` and `Apply Skill To Agents` must exist as UI capability and built-in tool capability.

## 4. Target Architecture

### 4.1 Core Capability Extension

Extend the existing backend capability:

1. `Add Skill From Device`

So that it accepts:

1. `.zip`
2. `.skill`
3. `folder`

This becomes the missing bridge between:

1. public or AI-acquired local files
2. formally installed Kosmos Skills

### 4.2 Flow Convergence Rule

All non-library Skill flows should end in one device-install backend.

Recommended internal shape:

1. `addSkillFromDevice(...)`
2. format-specific normalization under the hood for package or folder sources

Future URL-based installs become acquisition wrappers that feed into the same device-install backend after the content is materialized locally.

## 5. Proposed Backend Changes

### 5.1 Device Import Refactor

Refactor the current importer module, rather than adding a separate product concept.

Recommended options:

1. extend `src/main/lib/skill/skillDeviceImporter.ts`
2. optionally extract a helper like `skillFolderRegistrar.ts` behind that API

Suggested responsibilities:

1. accept a package file path or folder path
2. determine input type: `.zip`, `.skill`, or `folder`
3. for package input, extract to a temporary directory
4. for folder input, resolve candidate Skill root directly
5. detect `SKILL.md` or fallback `skill.md`
6. parse metadata using existing `SkillManager` parsing logic
7. validate package structure and naming
8. normalize file casing to canonical `SKILL.md`
9. copy or move into canonical profile Skill directory if needed
10. call `skillManager.installSkill(...)`
11. return install or update result with input-type metadata

Recommended public API stays conceptually simple:

1. one `addSkillFromDevice(inputPath, ...)`
2. input can be package file or directory

Suggested result shape:

```ts
interface AddSkillFromDeviceResult {
  success: boolean;
  skillName?: string;
  skillVersion?: string;
  isOverwrite?: boolean;
  wasRepair?: boolean;
  inputType?: 'zip' | 'skill' | 'folder';
  normalizedPath?: string;
  warnings?: string[];
  error?: string;
}
```

### 5.2 Canonical Path Handling

Unified device install should accept all of the following:

1. `/path/to/my-skill.zip`
2. `/path/to/my-skill.skill`
3. `/path/to/my-skill/`
4. `/path/to/my-skill/SKILL.md`
5. `/path/to/my-skill/skill.md`

Normalization algorithm:

1. if input is a package, extract and resolve its root
2. if input is a file ending in `SKILL.md` or `skill.md`, treat parent directory as Skill root
3. prefer canonical `SKILL.md`
4. if only lowercase `skill.md` exists, rename or copy it to canonical `SKILL.md` within the managed destination

This closes the case-sensitivity gap across platforms.

### 5.3 Validation Rules

Reuse existing `SkillManager` logic where possible.

Validation should include:

1. presence of Skill markdown entry file
2. parseable frontmatter
3. valid `name`
4. required `description`
5. folder name matching metadata name once normalized into managed destination

Additionally, the importer should produce warnings for:

1. `package.json`
2. `requirements.txt`
3. shell scripts or executable files
4. unusually large files

Warnings do not block MVP installation by default, but they should be shown to the user before confirmation.

### 5.4 IPC Changes

The product should prefer evolving the existing IPC surface:

1. `skillLibrary:addSkillFromDevice`
2. `skillLibrary:installSkillFromFilePath`
3. optionally add `skillLibrary:repairSkillRegistration`

Suggested signatures:

```ts
addSkillFromDevice(inputPath?: string): Promise<AddSkillFromDeviceResult>
repairSkillRegistration(skillName: string): Promise<AddSkillFromDeviceResult>
```

`repairSkillRegistration(skillName)` should:

1. inspect canonical profile Skill directory
2. verify a matching unmanaged folder exists
3. call the same device-install path

`installSkillFromFilePath(filePath)` should also route through the same backend, not its own special-case logic.

### 5.5 Built-in Tool Support

To support AI-led installation and binding inside chat, both product actions need explicit built-in tools.

Required tools:

1. `add_skill_from_device`
2. `apply_skill_to_agents`

Optional future tool:

1. `install_skill_from_url`

Design rule:

1. the AI may search or fetch Skill content
2. the final formal install step must call managed device install, not just write files into the profile directory
3. the final agent-binding step must call a dedicated apply-to-agents tool, not rely on UI-only events

## 6. Proposed Renderer Changes

### 6.1 Settings -> Skills Entry Points

Extend the Skills add menu with:

1. Add from Library
2. Add Skill From Device

`Add Skill From Device` should open a dialog supporting:

1. `openFile`
2. `openDirectory`
3. filters for `.zip` and `.skill`
4. folder selection for already prepared Skill directories

Recommended renderer entry point:

1. extend `src/renderer/components/skills/SkillsView.tsx`

### 6.2 Chat Surface Install Affordances

Extend generated-file or preview install affordances beyond `.skill`:

1. `.zip`
2. `.skill`
3. `SKILL.md`
4. `skill.md`
5. valid folder path when the artifact is represented as a local directory reference

For markdown entry files, the install action should resolve the parent directory and route through unified device install rather than package-import the file itself.

Potential touchpoints:

1. `src/renderer/components/chat/GeneratedFileCards.tsx`
2. `src/renderer/components/chat/InlineFilePreviewPanel.tsx`

### 6.3 Post-Install Agent Binding UX

No new product surface is required.

Reuse the existing `ApplySkillToAgentsDialog` flow after successful new install.

Expected behavior:

1. install succeeds
2. Skills list refreshes
3. `skills:applyToAgents` event fires with `skillName`
4. user chooses target Agents

This covers the UI path.

The same product action also needs a built-in tool path for AI-led automation.

### 6.4 Built-in Tool for Apply Skill To Agents

Add a dedicated built-in tool for applying a registered Skill to selected Agents.

Suggested tool:

1. `apply_skill_to_agents`

Suggested input shape:

```ts
interface ApplySkillToAgentsArgs {
  skill_name: string;
  agent_chat_ids?: string[];
  agent_names?: string[];
  apply_to_all?: boolean;
}
```

Suggested behavior:

1. verify the Skill exists in `profile.skills`
2. resolve target Agents by chat ID or agent name
3. union the Skill name into each target Agent's `skills`
4. call `profileCacheManager.updateChatAgent(...)` for each affected chat
5. rely on existing snapshot invalidation when agent skills change
6. return per-agent success and failure results

### 6.5 Agent Editor Repair Visibility

Current Agent Skills tab only renders global Skills and counts selected Skills that exist in that list.

Recommended UX improvement:

1. if `agent.skills` contains names missing from global registry, show them in a "Missing Skills" section
2. if a matching disk folder exists, show `Repair Registration`

This makes the broken state visible instead of silently hiding it.

## 7. Data Model Impact

### 7.1 `SkillConfig`

MVP can keep the existing `SkillConfig` shape:

```ts
interface SkillConfig {
  name: string;
  description: string;
  version: string;
  remoteVersion?: string;
  source: 'IN-LIBRARY' | 'ON-DEVICE';
}
```

Folder-installed and public-but-local Skills can remain `source: 'ON-DEVICE'` in MVP.

If analytics or UI later needs more detail, add a separate optional field instead of expanding `source` prematurely:

```ts
installMethod?: 'library' | 'package' | 'folder' | 'repair' | 'url';
```

### 7.2 Chat Snapshot Behavior

No new snapshot model is required.

Existing invalidation behavior already clears affected chat Skill snapshots when `profile.skills` changes through `addSkill`, `updateSkill`, or `deleteSkill`.

That means unified device install should reuse the same final registration path so next-turn refresh continues to work without extra runtime logic.

## 8. Repair Detection Strategy

### 8.1 Repair by Skill Name

Given a missing Skill name in `agent.skills`, repair logic should search these candidates in order:

1. canonical profile path `profiles/<alias>/skills/<skillName>/`
2. same path with lowercase entry file
3. optionally future workspace or temporary acquisition folders if explicitly provided by the UI or tool call

MVP recommendation:

1. only repair from explicit path or canonical profile path
2. avoid broad file-system scans

### 8.2 Missing Skill Exposure

Use existing snapshot or binding information to detect missing references.

Signals already available:

1. `skill_snapshot.missing_skill_names`
2. `agent.skills` names not found in `profile.skills`

## 9. Security and Trust Model

Public Skills may include instructions, scripts, and dependency manifests.

MVP should require explicit confirmation before registration when third-party content is detected.

Recommended confirmation payload:

1. Skill name
2. source path
3. input type
4. whether scripts were detected
5. whether dependency manifests were detected
6. whether install is new, overwrite, or repair

MVP should not automatically run post-install scripts or dependency installs.

Instead:

1. register the Skill
2. surface warnings and next steps
3. let future phases add guided dependency installation with explicit approval

## 10. Recommended API Flow

### 10.1 Unified Add Skill From Device

```text
Renderer or tool provides path or opens picker
  -> main IPC addSkillFromDevice(path?)
  -> determine input type: zip / skill / folder
  -> resolve package extraction or skill root
  -> parse and validate metadata
  -> prepare managed destination
  -> normalize SKILL.md casing
  -> skillManager.installSkill(...)
  -> profileCacheManager.addSkill/updateSkill(...)
  -> clear affected chat skill snapshots
  -> notify renderer
  -> trigger existing Apply Skill To Agents flow for new installs
```

Built-in tool equivalent:

1. `add_skill_from_device`

### 10.2 Apply Skill To Agents

```text
Renderer or tool provides skill name and target agents
  -> for UI: open ApplySkillToAgentsDialog
  -> for tool: call apply_skill_to_agents(...)
  -> verify skill exists in profile.skills
  -> update each target chat agent.skills
  -> clear affected chat skill snapshots through existing update flow
  -> notify renderer
```

### 10.3 Repair Registration

```text
Renderer or tool provides skill name
  -> main IPC repairSkillRegistration(skillName)
  -> locate canonical profile skill directory
  -> validate folder and metadata
  -> route through unified device install semantics
  -> register into profile.skills
  -> clear affected snapshots
  -> notify renderer
```

### 10.4 Future URL Install

```text
Renderer or tool provides URL
  -> download or materialize local skill folder/package
  -> call addSkillFromDevice(...) with the resulting local artifact
  -> same downstream flow as managed install
```

## 11. Testing Plan

### 11.1 Unit Tests

Add tests for:

1. installing from `.zip`
2. installing from `.skill`
3. installing from a valid folder path
4. installing from `SKILL.md`
5. installing from lowercase `skill.md`
6. overwrite behavior when Skill already exists
7. built-in tool `add_skill_from_device`
8. built-in tool `apply_skill_to_agents`
9. repair behavior for canonical profile path
10. invalid frontmatter or folder name mismatch

Likely homes:

1. `src/main/lib/skill/__tests__/skillDeviceImporter.test.ts`
2. optionally `src/main/lib/skill/__tests__/skillFolderRegistrar.test.ts` if helper extraction happens
3. extend `profileCacheManager` Skill snapshot tests where needed

### 11.2 Renderer Tests

Add tests for:

1. Skills add menu offering unified device install
2. device picker supporting files and folders
3. chat file card install action for `SKILL.md`
4. repair CTA shown for missing bound Skills when repair is available
5. successful install triggering the existing apply-to-agents flow
6. UI apply dialog correctly binding selected agents

### 11.3 Integration Expectations

Verify full flow:

1. write or copy Skill folder on disk
2. install it through unified device install
3. confirm `get_skill_installation_state` returns `Added`
4. confirm Skill appears in Settings -> Skills
5. confirm UI Apply Skill To Agents can bind it to chosen Agents
6. confirm built-in tool `apply_skill_to_agents` can bind it to chosen Agents
7. confirm next-turn runtime resolves it through Skill snapshot

## 12. Migration and Compatibility

No background migration is required.

This is a forward-fix feature:

1. future public and local Skills use the unified device installer
2. existing broken installs can be repaired on demand

## 13. Rollout Plan

### Phase 1

1. extend backend device importer to support folder input
2. add built-in tool `add_skill_from_device`
3. add built-in tool `apply_skill_to_agents`
4. extend Settings -> Skills `Add Skill From Device` picker to support files and folders
5. canonical `SKILL.md` normalization
6. reuse existing Apply Skill To Agents dialog after successful install
7. repair registration API for existing canonical profile folders

### Phase 2

1. chat surface install improvements for `SKILL.md`, `.zip`, `.skill`, and folder-based artifacts where available
2. Agent editor missing-Skill repair UX
3. analytics on install method and repair success

### Phase 3

1. URL-based public Skill acquisition wrapper
2. explicit dependency guidance or guided install workflow

## 14. Recommendation

Implement unified `Add Skill From Device` first.

It is the smallest change that solves the investigated user problem end-to-end:

1. the AI can already fetch public Skill content
2. Kosmos already knows how to validate and register managed Skills
3. the missing capability is a universal local/public artifact install step

Once that bridge exists, public Skill workflows become product-supported instead of relying on brittle file-copy side effects.