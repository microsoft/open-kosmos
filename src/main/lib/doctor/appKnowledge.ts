/**
 * Hard-coded "app knowledge" text used by the Doctor Agent.
 *
 * - APP_INTRO_L1: a tight product overview, prepended to SYSTEM_PROMPT so the Doctor has the
 *   minimal product/architecture context before analyzing any bug.
 * - APP_DETAIL_L2: a more detailed feature/architecture expansion, returned by the
 *   `get_app_knowledge` tool on demand.
 *
 * ⚠️ Maintenance rule (important):
 *   The Doctor Agent runs **on the user's client** and **cannot see the source code**. These two
 *   blobs must NOT mention any source paths, class names, file names, function names, SDK names,
 *   table names, or any other concrete implementation pointers — the LLM can neither verify nor
 *   navigate them and will only hallucinate things like "see src/xxx". Only **user / product /
 *   conceptual** terminology is allowed here.
 *
 *   Writing test: treat these blobs as a verbal product walkthrough you'd give a new hire — only
 *   say what fits on the slides, never what only shows up in the IDE.
 */

export const APP_INTRO_L1 = `## About This Application (required background)

**OpenKosmos AI Studio** is a desktop AI assistant. Users can create, configure, and chat with multiple "AI Agents" inside it. Each Agent is independently customizable: its own system prompt, chosen model, available toolset, and independent long-term memory.

Core capabilities:
- **Multi-Agent management**: multiple Agents can be created within the same application, each with independent session history, configuration, and memory.
- **Tool calling**: Agents can call external tools — web search, local file read/write, shell commands, browser automation, etc.
- **Long-term memory**: Agents continuously remember user preferences and facts across multiple conversations.
- **Sub-agents**: Agents can spawn sub-agents to execute subtasks in parallel.
- **Streaming conversation**: AI responses are delivered token by token in real time.
- **Rich media**: supports voice input/output, screenshot attachments, code snippets, etc.

Application form (desktop app, multi-process):
- **Background process**: handles account, conversation orchestration, tool runtime, local data storage, and logging. Not visible to the user.
- **UI process**: renders the interface — session list, conversation view, Agent editor, settings panel, etc. The part the user directly interacts with.
- The two communicate via **inter-process communication (IPC)**: the UI sends commands to the background, and the background pushes state/data/streaming chunks back to the UI.

The application supports multi-brand deployment (the same product can be delivered under different brands, with minor feature differences).

> This is the L1 overview. If you need a more in-depth understanding of **a specific subsystem** while analyzing a bug (e.g. how a conversation flows from user input to the UI, why a tool call might hang, why memory might be lost), call \`get_app_knowledge\` to get the L2 detailed description.
`;

export const APP_DETAIL_L2 = `# OpenKosmos AI Studio — Detailed Features and Architecture (L2)

> This document is for the Doctor Agent, providing a more in-depth understanding of the system for bug diagnosis.
> It describes only **product form / conceptual model / data flow** — no implementation details.

---

## 1. Core Concepts from the User's Perspective

### 1.1 Agent
- "Agent" = a persisted configuration: name, avatar, system prompt, chosen model, temperature, available toolset, memory toggle, etc.
- Each Agent has its own independent **session list**.
- Users can have multiple Agents simultaneously, each serving a different role (coding assistant, writing assistant, researcher…).

### 1.2 Chat Session
- An Agent can have multiple sessions (similar to the session list on the left side of common AI products).
- Each session maintains two histories internally:
  - **chat_history**: the complete conversation flow visible to the user in the UI — all user messages, AI replies, tool calls and results.
  - **context_history**: the actual context sent to the LLM. It is periodically trimmed by the **context compression** mechanism — older messages may be replaced by summaries or dropped entirely.
- "AI gives off-topic answers / AI forgets things" bugs typically mean the relevant messages in \`context_history\` have been compressed and dropped — verify using the \`view='llm'\` mode of the session inspection tool.

### 1.3 Tool Calling
- During a reply, an Agent may call tools. Each call produces a tool_call (with arguments) and a corresponding tool_result (with return value).
- Tools come from external "tool servers" loaded according to the Agent's configuration. Common tool sources: file system, shell, web search, browser automation, user-configured servers, etc.
- A tool call failing, timing out, or using incorrect parameter format → typically shows as: a tool_call exists in the session but its tool_result contains an error, or the tool_result never arrives.

### 1.4 Long-term Memory
- Based on vector retrieval: facts/preferences produced during user conversations are embedded and stored in a local database.
- At the start of the next conversation, relevant memories are recalled based on the current question and injected into the conversation context.
- "AI doesn't remember what I said about X" bugs may be caused by: memory not written, retrieval not finding it, or injection logic disabled/degraded.

### 1.5 Sub-agents
- An Agent can spawn sub-agents to process subtasks in parallel (e.g. a parent Agent having multiple sub-agents simultaneously retrieve from different sources).
- A sub-agent's conversation is separate from the parent's, but results flow back to the parent.

---

## 2. The Two Processes

The desktop app consists of two processes with a clear division of responsibilities:

\`\`\`mermaid
flowchart LR
    subgraph UI Process [UI Process Renderer]
        UI[UI Component Tree]
        State[Local State]
    end
    subgraph Background Process [Background Process Main]
        Auth[Account/Auth]
        Engine[Conversation Orchestration]
        ToolRT[Tool Runtime]
        Store[Local Data Store]
        Mem[Long-term Memory]
        Log[Log Center]
    end
    UI <-- IPC calls --> Engine
    UI <-- IPC event stream --> Engine
    Engine --> ToolRT
    Engine --> Mem
    Engine --> Store
    Auth -.token.-> Engine
    Engine --> Log
    ToolRT --> Log
\`\`\`

### 2.1 Mental Model for the Background Process
The background process is like a "service cluster" that exposes capabilities to the UI. It contains several relatively independent subsystems:

| Subsystem | What it does | Typical symptoms when broken |
|-----------|--------------|------------------------------|
| **Account/Auth** | Maintains user login state, refreshes tokens, handles brand/tenant switching | Repeated login prompts, operations return 401/403, "not logged in" error immediately after launch |
| **Conversation Orchestration** | Receives a user question → assembles context → calls LLM → handles streaming response → handles tool call loop → pushes chunks to UI | AI doesn't respond, reply interrupted, streaming stuck on a token, stops after tool call |
| **Tool Runtime** | Starts and manages tool server subprocesses, forwards Agent tool calls to the corresponding server | Tool not found, tool timeout, Agent keeps waiting after tool server crashes |
| **Local Data Store** | Persists Agent configuration and session content | Configuration lost, content saved just now disappears on next launch, migration fails |
| **Long-term Memory** | Writes/retrieves vectorized memories | AI doesn't remember what user said, retrieval returns empty, database initialization fails |
| **Log Center** | Archives each subsystem's runtime logs by source and level | This is the Doctor's primary source of evidence |

### 2.2 Mental Model for the UI Process
The UI process is like a "single-page application," whose main jobs are: render the state pushed from the background + convert user actions into requests to the background.

Main panels:
- **Session view**: displays the conversation flow of the current session, with streaming rendering, attachment display, and tool call expansion.
- **Agent editor**: edit system prompt, model, tools, memory, and other configuration.
- **Settings panel**: account, appearance, keyboard shortcuts, tool server management.
- **Doctor UI**: entry point for this system itself ("Report Bug" form + status indicator).

Key conventions for UI state management:
- Every conversation chunk, every streaming token, is not generated by the UI itself — they all come from background events; the UI only does "subscribe → write to local state → render."
- This means: a UI that "appears frozen" may not be a UI bug — it may be that the background has stopped pushing events. How to tell: check the logs for the last entry from the background conversation orchestration.

---

## 3. How the Two Processes Communicate

All interactions between the UI and the background go through **typed IPC**, in two categories:

1. **Request/response**: UI calls → background executes → returns result (e.g. "submit a question", "read settings", "delete a session").
2. **Event push**: background broadcasts → UI subscribes (e.g. streaming tokens, state machine changes, Doctor step progress, external notifications).

\`\`\`mermaid
sequenceDiagram
    participant U as User
    participant R as UI Process
    participant M as Background Process
    participant L as LLM Service
    participant T as Tool Server

    U->>R: Types and sends a message
    R->>M: Submit question (request)
    M->>M: Assemble context + recall long-term memory
    M->>L: Send conversation request (with tool definitions)
    L-->>M: Stream tokens back
    M-->>R: Push token stream (event)
    R-->>U: Render reply token by token
    L-->>M: Return tool_call instruction
    M->>T: Execute tool call
    T-->>M: Return tool_result
    M->>L: Feed tool_result back to continue generation
    L-->>M: Stream remaining content
    M-->>R: Continue pushing tokens
    M->>M: Write this turn's content to session history + extract memory
    M-->>R: Push "session updated" event
\`\`\`

Key observations:
- Streaming interrupted = background stopped pushing events to UI. Root cause may be in LLM service, conversation orchestration, or IPC channel.
- Tool takes a long time to return = background is stuck between itself and the tool server, and the conversation orchestration loop will also hang.
- UI "can't see message just sent" = the background probably hasn't pushed the "session updated" event yet, or the UI subscription broke.

---

## 4. Full Flow of a Single Tool Call

Many user-reported bugs center on the tool call step, so here is a dedicated diagram:

\`\`\`mermaid
flowchart TD
    A[LLM decides to call a tool during streaming] --> B[Background receives tool_call]
    B --> C{Corresponding tool<br/>server online?}
    C -- No --> X1[Error: tool not found]
    C -- Yes --> D[Forward arguments to tool server]
    D --> E{Does server<br/>respond in time?}
    E -- Timeout --> X2[Timeout error<br/>conversation orchestration stuck waiting]
    E -- Error --> X3[Feed error back to LLM<br/>as tool_result]
    E -- OK --> F[Feed result back to LLM as tool_result]
    F --> G[LLM continues generation based on result]
    G --> H{More tools<br/>to call?}
    H -- Yes --> A
    H -- No --> I[This turn's reply complete]
\`\`\`

Debugging hints:
- "AI called a tool and stopped" → identify which step it's at: is it \`X2\` timeout? is it \`X3\` tool error but LLM didn't continue? or was it interrupted between \`F → G\`? Logs usually contain markers for the corresponding stage.
- "AI called a tool but used wrong arguments" → may be an LLM issue (prompt didn't explain clearly / model capability insufficient), not necessarily a backend bug. Check whether the tool_call arguments match the Agent's system prompt.

---

## 5. Common Failure Patterns Quick Reference

| User description | Subsystem most likely involved | Investigation starting point (what to look for in logs) |
|------------------|---------------------------------|----------------------------------------------------------|
| "AI doesn't respond / keeps spinning" | Conversation orchestration, LLM upstream | Check whether the most recent conversation request completed, any error entries |
| "AI gives off-topic answers / forgets what I said" | Context compression / long-term memory | Use \`view='llm'\` to check if messages are dropped in context_history; check memory write/retrieval entries |
| "Tool call failed / timed out" | Tool runtime | Find tool server startup/connection logs, check timeout and errors |
| "Login failed / repeated login prompts" | Account/auth | Find token refresh, 401/403-related logs |
| "White screen / startup crash" | UI rendering or background startup | Check error entries and uncaught exceptions during startup phase |
| "Settings lost after saving" | Local data store | Check write operation logs, migration errors |
| "Doesn't remember things / memory not working" | Long-term memory | Check memory write and retrieval logs, whether local database initialized successfully |
| "Voice not working" | Voice subsystem | Check recording/playback logs, remind user to check OS microphone permissions |
| "Can't see message I just sent / streaming broke" | IPC event push | Check when the last entry from background conversation orchestration was, whether it went silent after that |

---

## 6. Product Boundaries / Things Not to Misdiagnose

- **Not a browser**: the built-in browser automation is a tool for Agents, not a browser for the user; "webpage won't open" as reported by users is generally not an application bug.
- **Not a cloud service**: all data is stored locally; "my session isn't visible on another machine" is not a bug, it's by design.
- **Multi-brand differences**: different brands share code but have feature differences; when encountering "I don't have a certain feature," first confirm which brand the user is using.
- **LLM capability limitations are not bugs**: when a user complains "AI gave a wrong answer," distinguish whether it is a product bug (process error, context lost, tool failure) or an LLM model capability issue. The latter should not be converted into an engineering issue — note it clearly in the Issue.

---

If you need more concrete code-level details during analysis (which file implements something, specific error code lists, etc.), do not guess in the Issue — this tool does not expose implementation details, only a product and architecture-level concept map. Simply note "requires engineer to further investigate" in the Analysis section of the Issue.
`;
