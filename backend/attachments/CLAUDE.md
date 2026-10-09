# attachments/ — one table for "what is attached to this", whatever "this" is

The owner, 2026-10-08: *".md files, docs, etc, sketches etc for files when creating an event for
attachements (in multiple places we lack this funcionality)"* — and, asked where: events at creation,
courses, tasks, plans, needs, goals, materials, organisations **and comments**, "EVERYWHERE". Asked
what to do about the three tables that already answered a piece of that, they chose **one table,
supersede the others**.

## What it absorbs, and what each contributed

| Table | What came across |
|---|---|
| `documents.EventDocument` | the tiers, the mandatory-read acknowledgements pinned to a version, the supersession chain, the withdrawal that is a state, the honest `scanned=False` |
| `courses.Attachment` | a title, a description, a rating thread, the signal that deletes the bytes when the row goes |
| `community.CommentAttachment` | a file hung on something that is not a node at all |

**The absorption is a command, not a migration** — `manage.py absorb_legacy_attachments`, dry by
default, `--apply` to write, `--verify` to check. A migration would run itself on the next deploy
with no dry run and nobody looking, which is the wrong shape for a step whose whole risk is in the
data. It is idempotent by the legacy row's id and it **shares the file path** rather than copying
bytes — so while both rows exist, deleting either takes the shared file with it. That is why
`--apply` does not delete the legacy rows.

## The four things to know

1. **The ladder is `public ⊂ members ⊂ staff ⊂ managers`**, plus `venue` which is NOT on it — a
   building's administrators are neither above nor below an organiser. `EventDocument`'s old tiers
   map onto it exactly (`attendees → members`, `organisers → managers`), which is what makes the
   absorption a rename rather than a reinterpretation. On a **comment** only `public` is legal, and
   `access.tier_block_reason` refuses the rest rather than silently treating them as public.

2. **A board row has no standing of its own.** A task, a plan, a need and a goal all resolve to the
   node they hang off (`targets.node_behind`) and ask `config/nodes.py` about THAT — the same thing
   their own discussion threads do. Four more apps did not have to learn a permission model.

3. **Four file paths, and which one a file takes is decided by what it IS.** An image is re-encoded
   from pixels (nothing of the upload survives). `.md`/`.txt` become **characters in a TEXT column**
   — house rule 7 answered by not having the question — and render through `renderContent.ts` like
   every other body. A PDF is stored as-is behind the sniff, the cap and the scan. **An office
   document takes the PDF's path**, by the owner's explicit decision when the rule-7 question was
   put to them; `.doc`/`.xls`/`.ppt` and the macro formats are refused **by name**. All four OOXML
   kinds additionally get the zip-container member check, because libmagic can only answer "it is a
   zip".

4. **`media_type`, not `content_type`.** The `GenericForeignKey` owns `content_type` here.

## Traps

- **`is_reencodable_image` takes the UPLOAD, not a sniffed string.** It does its own sniff, which is
  what keeps "is this an image we re-encode" in `imaging.py` rather than in each caller. Passing it
  the string is an `AttributeError` on `.seek`, which is how it was found.
- **`kind` from the client is a hint, not a fact.** An upload named `.md` takes the text path
  whatever the caller said, exactly as `media_type` is decided by the server.
- **A 404 covers three different facts** in `_target_or_404`: unknown kind, missing row, not yours.
  That is deliberate — anything else is a probe.
- **The flag is a three-file change.** `moderation/models.py` + a migration, plus
  `frontend/src/lib/types/featureFlag.ts` and `frontend/src/lib/utils/labels.ts`. The root
  `CLAUDE.md` says the third has been forgotten twice.

## Left open

- **Nothing is mounted on a course or an event page yet.** Both still have their older surfaces, and
  two attachment UIs on one page is worse than one in the wrong place — `ManagementPanels` carries
  the condition and loses it on the day `absorb_legacy_attachments --apply` runs.
- **Sketch and chem attachments have no picker.** The kinds exist, the API takes them, the panel
  renders them; nothing in the UI offers to choose an existing drawing yet.
- **A course attachment's discussion thread is not moved** by the absorb command — a thread is
  addressed by `(content_type, object_id)` and moving it is a `community` change. The command counts
  them and says so.
- **No replacement from the UI.** `POST /api/attachments/<id>/replace/` exists and is tested; the
  panel offers withdraw, not replace.
