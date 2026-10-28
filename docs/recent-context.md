# Recent conversation context in the synthetic prototype

The local prototype now passes a selected sequence of recent messages to a responder. Relationship prose is a separate field. This is context selection, not model training, a memory of private facts, a verified reply graph, or a guarantee that the available context is sufficient.

## Scope and order

The in-memory key is the demo counterpart plus a fixed room ID (`main`, `side`, or `group`). The same room name under another counterpart has independent history, request records, locks and reset state. Relationship edits clear every room for that counterpart and invalidate pending replies. A room reset affects only that room.

Each event records a server-assigned sequence and event ID, room scope, speaker ID/label, time and input-group ID. Same-time messages retain submitted order. A snapshot stops at the latest incoming target sequence; a generated answer or any later event cannot become input for that same answer. Out-of-order times, repeated event IDs, foreign room scope and invalid target boundaries are rejected. Current mock endpoints reject new requests while that room is generating; they do not implement messenger event collection or queued automatic sending.

`POST /api/chat` accepts the original message/requestId fields and an optional fixed roomId. The session GET accepts `?room=...`; reset optionally accepts roomId. `POST /api/chat/batch` accepts 1–8 ordered fictional incoming events with speakerId, text and ageSeconds. The final event must be the approved initiating counterpart and have ageSeconds zero. Earlier events can be at most ten minutes old and cannot backfill before saved history. In the group room, `group-peer` is a separate fictional context participant, not an approved automatic-reply target. Unknown actors and attempts to make that peer the target are rejected. Incoming events cannot spoof the self/assistant role.

Additional rooms, grouped input and the UI's multi-speaker fixture button work only in mock mode. Existing API/CLI modes remain restricted to the original main room and fixed synthetic relationships/messages. This change neither imports private data nor authorizes a larger external transmission surface.

## Selection and budgets

`src/context.ts` selects a recent chronological segment relative to the target:

- At most ten minutes and forty selected messages, with a UTC date boundary.
- A silence of at least two minutes starts a new candidate segment. This is a heuristic boundary, not a semantic topic judgment.
- Input batches split into segments at gaps exceeding sixty seconds. Each request starts new segment IDs; these are bookkeeping groups, not inferred messenger reply links. A generated reply stays with the last input segment so older pairs are not cut into dangling fragments.
- Stored groups are selected whole. Groups split by a time boundary are omitted; a split or oversized latest group needs review and is rejected before calling the responder. Count/byte limits remove older whole groups from a contiguous suffix rather than skipping over them.
- Selected serialized message data is capped at 12,288 UTF-8 bytes. The complete API body or CLI prompt, including relationship and instructions, is capped at 24,576 UTF-8 bytes before a model request. These are size limits, explicitly not measured model token counts. No remote token counting, summarization, hidden retry or fallback is added.

Both model adapters use the selection as supplied, replacing the previous silent last-twelve-message slice. Speaker identity, relative time, sequence and group order are carried with the text. Grouped input remains mock-only. Relationship prose must not be treated as applying to other group participants automatically.

## Review and failure behavior

The local UI labels speakers and provides a separate view of the exact selected input for the last successful response. It shows group/message counts, byte usage, dropped counts/reasons, long silence/date boundaries and a multi-speaker review notice. It does not label forty messages as adequate context. Current-room reset and counterpart changes clear the displayed context while the new scope loads; older fetch results cannot overwrite a later submission.

Successful input, reply and selected-context preview commit together. Failures, oversize latest input, unknown target actors and permission changes do not store failed input or its preview. Same-scope identical request IDs reuse their promise/result, including failures. The same ID can independently name a request in another room. Relation approval remains mandatory before responding; changes during a request invalidate its result across rooms.

## Validation and remaining work

Type checking, lint and 55 tests pass. Synthetic checks cover message order and unique actors/events, target cutoff, independent rooms/accounts, time/date/gap boundaries, whole-group byte/count limits, latest-group rejection, concurrent/duplicate requests, revocation and existing failure handling. API fetch and CLI runner fakes verify that a valid selection longer than twelve messages is preserved without making external calls. Chrome verifies a two-speaker input followed by a later message, a five-message input preview that includes the earlier self-role reply, and empty histories after changing room or counterpart.

No actual model request is made for this change. Longer-context response quality, topic relevance, ambiguity of real reply links and behavior on real multi-party messages remain untested. A future private evaluation must separately approve the exact redacted context range to be sent. Production authentication, real messenger ingestion/sending, persistent storage and private-data import remain separate work.
