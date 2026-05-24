# Public Skill Registration PRD

## 1. Background

Kosmos currently has two supported Skill installation paths:

1. In-library install via Skill Library.
2. On-device package install via `.zip` or `.skill` import.

Both supported paths eventually call the same formal registration chain:

1. `skillManager.installSkill(...)`
2. `profileCacheManager.addSkill(...)` or `updateSkill(...)`
3. `profile.skills` becomes the global installed-skill registry

The investigated user conversation exposed a real product gap outside these two paths.

In that chat, the assistant successfully fetched Anthropic's public PPTX Skill assets and wrote the resulting Skill folders onto disk under the profile Skill directory. It also bound the Skill names at Agent level. However, the assistant did not complete formal registration into `profile.skills`.

As a result:

1. the files existed on disk
2. the Agent referenced the Skill names
3. `get_skill_installation_state` still returned `NotAdded`
4. the Skills UI did not show the Skills
5. runtime prompt injection could not resolve those Skills as valid installed Skills

This is not an edge case. The user need is valid:

1. search the web for a public Skill
2. download or construct the Skill locally
3. install it into Kosmos
4. apply it to selected Agents

Both key actions in this workflow must exist in two forms:

1. UI capability for direct user interaction
2. built-in tool capability for AI-led automation

Today, Kosmos does not provide a single supported product flow that covers all of those steps for local or public artifacts.

## 2. Investigated Evidence

### 2.1 What the user chat proves

The exported conversation shows all of the following facts in sequence:

1. The assistant first tried `install_skill_from_library` for `pptx` and related names and failed because the Skill was not in the Kosmos Skill Library.
2. The assistant later created or copied local Skill files directly into the user's profile Skill directory, including `pptx` and `pptx-design-system`.
3. The assistant later verified the physical files existed on disk.
4. The assistant ran `get_skill_installation_state` for `pptx` and `pptx-design-system`, and both returned `NotAdded` with the message that the Skill was not added to the profile's global Skill list.
5. The assistant explicitly concluded that the problem was "missing global registration of the skill" and that Agent-level binding existed without global registration.

### 2.2 Product conclusion

The user chat reflects a real product issue, not merely a mistaken user expectation.

The missing capability is not a new special-case registration screen. The missing capability is a universal local install flow.

Kosmos needs one `Add Skill From Device` capability that can accept:

1. `.zip`
2. `.skill`
3. `folder`

All three must be validated against the same Skill package standard and end in the same formal registration flow into `profile.skills`.

## 3. Problem Statement

Kosmos can physically host a Skill on disk without recognizing it as installed.

This happens when a Skill is introduced through non-standard means such as:

1. AI cloning or downloading a public Skill repository
2. AI writing Skill files directly into `profiles/<alias>/skills/<name>/`
3. users manually copying or unpacking a Skill folder
4. Agent config being updated to reference a Skill name before formal registration is complete

In these cases, the system becomes inconsistent across three layers:

1. Disk layer: Skill files exist
2. Registry layer: `profile.skills` does not contain the Skill
3. Agent layer: `chat.agent.skills` may already reference the Skill

The result is confusing behavior:

1. the Skill may appear to exist in the file system
2. the Agent may appear bound to it
3. the Skills UI still hides it
4. runtime resolution still skips it
5. the user may reach `No valid skills configured for this agent.` or silently lose expected Skill behavior

## 4. Product Decision

Kosmos will support public and locally sourced Skills through one formal rule:

Any Skill that should be usable must pass through a managed install flow that ends in `profile.skills`.

To support real-world usage, Kosmos will extend the existing `Add Skill From Device` concept into a single universal device-install capability.

That unified flow will support:

1. `.zip`
2. `.skill`
3. `folder`

Recommended rollout:

1. MVP: extend `Add Skill From Device` to support `.zip`, `.skill`, and `folder`
2. Phase 2: make chat/file-path initiated installation reuse the same unified backend
3. Phase 3: improve missing-Skill detection and repair UX when Agent bindings reference unmanaged Skills

## 5. Goals

### 5.1 Product Goals

1. Make public Skill usage a supported workflow rather than an accidental side effect.
2. Ensure a Skill copied or generated on disk can be formally registered without manual JSON surgery.
3. Eliminate the inconsistent state where disk files and Agent binding exist but global registration does not.
4. Keep `profile.skills` as the single installed-skill authority.
5. Ensure both `Add Skill From Device` and `Apply Skill To Agents` exist as UI actions and built-in tools.

### 5.2 User Goals

1. "If I or the AI fetch a public Skill from the web, I want it to become usable in Kosmos."
2. "If a Skill is on my device as a zip, a .skill file, or a folder, I want one install entry to handle it."
3. "After installation, I want to apply the Skill to the Agents I choose."
4. "If an Agent references a missing Skill, I want the product to help me repair it instead of failing silently."

### 5.3 Non-Goals

1. Treat any folder on disk as auto-installed without validation.
2. Execute arbitrary public Skill code without user trust and approval.
3. Replace `profile.skills` with file-system discovery as the runtime source of truth.
4. Fully automate dependency installation for arbitrary third-party Skills in MVP.

## 6. Users and Scenarios

### 6.1 Primary Scenarios

1. A user asks the AI to install a public Skill from GitHub or another website.
2. The AI downloads or assembles a Skill folder locally.
3. The user runs `Add Skill From Device` against that local artifact.
4. The user or the AI applies the newly installed Skill to one or more Agents.

### 6.2 Repair Scenarios

1. A Skill folder already exists under the profile Skill directory, but `get_skill_installation_state` is `NotAdded`.
2. An Agent already references a Skill name that is missing from `profile.skills`.
3. A generated file card or workspace path points to a Skill folder or `SKILL.md`, and the user wants a one-click install or repair path.

### 6.3 Explicitly Supported Device Inputs

1. Local `.zip` package
2. Local `.skill` package
3. Existing local Skill folder
4. Existing `SKILL.md` entry point whose parent folder is a valid Skill folder

Built-in library install remains supported as a separate product surface.

## 7. Current Product Gaps

### 7.1 Add Skill From Device Is Too Narrow

Current UI supports local package import, but `Add Skill From Device` only accepts `.zip` and `.skill`, not an already prepared Skill folder.

### 7.2 Missing Unified Validation

Kosmos validates package-based installs, but it does not expose the same standards-based validation for folder-based local artifacts.

### 7.3 Agent/UI Mismatch

Agent binding can preserve missing Skill names, while the Agent Skills UI only shows globally registered Skills. This makes a bound-but-unregistered Skill effectively invisible.

### 7.4 Public Skill Workflow Stops Too Early

The AI can already search, clone, copy, and write files, but there is no last-mile product action that turns those files into a formally installed Skill through the same path as local package install.

## 8. Proposed Solution

### 8.1 MVP Solution

Extend `Add Skill From Device` into one universal install flow.

The flow will:

1. accept `.zip`, `.skill`, or `folder`
2. normalize the input into a validated Skill root
3. validate the Skill package structure and required SKILL format
4. normalize the canonical Skill file path to `SKILL.md`
5. place the Skill into the canonical profile directory if needed
6. register or update the Skill in `profile.skills`
7. invalidate affected chat Skill snapshots
8. refresh the Skills UI and surface a success result
9. immediately offer the existing `Apply Skill To Agents` flow with the installed Skill name

The product requirement is:

1. `Add Skill From Device` must be available as UI and built-in tool
2. `Apply Skill To Agents` must be available as UI and built-in tool

This MVP solves the incident directly because it closes the gap between "files exist" and "Skill is installed" while staying within a single, reusable product concept.

### 8.2 Phase 2 Enhancements

Add a higher-level public Skill install flow that can work from:

1. GitHub repository or folder URL
2. direct download URL
3. workspace folder already created by the AI

The key design rule is that these are acquisition flows only. They still must end in the same `Add Skill From Device` backend as MVP.

### 8.3 Repair UX

When Kosmos detects this mismatch:

1. Agent references Skill name
2. `profile.skills` does not contain it
3. matching folder exists on disk

Kosmos should offer a repair action that still reuses the same installation semantics, for example:

1. `Add Skill From Device`
2. `Repair Skill Registration`

## 9. Experience Requirements

### 9.1 Settings UX

Settings -> Skills should offer clear install choices:

1. Add from Library
2. Add Skill From Device
3. Later: Install from URL

`Add Skill From Device` must support:

1. `.zip`
2. `.skill`
3. `folder`

### 9.2 Chat UX

If the AI presents a valid Skill artifact, the chat surface should expose installation when possible.

Supported install affordances should eventually include:

1. `.skill`
2. `.zip`
3. `SKILL.md`
4. valid Skill folder path

### 9.3 Post-Install Agent Binding UX

After a successful new install, Kosmos should offer the existing `Apply Skill To Agents` flow so the user can bind the Skill to chosen Agents immediately.

`Apply Skill To Agents` must also be invokable by the AI through a built-in tool, not only through renderer events.

### 9.4 Repair UX

If an Agent contains missing Skill references, the UI should make that state visible and recoverable.

Minimum acceptable product behavior:

1. show the missing Skill name somewhere the user can see it
2. offer a repair action when a candidate disk folder exists

## 10. Functional Requirements

### 10.1 Must Have

1. Extend `Add Skill From Device` to accept `.zip`, `.skill`, and `folder`.
2. Accept either a folder path or `SKILL.md` path when the source is folder-based.
3. Validate metadata and folder naming before registration.
4. Normalize file casing to canonical `SKILL.md` during managed install or repair.
5. Refresh affected chats on the next turn through the existing Skill snapshot invalidation path.
6. Refresh the renderer Skills list after successful registration.
7. Support overwrite or update when the same Skill name already exists.
8. Preserve `profile.skills` as the only runtime-installed registry.
9. Trigger the existing `Apply Skill To Agents` flow after successful new install.
10. Provide `Add Skill From Device` as a built-in tool for AI-led installation.
11. Provide `Apply Skill To Agents` as a built-in tool for AI-led agent binding.

### 10.2 Should Have

1. Offer repair from Agent-missing-Skill state.
2. Expand file-card install support beyond `.skill` packages.
3. Show dependency or executable-content warnings for third-party Skills.
4. Record analytics distinguishing library install, package install, folder install, and repair.

### 10.3 Won't Have in MVP

1. Full automatic dependency installation for arbitrary public Skills.
2. Automatic trust of every public GitHub Skill without confirmation.
3. Background file-system scanning that silently auto-registers unmanaged folders.

## 11. Success Criteria

1. A public Skill downloaded or assembled locally can be installed through `Add Skill From Device` without editing profile JSON.
2. A Skill folder already on disk can be installed or repaired through the same universal flow.
3. An Agent-bound Skill that exists on disk but is not registered no longer remains silently broken.
4. After formal registration, the Skill becomes visible in Skills UI and usable on the next turn.
5. After install, the user can immediately apply it to selected Agents using the existing apply dialog.
6. The AI can complete the same flow end-to-end using built-in tools without relying on hidden manual state.

## 12. Metrics

1. Number of successful device installs by format: `.zip`, `.skill`, `folder`
2. Number of successful repair registrations
3. Number of chats hitting missing Skill references before and after launch
4. Number of abandoned installs due to validation or trust warnings

## 13. Risks and Mitigations

### 13.1 Security Risk: Arbitrary Third-Party Skill Content

Mitigation:

1. validate package structure
2. show trust confirmation
3. warn on executable scripts and dependency manifests
4. do not auto-run post-install commands in MVP

### 13.2 Product Risk: Multiple Partial Install Paths Reappear

Mitigation:

1. require all flows to converge on one formal device-install API
2. keep `profile.skills` as the only installed-skill authority

### 13.3 Compatibility Risk: `skill.md` vs `SKILL.md`

Mitigation:

1. normalize to canonical `SKILL.md` on managed installation
2. tolerate both during repair detection when safe

## 14. Recommendation

The recommended solution is to extend `Add Skill From Device`, not create a separate folder-only feature.

Reason:

1. it directly solves the investigated incident
2. it matches the user mental model: one install entry for all local and public artifacts
3. it unlocks AI-assisted public Skill workflows immediately because the AI can already fetch or write local files
4. it preserves a single authority for installed Skills
5. it is smaller and safer than building a full public marketplace flow first

In short:

1. First make `Add Skill From Device` universal.
2. Then make public acquisition easier on top of that.