# Copilot, read-only and permission-aware (R4.16)

**Date:** 2026-11-21
**Status:** Accepted for implementation, provider-neutral. The model provider is **not chosen**. The user decides it later, and it must be named in the DPA before production use.
**Roadmap:** R4.16 (Track P). Pilot checklist §14:
- ask operational questions;
- get answers with source context;
- get help with reports and summaries;
- see suggested next actions;
- see only what the staff member may see.

**BluePMS page:** AI Copilot Home (titles only): a home with suggested questions and shortcuts, report discovery, and explaining exceptions.
**Sources:**
- The roadmap R4.16 locks.
- ARCHITECTURE §10.2: the in-product agent (`ai_ops.*`) is separate from MCP (`mcp.*`). R4.6 and R5.11 reuse this tool mapping and permission check.
- §6.7 entitlements: `ai_ops.enabled` and `ai_ops.messages.limit` (soft).
- R4.14 reports, R4.31 dashboard, R4.27 room board.

## 1. Decisions

| # | Decision |
|---|---|
| D1 | **Tools are existing GET routes, called as the asking user.** A registry `COPILOT_TOOLS` in contracts. Each entry has:<br>• a `toolId`;<br>• a one-line description for the model;<br>• the **existing route id** it calls;<br>• a parameter schema (bounded, validated);<br>• a source-link builder (the SPA path that shows the same data).<br>The handler executes a tool by issuing that GET **through `dispatchV1` with the caller's own authenticated principal and property**: the same permission gate, entitlement, `resolvePropertyContext` and `assertTenantActive`. There is no service identity, no direct DO call and no tool without an existing route. A 403 or 404 from the route comes back to the model as a tool error and never as data. **No command execution:** the registry admits **read routes only**: GET routes, plus POST routes that carry **no `commandId`** and are on an explicit allow-list. Today that list is `post_reservation_search`, the desk search, which keeps names in the body so they never land in a URL. A contracts test asserts that every tool maps to a route with no `commandId`, and that any non-GET tool is on that allow-list. *(Amended 2026-11-21: the roadmap lock is "existing read routes"; GET-only had made name search impossible.)*<br>The initial tools:<br>• front desk summary;<br>• room board;<br>• reservation search;<br>• reservation detail;<br>• folio for a reservation;<br>• open folios;<br>• housekeeping dashboard;<br>• housekeeping tasks;<br>• the R4.14 report routes (front office, cashier, night audit, housekeeping; `reportId` from the registry);<br>• the Manager Report;<br>• night-audit status. |
| D2 | **Model adapter, provider-neutral.** One interface, `CopilotModel.step(messages, tools) → { text } \| { toolCalls }`, with a loop of at most **6 tool calls** per question and a total time budget under the Worker limits. Two implementations:<br>• **`FakeCopilotModel`:** deterministic keyword → tool mapping. It is used in tests, and in local dev only behind `HOSPAI_UNSAFE_LOCAL`, so the demo works without a provider.<br>• **`OpenAiCompatibleModel`:** chat-completions with tool calling, configured by `COPILOT_BASE_URL`, `COPILOT_MODEL` and the secret `COPILOT_API_KEY`. It is **off unless all three are set**.<br>With neither available, the route returns `503 copilot_unavailable` (a new code in the one status table) and the SPA says the copilot is not set up. Prompt content lives in one module and is not part of the contract.<br>*(Amended 2026-11-21: a third implementation, chosen as the pilot default.)* **`AnthropicModel`:** the Anthropic Messages API through the official `@anthropic-ai/sdk`, selected by `COPILOT_PROVIDER=anthropic` with `COPILOT_MODEL` (recommended `claude-haiku-5-5`) and the secret `COPILOT_API_KEY`; `COPILOT_BASE_URL` is optional and validated the same way. It runs at **effort `low`**, sends no sampling parameters, caches the stable prefix (tools and system prompt), and replays the assistant's content blocks (thinking included) unchanged within one question's tool loop. A refusal answers with a fixed sentence; any other provider failure is a `CopilotModelError` code, never provider text. Without `COPILOT_PROVIDER=anthropic`, selection is unchanged. |
| D3 | **Route:** `post_copilot_message`: `POST /v1/properties/:propertyId/copilot/messages`. Body:<br>• `messages` (the visible conversation, at most 20 turns, each turn up to 4,000 characters; HTTP and handler caps → `limit_exceeded`);<br>• `x-idempotency-key` is **not** used, since it is a read.<br>Permission: new `copilot:use` (granted to staff, admin and owner; mirrored in `me.test.ts`). Entitlement: `ai_ops.enabled`. FAIL_CLOSED.<br>Response:<br>• `answer` (text);<br>• `sources[]` (`{ label, href }`, built from the tools that returned data);<br>• `suggestedActions[]` (`{ label, href }`: links to existing screens only, never a POST);<br>• `toolsUsed[]` (`{ toolId, ok }`).<br>**Every answer carries at least one source, or says it has none.** The handler enforces that by appending "No records were read for this answer." when no tool returned data. |
| D4 | **Privacy.**<br>• The conversation and tool results are **not stored, logged or put on events**. The route is added to the forbidden-bodies list or to whatever mechanism keeps request bodies out of logs, and observability records only counts and durations.<br>• Guest data reaches the model only through tools the user could already call; nothing decrypts per row beyond those routes.<br>• *(Amended 2026-11-22.)* "Not stored" means **the server stores nothing**. The SPA keeps the clerk's own conversations **in that browser only** (see D6); they never leave it, and the route still logs no bodies.<br>• Each answer whose tools returned guest references writes **one audit row**, through a new internal command `copilot.record_read` (audit writer, INTERACTIVE, **not** exposed over HTTP). It holds the actor, the tool ids and the count of distinct `guestRef`s read, but no names, no question text and no answer text. |
| D5 | **Metering:** each answered question counts once against `ai_ops.messages.limit` through the existing entitlement usage mechanism if one exists. If none exists, do not invent storage; record that in the report. The limit is soft: over it, the answer still returns, with `overSoftLimit: true` for the SPA to show a notice. |
| D6 | **SPA: `/copilot` ("Copilot"),** with its nav entry gated by `copilot:use` and the entitlement.<br>• A home with **suggested questions** ("Who arrives today?", "Which folios are still open?", "How is housekeeping doing?", "Show yesterday's manager report", "Why is this exception open?") and shortcuts to Reports and the Overview.<br>• A conversation held **in memory only**: no `localStorage`, gone on reload. *(Amended 2026-11-22: the open conversation is also saved in this browser's `localStorage` after each completed answer, under `hospai.copilot.history.v1.<userId>.<propertyId>`: the turns as shown (question, answer, sources, suggested actions), no tool results. The newest 20 conversations are kept and any older than 30 days are dropped on every load and save. A quiet "Earlier conversations" button next to "New conversation" lists them (title, date, turns) with Open, Delete and Delete all, each delete confirmed. Everything under `hospai.copilot.history.` is removed before sign-out, and a different user's keys are removed when the screen loads for another user on the same browser. The home says conversations are saved in this browser only, for 30 days, and deleted at sign-out. The server stores nothing.)*<br>• Each answer shows its **sources as links**, and suggested actions as buttons that navigate. The clerk clicks; nothing is submitted for them.<br>• States: "not set up" (503), entitlement missing, an over-soft-limit notice, and errors through `classifiedUserMessage`.<br>• ui-kit only. Desktop only. |

## 2. Tests

pms-core (`apps/pms-core/test/copilot.spec.ts`, using `FakeCopilotModel`):
1. "Who arrives today?" calls the arrivals tool through `dispatchV1` and returns names from the existing route with a source link to the arrivals report.
2. **A `roster:read`-only user asking about a folio gets a refusal, not data.** The tool returns 403; the answer says they lack access and contains no balance.
3. **Hotel A's user gets nothing from hotel B:** a tool with B's property or reservation id → 404, and no B data in the answer.
4. Every answer has a source or the "no records" sentence.
5. Over 20 turns or 4,000 characters → `limit_exceeded`. No provider configured and no unsafe local → `copilot_unavailable`.
6. Entitlement off → 402. Without `copilot:use` → 403.
7. A guest-reading answer writes one `copilot.record_read` audit row with counts and no names or text; a non-guest answer writes none.
8. The registry admits GET routes only; a test fails if any tool maps to a non-GET route.
9. Nothing from the request body appears in the captured logs.

contracts: registry validity, pins and permission.

web-pms:
- the home and suggested questions;
- the conversation in memory, gone on remount;
- sources rendered as links;
- suggested actions navigate;
- the not-set-up and over-limit states;
- nav gating;
- nothing is written to `localStorage` before an answer; after one, exactly one per-user/property history key (*amended 2026-11-22*); the history list, open, delete and delete all; history kept on remount; sign-out clears every `hospai.copilot.history.` key and leaves `hospai.theme`.

## 3. Pins

- `COMMAND_CATALOG` +1 → **148** (`copilot.record_read`).
- `AUDIT_WRITER_COMMAND_IDS` +1 → **114**.
- `V1_HTTP_ROUTE_AUDIT` +1 → **251**, last id **`post_copilot_message`**.
- Schema unchanged (56).
- New permission `copilot:use`.
- New error `copilot_unavailable` (503).
- Update the AGENTS.md pins table.

## 4. Out of scope

- Any write (R4.6).
- Guest-facing replies (R5.9).
- External agents and MCP (R5.11).
- Warehouse trends.
- **Choosing the model provider and naming it in the DPA** (the user's decision; configuring it is three settings).
- Streaming responses.
- Storing conversation history **on the server** (browser-only history is in scope, see D6, amended 2026-11-22).
