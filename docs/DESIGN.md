# Hub design

Status: draft v1. Describes the core principles and the state of play: what is consistent across types, and what still is not. Visual and UI design comes after the concepts are right.

## Goal

A personal work hub whose data is **markdown files in a folder**, Obsidian-inspired. A human edits them in the app or any editor. An agent can search and edit the same files. The app is a fast, keyboard-driven view over them, and it helps me organise work so I always know what to do today.

## Core philosophy

1. **Keyboard shortcuts.** Every action has a key, and the same key means the same thing in every view and on every type.
2. **Help organise work.** The app is for deciding what to do and when, not for storing everything I know. It stays calm: one list, no noise.
3. **Today.** Today is the product. Everything else exists to feed it.
4. **Soon.** Work with a concrete date. It leaves me alone until that date, then appears on Today.
5. **Later.** Work with no concrete date. Parked on purpose; never on Today until I decide.
6. **Types.** There are different kinds of work (see below). They differ in where they come from and what extra they carry, not in how they behave.
7. **Files are the database.** Plain markdown, no hidden state. If it matters, it is in a file an agent can read.
8. **History is never rewritten.** Completion records when it happened. Formats only grow (new optional fields); old values keep working.

## When: Today, Soon, Later

Every item has exactly one **When**:

| When | Meaning | Stored as (items / tickets) | On Today? |
| --- | --- | --- | --- |
| **Active** | I am on this. No date. Always on Today until done. **Never goes overdue.** | no date, not later / `planned` empty, not `later` | always |
| **Soon** (a date) | A concrete day. Quiet until then. | `due:DATE` / `planned: DATE` | from that day |
| **Later** | Parked, no concrete date. | `@later` / `later: true` | never |

- A dated item whose day has passed is **overdue**: it stays on Today with a "from DATE" chip. This is the one real difference from Active, which has no date to miss.
- Today = every Active item + every Soon item whose date is today or earlier.
- Active exists to separate "I'm working on this" from date-driven work. It is the "now" value in the date slot.
- Moving a ticket to any status other than `todo` makes it Active (working on it).
- A date and Later are mutually exclusive; setting one clears the other.
- Rule for every type except routine: Active, Soon and Later apply identically. Ideas follow the same rules too (decided; see gaps).

## Types

| Type | Lives in | What it adds |
| --- | --- | --- |
| Ticket | `tickets/KEY.md` (one file each) | status workflow, subtasks, notes, link, time clocked, "next" step |
| Task | `tasks.md` | the plain unit of work |
| Routine | `routine.md` | recurs on chosen days (`every:`); resets itself daily; no When or priority |
| Question | `questions.md` | notes are the answer |
| Learn | `learn.md` | something to study |
| Idea | `ideas.md` | someday thought; promoted to a task when acted on |
| Post-it | `reminders.md` | max 2, shown on Today, optional time alert |
| Daily note | `daily/DATE.md` | free notes plus an automatic log of what I did and clocked |
| Bookmarks | `bookmarks.md` | quick links, keys `b 1` to `b 9` |

## The common properties

Every type except daily notes and bookmarks has the same properties. Two storage shapes exist (list lines with inline tags, one file per ticket with frontmatter). The decision is to **keep both and unify the vocabulary**, so one search or script reads either.

| Property | List items (inline tags) | Tickets (frontmatter) |
| --- | --- | --- |
| Done (date and time) | `[x]` plus `done:YYYY-MM-DDTHH:MM` | `done: YYYY-MM-DDTHH:MM` (empty = open) |
| Priority | `!` | `priority: true` |
| Reminder time | `at:HH:MM` | `at: HH:MM` |
| When | `due:DATE`, `@later`, or neither (Active) | `due: DATE`, `later: true`, or neither (Active) |
| Notes | indented lines | `## Notes` section |

Routine is the one exception on done: items never stay ticked. They count as done only if `done:` is today and reset the next day.

### Ticket status is not done

`todo → in-progress → blocked → review → ready-to-deploy → deployed-monitoring`

Status is the workflow stage. **Done is a separate flag**, so a ticket can be deployed + monitoring and not yet done, or done at any stage. Old `status: done` files are read as done + `deployed-monitoring`.

### Waiting is a flag, not a status

`waiting` (`@waiting` on list items, `waiting: true` on tickets, key `w`) means parked on something external: a deploy to test, a reply. It works on tickets, tasks, questions and learn, independent of date and status. The item stays on Today but moves to a Waiting section under Active, so the Active list is only what needs me now. Routine items cannot wait.

## Today

- A strip across the top shows the work day (8:30am to 5pm) in one-hour blocks: blue work, purple lunch (12 to 1pm), yellow ready for home (4 to 5pm). Blocks fill as time passes; timed items are dots on it.
- **Active** list has two modes (`v`): a straight list (default) and grouped by type.
  - List order: completed first by completion time, then timed items by time, then by type. `J`/`K` reorder a row and save a manual order; `V` resets.
  - Completed items stay, struck through with a `✓ time` chip, until hidden (`H`).
- The right panel follows the cursor and shows the full detail of the highlighted row.

## State of play

**Consistent already:** done flag, completion time and priority across every type; reminder time (`at`) everywhere; same keys for complete (`c`/`x`), priority (`!`), time (`T`), waiting (`w`), later (`l`), active (`f`), date (`d`), today (`t`), postpone (`p`); strike-through for completed on Today; one When model.

**Gaps to close, in rough order:**

1. **Ideas do not reach Today.** Decision: they should, with the same When rules as tasks. Code does not yet do this.
2. **Two vocabularies.** `due` and `later` are decided (tickets still say `planned`); `done` is decided (tickets still use `done: true` + `doneAt`). `priority`/`!` and `at` still differ in form, not name.
3. **Ticket completion borrows the `updated` date.** Decision: tickets store `done: DATE`+`T`+`HH:MM` like items, replacing `done: true` and `doneAt`. Not built yet.
4. **"Active is never overdue" is implicit in code.** Make it an explicit rule so it cannot drift.
5. **No stable ids for list items.** Decision: a `^id` tag on each line, added automatically on first save. Not built yet.
6. **Manual order is stored in the app, not the vault.** Decision: per-day, in `daily/DATE.md`, as item ids (depends on gap 5). Not built yet.
7. **Ticket list `c` marks done but does not toggle it back**, unlike Today and the detail view.
8. **Routine and post-it** sit outside the When model by design (decided). No change needed.
9. **No "active since" date.** Decision: store one, and show a quiet age chip on stale Active items. Not built yet.

## Decisions log

- 2026-11-25: Today view gains list/grouped modes, manual order, completion time and strike-through for completed.
- 2026-11-25: Ticket status `done` renamed `deployed-monitoring` (a stage); done became its own flag shared by every type. Reason: shipping and finishing are different events.
- 2026-11-25: Tickets gained priority and the same State row as tasks (done + priority).
- 2026-11-25: Today, Soon, Later defined. Active kept as the "now" value: no date, always on Today, never overdue. Reason: it separates "I'm on this" from date-driven work, and only real dates can slip.
- 2026-11-25: Ideas get the same When rules as every other type.
- 2026-11-25: Keep both storage shapes; unify the vocabulary.
- 2026-11-25: Canonical names `due` (date) and `later` (parked) in both shapes. Tickets rename `planned` to `due`; old `planned` is still read.
- 2026-11-25: Every list item gets a stable id tag (Obsidian block-id style, e.g. `^a1b2`) added on first save, so agents and links can point at one item.
- 2026-11-25: Post-it (always on Today until cleared, max 2) and Routine (recurs on its days, resets daily) stay outside the When model on purpose.
- 2026-11-26: Every type has its own completion date (and time), never borrowed from another field.
- 2026-11-26: One `done` property holds date and time (`done: 2026-11-25T14:05`) in both shapes. Tickets drop `done: true` and `doneAt`; old files are still read.
- 2026-11-26: Active items show a quiet age chip (e.g. "active 12d", no warning colour) once older than a few days. Needs a stored "active since" date.
- 2026-11-25: Manual Today order moves into that day's daily note as a list of item ids. It resets each day, syncs with the vault and is readable by agents.

## Open questions

- Should the UI word be "Active" or "Now"? (Leaning Active.)
- Remaining vocabulary: `priority` (ticket) vs `!` (item) is a tag-versus-field difference, not a naming one. Keep, or add a `priority:` form for lists too?
- How should an agent create items safely: append a line to a list file, or call a command?
