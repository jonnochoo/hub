# Hub design

Status: draft v0. This describes what the app does today and the principles I want new work to follow. Open questions are at the end.

## Philosophy

1. **Files are the database.** Everything lives as plain markdown in the vault. The app is a fast editor and a view over those files. A human or an agent can edit them and the app reloads. No hidden state: if something matters, it is in a file.
2. **Today is the product.** Every other view feeds Today. If an item needs attention today it shows on Today; otherwise it stays out of the way.
3. **One model, many types.** Tickets, tasks, routine, questions and learn items differ in where they come from, not in how they behave. They should share the same properties and the same keys.
4. **Keyboard first.** Every action has a key. The same key means the same thing everywhere (`x` complete, `!` priority, `w` time, `l` later, `f` active, `d` date, `t` today, `p` postpone).
5. **Never lose or rewrite history.** Completion records when it happened. Old files keep working: formats only grow (new optional fields), and old values are read as their new names.
6. **Calm by default.** One quiet list. Grouping, headers and hiding are choices, not defaults forced on me.

## The common model

Every item, whatever its type, has the same logical properties:

| Property | Items (`tasks.md` etc.) | Tickets (`tickets/*.md` frontmatter) |
| --- | --- | --- |
| Done | `[x]` checkbox | `done: true` |
| Completed on | `done:YYYY-MM-DD` | `updated` date, while done |
| Completed at | `done:YYYY-MM-DDTHH:MM` | `doneAt: HH:MM` |
| Priority | `!` | `priority: true` |
| Reminder time | `at:HH:MM` | `at: HH:MM` |
| When | `due:DATE`, `@later`, or none = active | `planned: DATE`, `later: true`, or none = active |
| Notes | indented lines under the item | `## Notes` section |

Routine items are the one exception on *done*: they never stay ticked. They count as done only if `done:` is today, and reset by themselves the next day.

### Ticket statuses

`todo → in-progress → blocked → review → ready-to-deploy → deployed-monitoring`

`deployed-monitoring` ("deployed + monitoring") is a workflow stage, not a finish line. **Done is a separate flag** (`done: true`, same as a task checkbox), so a ticket can be deployed + monitoring and not done, or done at any stage. Files that still say `status: done` are read as done + `deployed-monitoring`. Moving to any status other than `todo` makes a ticket Active (always on Today).

### When

Three mutually exclusive states, same for every type: **Active** (no date: always on Today), **Dated** (on Today from that date), **Later** (parked, never on Today). Past-dated items roll forward onto Today with a "from" chip.

## Today

- A strip across the top shows the work day (8:30am to 5pm) in one-hour blocks: blue work, purple lunch (12 to 1pm), yellow ready-for-home (4 to 5pm). Blocks fill as time passes, and timed items sit on it as dots.
- **Active** has two modes (`v`): a straight list (default) and grouped by type.
  - List order: completed first by completion time, then timed items by time, then by type (ticket, task, routine, question, learn). `J`/`K` move a row and save a manual order; `V` resets it.
  - Completed items stay in the list, struck through, with a `✓ time` chip, until hidden (`H`).
- The right panel follows the cursor and shows the full detail of the highlighted row.

## Decisions log

- 2026-11-25: list/grouped modes, manual order and completion time added to Today.
- Ticket `done` split from status: status `done` became the stage `deployed-monitoring`, and done became its own flag (`done: true`) shared with every other type. Reason: shipping and finishing are different events (you keep monitoring after deploy).
- Tickets gained `priority` so priority is not a task-only concept.

## Open questions

- Should the manual list order live in the vault (so it syncs) rather than in the app's local storage?
- Should a ticket's `doneAt` carry a date, so completions from earlier days sort correctly? Today it only matters for "completed today".
- Do `questions` and `learn` need a done-and-priority UI parity with tasks, or are they too light for it?
- Should every type allow a time range (start to end) instead of a single `at` time?
- A separate "monitoring is over" step after `deployed-monitoring`, or is leaving it done-and-struck-through enough?
