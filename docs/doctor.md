<!-- Last verified: 2026-04-27 (added get_crash_status / read_crash_bundle / read_schedules tools, filling crash and scheduling diagnostic coverage, complementing exportDebugInfo content) -->
# Doctor Subsystem

> In-app self-diagnostic system: the user describes a problem in the UI → the background Doctor Agent automatically collects runtime context → automatically generates a GitHub Issue. A Coding Agent will later be connected to close the loop with automatic fixes.

---

## 1. Background and Goals

### 1.1 What Problem Does This Solve?
Pain points of traditional bug reporting:
- Vague user descriptions, missing reproduction paths
- Reports lack runtime information (logs, version, session context), requiring developers to repeatedly ask follow-up questions
- Reports scattered across multiple channels, unable to form structured data that AI can process

Doctor performs "frontline analysis" within the app:
- Form constraints guide user input; optional screenshot attachment
- App directly reads its own logs, session, and environment information
- LLM analyzes combined evidence → outputs a structured GitHub Issue
- The entire process runs in the background on the user's local machine without blocking foreground operations

### 1.2 Phase 2 Vision
This phase solves "bug reporting"; the next phase connects a Coding Agent:
- Local polling of GitHub Issues → Coding Agent auto-fixes → submits PR
- Forms a complete loop: "user reports → AI diagnoses → AI fixes → user verifies"

### 1.3 Naming Convention (Important)
Use **Doctor** consistently for both external and internal references:
- User perspective: the doctor is diagnosing the application
- Developer perspective: all code, files, IPC channels, and log prefixes use `doctor` / `Doctor`
- Legacy names `feedback` / `selfDebug` have been fully removed; do not use them in new code

---

## 2. Architecture Overview

### 2.1 Three-Part Responsibilities

```
┌────────────────────── Renderer ──────────────────────┐
│  Step1: DoctorInquiry  ─┐                            │
│  (form atom)            │                            │
│                         │ submit                     │
│                         ▼                            │
│  Step2: DoctorStatusIndicator   ◄── stepInfo / status│
│  (analyze atom + popover)       ◄── question         │
└──────────────────────────────────────────┬───────────┘
                                           │ IPC
┌──────────────────── Main ────────────────▼───────────┐
│  DoctorManager ── mutex/state machine/event broadcast │
│        │                                              │
│        └─► DoctorAgentRunner ── minimal ReAct loop   │
│                  │ ┌── llmClient (GHC SSE)            │
│                  │ └── toolExecutor                   │
│                  │            ├── 5 built-in tools    │
│                  │            └── ask_user_question   │
│                  ▼            (pauses via manager)    │
│            doctor.log.md (overwritten each run)       │
└───────────────────────────────────────────────────────┘
```

### 2.2 Key Design Decisions

| Decision | Choice | Reason |
|------|------|------|
| Reuse AgentChat system? | **No**, build minimal runner | AgentChat is tightly coupled to profileCacheManager (getLatestAgentConfig private), cannot inject custom config; Doctor requirements are lightweight |
| Use MCP? | **No**, tools use direct name→handler mapping | Tool set is small and fully local; using MCP adds process boundary and serialization overhead |
| Persist session? | **No**, in-memory only | Doctor is a one-time diagnostic; should not pollute the user's chat session list |
| Allow concurrent tasks? | **Mutex**, only one task globally | Avoid log write contention / user being disturbed by multiple popovers simultaneously |
| stepInfo pushed by LLM or runner? | **Runner auto-pushes** | Simple and reliable, doesn't depend on LLM cooperation; maps text from toolName |
| Q&A UI form | **Popover anchored to indicator, forced non-closable** | Prevents users from accidentally closing and missing agent questions; Q&A and status are co-located in one focused point |
| Form close strategy | **Close preserves state / Discard clears state** | Users may switch windows mid-form to reproduce the issue, then return to continue filling |

---

## 3. File Structure

```
src/
├── shared/ipc/
│   └── doctor.ts                          # IPC types + channel connectors (render↔main contract)
│
├── main/
│   ├── startup/ipc/
│   │   ├── doctor.ts                      # IPC handler registration
│   │   └── index.ts                       # calls handleDoctorIPC(ctx)
│   │
│   └── lib/doctor/
│       ├── manager.ts                     # DoctorManager — external interface/mutex/state broadcast/Q&A coordination
│       ├── agentConfig.ts                 # model/MAX_TURNS/tool list/System Prompt (APP_INTRO_L1 prepended at top)
│       ├── appKnowledge.ts                # APP_INTRO_L1 (prepended to system prompt) + APP_DETAIL_L2 (returned by get_app_knowledge)
│       ├── agentRunner.ts                 # minimal ReAct loop; constructor accepts pushStepInfo callback
│       ├── toolExecutor.ts                # name→handler dispatch
│       ├── llmClient.ts                   # GHC /chat/completions SSE client, exports callDoctorLlm
│       ├── log.ts                         # debug log: clear/append doctor.log.md
│       ├── logQuery/                      # log parsing/filtering/formatting pure functions (shared with scripts/log-query.ts)
│       │   ├── parser.ts                  # parseLine + LogEntry + time parsing
│       │   ├── filter.ts                  # buildGrepMatcher / globMatch / matchesFilter
│       │   ├── format.ts                  # formatEntry / formatStats / formatSources / staleness header
│       │   └── index.ts                   # barrel
│       ├── chatSession/                   # session reading L1 skeleton / L2 detailed read pure functions
│       │   ├── skeletonFormatter.ts       # ChatSessionFile → markdown skeleton (4+ tables, long content shown as length numbers only)
│       │   ├── messageReader.ts           # fetch N Messages by index, long fields truncated 60% head + 40% tail
│       │   ├── truncate.ts                # shared truncator
│       │   └── types.ts                   # HistoryView ('ui'|'llm') and other internal types
│       └── tools/
│           ├── getAppInfo.ts              # version/platform/memory/uptime/userData path
│           ├── getAppKnowledge.ts         # no params; returns APP_DETAIL_L2 entire markdown block
│           ├── readAppLogs.ts             # recent log file tail N lines
│           ├── readChatSession.ts         # L1: returns session skeleton markdown
│           ├── getChatMessages.ts         # L2: read up to 10 raw messages by index
│           ├── getCrashStatus.ts          # L1: last crash + recentBundles + minidumps metadata (no params)
│           ├── readCrashBundle.ts         # L2: read a single crash bundle by bundleName
│           ├── readSchedules.ts           # current user schedules list/details (only when bug involves scheduled tasks)
│           ├── createGithubIssue.ts       # mock create Issue (pending real API)
│           └── askUserQuestion.ts         # pause agent → push question → wait for user answer
│
├── preload/
│   ├── doctor/invoke.ts                   # expose doctor.invoke method allowlist
│   └── main.ts                            # ElectronAPI registers doctor namespace
│
└── renderer/
    ├── ipc/doctor.ts                      # doctorApi / doctorEvents wrappers
    ├── states/doctor.atom.ts              # doctorInquiryAtom + doctorAnalyzeAtom
    └── components/
        ├── doctor/
        │   ├── DoctorInquiry.tsx          # Step1 form dialog (globally mounted)
        │   ├── DoctorStatusIndicator.tsx  # Step2 status indicator + tooltip + popover
        │   └── AgentQuestionForm.tsx      # Q&A form embedded in popover (no container)
        └── layout/
            ├── UserMenu.tsx               # "Report Bug" menu item → doctorInquiryAtom.show()
            └── UserSection.tsx            # renders DoctorStatusIndicator + DoctorInquiry
```

> Debug log location: `doctor.log.md` in the project root, cleared before each runner run.
> Use `bun scripts/log-query.ts --grep "DoctorAgent,MOCK"` to also query doctor records in the unifiedLogger.

---

## 4. IPC Contract (`src/shared/ipc/doctor.ts`)

### 4.1 Data Types

```typescript
interface DoctorInquiryPayload {
  description: string;          // A required
  stepsToReproduce: string;     // B required (can be "I'm not sure")
  agentId?: string;             // C: = chatId when specific agent selected; undefined when 'Not related to agent'
  chatSessionId?: string;       // D: session id when specific session selected; undefined when 'Not related to session'
  screenshots?: ScreenshotAttachment[]; // E: raw bytes, passed through IPC via structured clone
}

interface ScreenshotAttachment {
  name: string;
  mimeType: string;        // e.g. 'image/png'
  bytes: Uint8Array;       // raw binary; main process re-encodes as base64 for LLM
}

type DoctorTaskState =
  | 'pending' | 'analyzing' | 'creating_issue'
  | 'waiting_for_user' | 'done' | 'error';

interface DoctorTaskStatus { taskId: string; state: DoctorTaskState; issueUrl?: string; error?: string }
interface DoctorStepInfoPayload { taskId: string; stepInfo: string }

type QuestionInputType = 'single_select' | 'multi_select' | 'text';
interface AgentQuestion { id; text; inputType; options?; placeholder?; required? }
interface AgentQuestionPayload { taskId: string; questions: AgentQuestion[] }
interface AgentAnswerPayload { taskId: string; answers: Record<string, string | string[]> }
```

### 4.2 Channels

| Channel | Direction | Purpose |
|---------|------|------|
| `doctor:submitDoctorInquiry` | R → M | Submit diagnostic request; reject if already running |
| `doctor:submitAgentAnswer` | R → M | User submits answer in popover |
| `doctor:doctorTaskStatusChanged` | M → R | Task state machine change broadcast |
| `doctor:doctorStepInfo` | M → R | Step description pushed by runner (drives tooltip) |
| `doctor:doctorAgentQuestion` | M → R | LLM-triggered question (drives popover) |

> Naming convention: channel namespace is always `doctor`; event name prefix `doctor*`; do not fall back to `feedback*`.

---

## 5. Renderer Design

### 5.1 State Atoms (`states/doctor.atom.ts`)

Two atoms with strict separation of concerns:

#### `doctorInquiryAtom` — Step1 Form State Machine

```
type: 'idle' ── show() ──► 'idle-show' ── submit() ──► 'pending'
   ▲                          │  │                       │
   │ hide()                   │  │ hide() (preserve form)│
   │                          │  ▼                       │
   └── discard() (clear form) ◄┘                         │
                                                         │
                  _onAnalyzeFinished()  ◄── analyzeAtom calls on done/error
                  (reset to 'idle' + zeroForm)
```

Key actions:
- `show()` / `hide()` — show/hide dialog (both rejected in pending state)
- `discard()` — user actively abandons, clears form
- `updateForm(draft => ...)` — immer-style update of individual fields
- `submit()` — validate → go pending → IPC; revert to idle-show with error on failure
- `_onAnalyzeFinished()` — **private convention**: only called by analyzeAtom on terminal state, fully resets inquiry

Special constants:
- `NONE_OPTION = '__none__'` — "not related" sentinel value in agent/session selectors
- `UNSURE_TEXT = 'I\'m not sure'` — text for the one-click fill button

#### `doctorAnalyzeAtom` — Step2 Runtime State

Fields: `status` / `taskId` / `stepInfo` / `stepInfoAt` / `question` / `issueUrl` / `error`

- `setStatus(taskId, state, extras?)` — called on status change; entering `done`/`error` automatically calls back `inquiry._onAnalyzeFinished()` to reset the form
- `setStepInfo(taskId, stepInfo)` — writes stepInfo and timestamps (drives tooltip auto-show for 2s)
- `setQuestion(payload)` / `clearQuestion()` — show/hide popover
- `dismiss()` — user actively dismisses indicator on done/error

> **Important**: The atom file itself does not subscribe to IPC; side effects are centrally registered when `DoctorStatusIndicator` mounts, subscribing to three channels → calling actions. This keeps atom modules pure, avoiding side effect hanging in SSR/HMR.

### 5.2 Components

#### `DoctorInquiry.tsx`
- 6-field form (A-F), all read/written from atom
- C (agentId) gets list from `useChats().chats`; D is only rendered when a specific agent is selected
- D (chatSessionId) reads directly from `chats[i].chatSessions` (included in `ChatConfigRuntime`), no new IPC needed
- F (screenshots) supports file upload + `navigator.clipboard.read()` paste
- Three buttons: **Discard** (discard) / **Close** (hide, preserves state) / **Submit** (submit)
- Real-time submit availability computed via `actions.isValid()`

#### `DoctorStatusIndicator.tsx`
- Always mounted (in `UserSection`), but `return null` when `analyze.status === 'idle'`
- Subscribes to `doctorTaskStatusChanged` / `doctorStepInfo` / `doctorAgentQuestion` once on mount, cleans up on unmount
- Three visual states:
  - Loading (pending/analyzing/creating_issue/waiting_for_user) → rotating ring + pulse dot
  - done → green checkmark, click to open issueUrl
  - error → red exclamation mark
- Tooltip triggers:
  - Automatic: shows for `TOOLTIP_AUTO_MS=2000` ms after `stepInfoAt` changes
  - Manual: hover
  - Does not show tooltip when question exists (cedes space to popover)
- Popover trigger: shows `<AgentQuestionForm>` when `analyze.question` exists; popover container has no close interaction (must answer)

#### `AgentQuestionForm.tsx`
- Renders form only, no dialog/popover container (container provided by indicator)
- After submit: `doctorApi.submitAgentAnswer(...)` → on success `analyzeActions.clearQuestion()` actively closes

### 5.3 Global Mount Point
`UserSection.tsx` mounts both `<DoctorStatusIndicator />` and `<DoctorInquiry />`:
- Must be mounted at a higher level than `UserMenu`, because UserMenu unmounts on close and anything mounted inside it disappears

---

## 6. Main Process Design

### 6.1 `DoctorManager` (Singleton)

Responsibilities:
1. **Mutex control** — `_isRunning` field; `submitInquiry()` rejects concurrent calls on start
2. **State machine ownership** — `tasks: Map<taskId, DoctorTaskStatus>`; each `updateStatus()` simultaneously broadcasts to all BrowserWindows
3. **stepInfo forwarding** — `pushStepInfo(taskId, text)` directly broadcasts `doctorStepInfo` event; injected into runner
4. **Q&A coordination** — `askUserQuestion()` pushes `doctorAgentQuestion` → stores resolver in `questionResolvers` map → `receiveAnswer()` triggers resolver; includes 5-minute timeout
5. **Task orchestration** — `runAgent()` instantiates `DoctorAgentRunner` and injects `pushStepInfo` closure

Key API:
```typescript
submitInquiry(payload): Promise<{ taskId }>
pushStepInfo(taskId, stepInfo): void                    // used by runner
askUserQuestion(taskId, questions[]): Promise<answers>  // used by tools
receiveAnswer(taskId, answers): void                    // used by IPC handler
```

### 6.2 `DoctorAgentRunner` (One-time Instance)

Constructor: `new DoctorAgentRunner(pushStepInfo: (text: string) => void)`

`run(payload, taskId)` main loop (minimal ReAct):

```
clearDebugLog()
push("Preparing analysis...")
messages = [system, userBugReport(including screenshots)]

for turn in 0..MAX_TURNS:
  push(turn === 0 ? "Thinking..." : "Continuing analysis...")
  resp = callDoctorLlm(messages, TOOL_DEFINITIONS)   ← SSE blocking read complete
  messages.push(assistant_msg)

  if resp.toolCalls.length === 0: break              ← termination condition

  for tc in resp.toolCalls:
    push(TOOL_STEP_INFO[tc.name] ?? `Executing ${name}...`)
    result = executeTool(tc.name, parsedArgs, { taskId })
    if name === 'create_github_issue': extract issueUrl
    messages.push(tool_msg)

return issueUrl ? { success: true, issueUrl } : { success: false, error }
```

`TOOL_STEP_INFO` text mapping at top of runner:
- `get_app_info` → Collecting runtime environment info...
- `get_app_knowledge` → Loading app knowledge base...
- `read_app_logs` → Reading app logs...
- `read_chat_session` → Analyzing chat history...
- `ask_user_question` → Waiting for user response...
- `create_github_issue` → Generating diagnostic report...

### 6.3 `llmClient.ts`

- Single function `callDoctorLlm(messages, tools): Promise<{ content, toolCalls, finishReason }>`
- Uses `mainAuthManager.getCurrentAuth().ghcAuth.copilotTokens.token`
- Endpoint selected via `getEndpointForModel(DOCTOR_MODEL)`
- Streams SSE, reduces `delta.content` / `delta.tool_calls` (concatenates tool_call increments by `index`)
- Exposes `ChatMessage` / `ToolCall` / `LlmResponse` types, consumed directly by runner

### 6.4 Tool Set

Each tool file exports `xxxToolDef` (OpenAI function calling schema) + `executeXxx(args)`.

| Tool | Input | Behavior |
|------|------|------|
| `get_app_info` | — | Returns version/platform/memory/uptime/`userData`/`logs.{dir,mode,currentFile,currentFileStartedAt,currentFileSizeBytes}`. `logs.mode` is `dev-per-launch` or `prod-daily`, letting LLM understand log scope when interpreting `read_app_logs scope="current"` results |
| `get_app_knowledge` | — | Returns `appKnowledge.APP_DETAIL_L2` entire markdown block: core concepts, subsystem responsibilities, Renderer structure, IPC conventions, symptom→subsystem quick reference, product boundaries. LLM already has L1 overview in system prompt; only call when deeper understanding of a subsystem is needed. No params, and should only be called once (same fixed document) |
| `read_app_logs` | `mode: 'stats'\|'sources'\|'entries'` (required), `source?`(glob), `level?`(array), `grep?`(supports `+`/`,`/`!`/`/regex/`), `from?`/`to?`, `limit?=50`(hard cap 200), `scope?='current'\|'all'` | Three-mode log query; entries mode includes staleness header + scope notice + truncation hint. `scope='current'` in dev = this launch's `kosmos-dev-*.log`, in prod = today's `kosmos-YYYY-MM-DD.log` (dev isolates by launch after PR #575); falls back by mtime if current file not found and explains in header. **LLM should iterate**: stats first for overview → entries to narrow → grep to pinpoint. Reuses `src/main/lib/doctor/logQuery/` and `unifiedLogger/FileOperations` |
| `read_chat_session` | `agentId`, `chatSessionId` | **L1: returns session skeleton markdown** (Header KV + chat_history / context_history each with a messages/parts/toolCalls table + interaction_history table). All fields preserved; `text`/`thinking`/`tool_calls.arguments`/image base64 url shown only as length numbers, no original content. LLM uses skeleton to locate suspect indices, then must call `get_chat_messages`. Reuses `chatSessionStore.ensureLoaded(alias, agentId, sessionId)` |
| `get_chat_messages` | `agentId`, `chatSessionId`, `messageIndices: number[]`(≤10), `view?: 'ui'\|'llm' = 'ui'` | **L2: read raw messages by skeleton index**. Returns JSON `{ view, results: [{ index, status, message?, note? }] }`. Long fields truncated 60% head + 40% tail: text/thinking 5KB, tool result 10KB, tool_call arguments 3KB; image url replaced with `[image: name W×H sizeKB]` placeholder. `view='llm'` looks up in context_history by id/timestamp; `status: 'dropped'` if not found (message was compressed away — itself a diagnostic signal) |
| `get_crash_status` | — | **L1**: reuses `crashCaptureManager.getStatus()` + scans `{userData}/crashes/`, `{userData}/Crashpad`(depth 2). Returns `hasRecoveredCrash` + `recoveredCrash` summary + most recent ≤10 `recentBundles` (name / eventType / capturedAt / appVersion / totalSizeBytes) + ≤10 `minidumps` (name / sizeBytes / mtime, **contents not read**). **Always** call once. Non-overlapping with `get_app_info` fields (no longer returns version/platform etc.) |
| `read_crash_bundle` | `bundleName: string` | **L2**: read a single bundle by name, output hard-capped at ~12KB markdown. Includes manifest / event (or recovered-crash) / system summary (excluding versions.* since already in get_app_info) / last 30 breadcrumbs (each metadata ≤200 chars) / recent-main.log last 80 lines (single line ≤500 chars). Path validation prevents traversal. **Note**: log comes from pre-crash session, non-overlapping with `read_app_logs` |
| `read_schedules` | `mode: 'list'\|'detail'`, `scheduleId?` | Current user's SchedulerJobs under `{userData}/profiles/<alias>/schedules/`. list = markdown table, ≤50 rows, includes skeleton columns (msg.len / msg.lines / msg.firstLine preview / desc.len) + runtime-state header; detail = single job's `message` (truncated 2KB) + `description` (truncated 512 chars) + cold-start catch-up. Two-level mode: list to locate → detail to read. **Only call** when user description involves scheduled tasks/cron/trigger issues |
| `create_github_issue` | `title`, `body`, `labels?` | mock: write log → return fake issue url; labels auto-append `bug`, `user-feedback` |
| `ask_user_question` | `questions: AgentQuestion[]` | Pause via `DoctorManager.askUserQuestion()` → wait for answer → return `{ answers }` |

`alias` is always obtained from `mainAuthManager.getCurrentAuth().ghcAuth.alias`.

### 6.5 Config (`agentConfig.ts`)

- `DOCTOR_MODEL = 'claude-sonnet-4.6'`
- `MAX_TURNS = 10`
- `TOOL_DEFINITIONS = [...6 items]`
- `SYSTEM_PROMPT` — **APP_INTRO_L1 prepended at top** (app L1 overview: core capabilities + Electron multi-process architecture + multi-brand), followed by strict four-phase workflow (Collect / Analyze / Clarify / Create Issue), with detailed Issue Body template and quality standards
  - **Phase 3 (Clarify) is for proactively filling evidence gaps**, not a last resort: when evidence is insufficient for a developer to locate/reproduce the issue, **must** call `ask_user_question`. Typical triggers:
    - UI/visual/interaction issue but no screenshot, and no log clues
    - Vague description ("not working", "stuck") missing specific symptoms
    - Reproduction steps say "I'm not sure" and logs show no trigger point
    - Multiple plausible root causes that need disambiguation from user
    - Possibly environment-related, need to confirm scope
  - Counter-example: if the first round already has "specific description + clear steps + screenshot or matching logs", **do not** ask follow-up questions just to appear diligent
  - Hard cap: **at most 2 clarification rounds per run**; after that, proceed to Create Issue with known info and note remaining unknowns in Analysis section

---

## 7. Data Flow (End-to-End Sequence)

### 7.1 Normal Flow (No Q&A)

```
User clicks Report Bug
  → UserMenu.onReportBug() → doctorInquiryAtom.show()
  → DoctorInquiry renders form
User fills out + submits
  → inquiryAtom.submit() → doctorApi.submitDoctorInquiry(payload)
    → IPC: doctor:submitDoctorInquiry
      → DoctorManager.submitInquiry()
        → updateStatus(taskId, 'pending')  ◄── broadcast doctorTaskStatusChanged
        → async runAgent():
            updateStatus('analyzing')
            new DoctorAgentRunner(pushStepInfo).run(payload, taskId)
              loop {
                pushStepInfo('Thinking...')   ◄── broadcast doctorStepInfo
                callDoctorLlm(...)
                if toolCalls:
                  pushStepInfo(TOOL_STEP_INFO[name])   ◄── broadcast
                  executeTool(...)
                if create_github_issue succeeds → extract issueUrl
              }
            updateStatus('done', issueUrl)   ◄── broadcast
            → analyzeAtom.setStatus('done') → inquiryAtom._onAnalyzeFinished()
      ← _isRunning = false
Renderer components update in real-time based on atom; indicator auto-dismisses after 10s on done
```

### 7.2 Flow With Q&A

LLM calls `ask_user_question` in the loop:
```
executeTool('ask_user_question')
  → DoctorManager.askUserQuestion(taskId, questions)
    → updateStatus('waiting_for_user')   ◄── broadcast
    → broadcast doctorAgentQuestion
    → register resolver; return Promise (5min timeout)
DoctorStatusIndicator receives question → analyzeAtom.setQuestion(p)
  → render popover (AgentQuestionForm)
User answers → AgentQuestionForm.handleSubmit()
  → doctorApi.submitAgentAnswer({ taskId, answers })
    → IPC: doctor:submitAgentAnswer
      → DoctorManager.receiveAnswer()
        → resolver(answers)
        → updateStatus('analyzing')
ask_user_question Promise resolves → tool result queued → loop continues
analyzeAtom.clearQuestion() → popover disappears
```

### 7.3 Error Flow

Any exception → `updateStatus(taskId, 'error', undefined, msg)` → broadcast → indicator shows red exclamation mark → auto-dismisses after 10s, inquiry form resets.

---

## 8. Common Change Scenarios

### 8.1 Add a New Tool
1. Create `xxx.ts` under `src/main/lib/doctor/tools/`, export `xxxToolDef` + `executeXxx`
2. Append to `TOOL_DEFINITIONS` array in `agentConfig.ts`
3. Register in `handlers` in `toolExecutor.ts`
4. Add a one-line step text description to `TOOL_STEP_INFO` in `agentRunner.ts`
5. If needed, explain in the `SYSTEM_PROMPT` Workflow section when to call it

### 8.2 Add a Step1 Form Field
1. Add field to `DoctorInquiryPayload` in `shared/ipc/doctor.ts`
2. Add field to `InquiryForm` + `zeroInquiryForm` in `states/doctor.atom.ts`; include in `submit()` payload construction; add to `isValid()` if needed
3. Render the corresponding control in `DoctorInquiry.tsx`, update via `actions.updateForm(f => { ... })`
4. Include field in `agentRunner.buildUserMessage()` text sent to LLM

### 8.3 Replace Mock with Real Implementation
- **Real GitHub Issue creation**: Replace mock section in `tools/createGithubIssue.ts`; call GitHub REST API using `GITHUB_FEEDBACK_PAT` env var; return the real URL — runner needs no changes

### 8.4 Adjust State Machine Text
- Runner auto-pushes: change `TOOL_STEP_INFO` and `'Thinking...'` / `'Continuing analysis...'` literals in `agentRunner.ts`
- Do not ask the LLM to push stepInfo in the prompt — that is the runner's sole responsibility

### 8.5 Change Q&A UI Form
- The form itself: `AgentQuestionForm.tsx`
- The container (popover): `popoverStyle` and `popoverVisible` rendering branch in `DoctorStatusIndicator.tsx`
- **Do not make the popover closable** — the design contract requires a forced response; otherwise the LLM will be stuck at `ask_user_question` for the 5-minute timeout

---

## 9. TODO

1. **Connect real GitHub API** — `createGithubIssue` is currently mocked; replace implementation and authenticate via `GITHUB_FEEDBACK_PAT`
2. **Session source upload (on hold)** — restore `upload_chat_session` tool and `uploadSession` form field once a reliable CDN is available (a mock was implemented previously, see git history)
3. **Screenshot embedding in Issue** — LLM currently converts images to text; an option is "upload to image host first, then embed as ![](url) in body"
4. **Error recovery** — Manager does not retry LLM temporary network failures; needs simple backoff retry
5. **Phase 2: Coding Agent loop** — local polling of GitHub Issues → Coding Agent fixes → PR
