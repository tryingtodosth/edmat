# Concepts (pojęcia) — the contract every agent on this feature builds against

Written 2026-09-20, amended 2026-09-23 (articles as a pool per audience; block-structured content)
on branch `concepts`, cut from `coauthoring` at `c88b934`. This is the spec; a `HISTORY.md` §17BD
entry will be the write-up once it lands. Read the root `CLAUDE.md`, then `backend/CLAUDE.md` or
`frontend/CLAUDE.md` for your half, then this file. When this file and the code disagree after
landing, the code wins and this file gets corrected. `COAUTHORING-BRIEF.md` is the sibling spec this
one is modelled on; where the two describe the same machine (immutable numbered revisions, head vs
published, 409 on a stale save, one decide endpoint) the shapes are deliberately identical, and
`backend/coauthoring/` is the code to copy from.

**What it is.** A new app, `concepts`, holding wiki-like pages for the things exercises and
materials are *about* — "derivative", "quantum mechanics", "mole", "recursion". One concept is one
language-neutral node with a slug. Under it sit **articles**. An article is written for one
**(audience, locale)** — the primary-school article and the university article of "quantum
mechanics" are two articles of one concept — and **several people may write their own article for
the same audience**: articles for one (audience, locale) are peers, the way hints and solutions are
a pool on an exercise, not one page fighting over one text. Each article has its own numbered
revision history. An article's content is an **ordered list of blocks** — a Markdown paragraph, a
display formula, a chemistry drawing, a PDF, a picture, then Markdown again — each block edited
with the UI this app already has for that kind of thing. Articles are community-edited under the
exercise trust rules (verified contributors publish, everyone else queues), and a concept is linked
both ways to exercises, materials, tags and other concepts. Nothing existing changes shape: an
exercise or a material simply gains a row of concept chips.

## 0. Decisions this brief makes (approved by Piotr on 2026-09-23, with the two amendments folded in)

| Question | Decision |
|---|---|
| Name | App `concepts`, model `Concept`, UI **Concepts** / **Pojęcia**, URL `/concepts/<slug>`. "Term" / "termin" was rejected as too lexical (a term is a word; a concept is what the word means). "Entry" / "hasło" reads as a dictionary. The Polish and English nouns match one-to-one. |
| What has an audience | **The article.** `ConceptArticle(concept, audience, locale)`; the seven bands of `config/audience.py` apply, `all` is the honest single-article escape hatch. A concept has as many articles as people have written. |
| Several articles per audience | **Yes — a pool of peers**, the `SolutionEntry` shape. Articles for one (audience, locale) are ordered pinned-first (staff/governor), then by their head's `published_at` descending. The page shows one in full and lists the others. "Write your own article" and "Edit this article" are two different actions. |
| Content | **An ordered list of blocks** stored as JSON on the revision: `markdown` (the rich editor with its insert strip — inline maths, inline pictures and inline chemistry stay allowed inside a paragraph), `latex` (one display formula), `chem` (a Ketcher drawing, an existing `chem.ChemDrawing` row), `pdf` and `image` (a `ConceptAsset`, processed exactly as a comment attachment is). `concepts/blocks.py` is the one place that says what a block may be. |
| Reading a missing article | **A concept page never 404s while any article is published.** The reader's band and locale are tried first, then `all`, then the nearest band, then any locale — and the page says, in words, which page it is showing and offers to write the missing one. Lists narrow (house rule on content language); the detail never narrows. |
| Who may write | Anyone signed in creates a concept, an article, or a revision of somebody's article. **Staff, verified contributors and governors of one of the concept's branches publish immediately** (`exercises/entries.py can_autopublish_entry`, applied per branch); everyone else's revision waits. **Minors always queue.** Reports + the kill switch cover abuse, the bet posts and galleries make. |
| Who reviews | Staff; governors of any branch the concept is attached to; **and the article's own author** for revisions of their article (the `can_decide_entry_suggestion` precedent — the author of a text is the natural first reviewer of a change to it). A concept attached to no branch is reviewed by staff and the author only. Decisions go through the app's own `decide/` endpoint — **never a new `_KIND_MODELS` kind**. |
| Editing model | Turn-based: a revision is **based on** the article's current published revision; submitting one based on an older revision gets **409 `stale`** with the current head. Drafts are private and mutable; everything after submit is immutable and kept (house rule 12). A draft is the one thing that may be hard-deleted. |
| Links | Two origins. **Manual**: any signed-in adult links a concept to an exercise, a material or another concept from either end; the adder, staff or a governor removes it. **Body**: `[[slug]]` / `[[slug\|label]]` in any markdown block renders as a link and, on publish, is harvested into link rows, so backlinks exist without anyone filing them. Body links are recomputed on every publish of any article of the concept and cannot be deleted by hand. |
| Concept ↔ concept relations | `related` (default) and `prerequisite` ("know this first"). Nothing else in v1. |
| Governance | A concept is **not** a governable node; scope flows from `Concept.branches`. No new `GOVERNABLE_NODE_MODELS` entry. |
| Kill switch | `concepts` (new). Off → every concept endpoint answers 403 to non-staff; `GET /api/concept-links/?target_type=…` returns `[]` so neighbouring pages keep working; every link, tab, menu item and chip row disappears (house rule 3). `[[slug]]` anchors still render — the page they lead to shows the gate. |
| Real-time / co-editing | Out (PRODUCT.md non-goal). No teams, no invites — a wiki is open by construction. |
| Licence text | Same gap as co-authoring: a factual notice in the editor (public, attributed, may be improved by others); the CC BY-SA line waits for the lawyer (`LEGAL.md` §2). |
| Slug | Allocated from the first title (`slugify` + numeric suffix), **immutable through the API**. Renaming is a staff/admin job, left open. |
| Votes on articles, watching a concept | Not built (§9). |

## 1. Vocabulary (mirror these strings exactly on both halves)

```
ConceptRevision.status   draft | pending | published | superseded | rejected | withdrawn
block.kind               markdown | latex | chem | pdf | image
ConceptAsset.kind        image | pdf
ConceptLink.relation     related | prerequisite            (prerequisite is legal only for a concept target)
ConceptLink.origin       manual | body
link target_type         exercise | material | concept
decision (request body)  accept | reject
audience                 early_years | primary | secondary | university | adult | senior | all   (config/audience.py, unchanged)
```

No `approved` anywhere in this app: the positive terminal state is what the row *is*, `published`.

**Page** = one `(audience, locale)` of a concept: not a table, the key the articles share. **Head**
of an article = its one `published` revision (partial unique). **Current page** for a reader = the
`(audience, locale)` that `resolve_page()` picks (§3); its **lead article** = the first article of
that page in pool order, unless `?article=` names another.

## 2. Data model — `backend/concepts/models.py`

```python
class Concept(models.Model):
    slug = models.SlugField(max_length=120, unique=True)          # language-neutral, allocated once (services.allocate_slug)
    branches = models.ManyToManyField('taxonomy.Branch', related_name='concepts', blank=True)   # governance scope + browse; may be empty
    tags = models.ManyToManyField('exercises.Tag', related_name='concepts', blank=True)         # the global vocabulary exercises and materials use
    created_by = FK(User, null=True, blank=True, SET_NULL, related_name='concepts_created')
    created_at = auto_now_add
    updated_at = DateTimeField(auto_now=True)                     # bumped by services on every publish (lists sort on it)
    # No title, no text, no audience here — all of that is on the articles' revisions.
    # No removal columns either: a concept with no visible article is invisible by construction (access.visible_concepts).

class ConceptArticle(models.Model):
    concept = FK(Concept, related_name='articles', CASCADE)
    audience = CharField(12, choices=AUDIENCE_CHOICES, default=DEFAULT_AUDIENCE, db_index=True)
    locale = CharField(8)                                          # lower-case; 'pl' | 'en' | any free string
    created_by = FK(User, null=True, SET_NULL, related_name='concept_articles')   # the article's author = its first reviewer (§3)
    created_at = auto_now_add
    pinned = BooleanField(default=False)                           # staff/governor: first in the page's pool (SolutionEntry precedent)
    # The names the reports machinery already expects (REPORT_KIND_MODELS, galleries/solution-entry precedent):
    is_removed = BooleanField(default=False)
    auto_hidden_at = DateTimeField(null=True, blank=True)
    Meta: ordering ['concept', 'audience', 'locale', '-pinned', 'id']
    def is_visible_to_readers(self): return not self.is_removed and self.auto_hidden_at is None

class ConceptRevision(models.Model):
    article = FK(ConceptArticle, related_name='revisions', CASCADE)
    number = PositiveIntegerField()                                # 1-based per article, max+1 in a bounded retry loop (SQLite rule 3)
    status = CharField(10, choices §1, default='draft')
    title = CharField(300)                                         # sanitized in save()
    summary = CharField(500, blank=True)                           # plain text: sanitized then tags stripped in save(); cards, search, queue
    blocks = JSONField(default=list)                               # the ordered block list, validated + sanitized by blocks.clean_blocks() before save
    search_text = TextField(blank=True, editable=False)            # blocks.plain_text(blocks) written in save(); what ?q= searches beside title/summary
    change_note = CharField(500, blank=True)
    based_on = FK('self', null=True, blank=True, SET_NULL, related_name='+')   # the article head this was written against; None for revision 1
    created_by = FK(User, null=True, SET_NULL, related_name='concept_revisions')
    created_at = auto_now_add; updated_at = auto_now              # drafts are mutable; nothing else is
    submitted_at = DateTimeField(null=True, blank=True)
    reviewed_by = FK(User, null=True, SET_NULL, '+'); reviewed_at = DateTimeField(null=True, blank=True); review_note = TextField(blank=True)
    published_at = DateTimeField(null=True, blank=True)
    Meta: ordering ['article', 'number']
          UniqueConstraint(article, number, name='unique_revision_number_per_article')
          UniqueConstraint(fields=['article'], condition=Q(status='published'), name='one_published_revision_per_article')
    def is_visible_to_readers(self): return self.status in ('published', 'superseded')

class ConceptAsset(models.Model):
    """A picture or a PDF placed as a block. Never the uploaded bytes (house rule 7): processed by
    community.attachments.process_attachment — the same re-encode / sniff / scan a comment attachment gets."""
    uploaded_by = FK(User, CASCADE, related_name='concept_assets')
    kind = CharField(5, choices image|pdf)
    file = FileField(upload_to=asset_upload_path)                  # 'concept-assets/<uuid32>.webp|.pdf'
    original_name = CharField(120, blank=True); size_bytes = PositiveIntegerField(default=0)
    width = PositiveIntegerField(default=0); height = PositiveIntegerField(default=0)   # images only
    created_at = auto_now_add
    # No DELETE endpoint (the InlineImage / ChemDrawing reasoning: a block in a published revision must keep resolving).

LINK_TARGETS = {('exercises', 'exercise'): 'exercise', ('materials', 'material'): 'material', ('concepts', 'concept'): 'concept'}
LINK_TARGET_MODELS = {v: k for k, v in LINK_TARGETS.items()}      # unknown → 404, never 500 (galleries _resolve_target)

class ConceptLink(models.Model):
    concept = FK(Concept, related_name='links', CASCADE)
    content_type = FK(ContentType, CASCADE); object_id = PositiveIntegerField(); target = GenericForeignKey()
    relation = CharField(12, choices related|prerequisite, default='related')
    origin = CharField(8, choices manual|body, default='manual')
    added_by = FK(User, null=True, SET_NULL, related_name='+')
    created_at = auto_now_add
    Meta: UniqueConstraint(concept, content_type, object_id, name='one_link_per_target')
          indexes [Index(fields=['content_type', 'object_id'])]    # "which concepts point at exercise 5?"
    # clean(): prerequisite requires a concept target; a concept never links to itself
```

### Blocks — `backend/concepts/blocks.py` (the one place that says what a block may be)

```python
MAX_BLOCKS = 200
BLOCK_KINDS = ('markdown', 'latex', 'chem', 'pdf', 'image')
# stored shapes (exactly these keys; unknown keys are dropped, missing required ones refuse with 400 {'blocks': [...]}):
#   {'kind': 'markdown', 'body': str}                      body ≤ 100_000 chars, sanitize_content()
#   {'kind': 'latex',    'source': str}                    ≤ 10_000 chars, stored raw (rendered client-side as \[ … \]); no HTML possible
#   {'kind': 'chem',     'drawing_id': int, 'caption': str}   caption ≤ 300, sanitized+stripped; drawing must exist
#   {'kind': 'pdf',      'asset_id': int, 'caption': str}     asset.kind == 'pdf'
#   {'kind': 'image',    'asset_id': int, 'alt': str, 'caption': str}   alt ≤ 200; asset.kind == 'image'
clean_blocks(raw, *, user) -> list[dict]        # validates + sanitizes; raises ValidationError; referenced rows must exist (any author — a drawing is public content)
plain_text(blocks) -> str                       # markdown bodies with tags stripped + latex sources + captions, newline-joined: search_text and excerpts
mentioned_slugs(blocks) -> set[str]             # WIKI_LINK_RE over markdown bodies only
WIKI_LINK_RE = re.compile(r'\[\[([a-z0-9][a-z0-9-]*)(?:\|[^\]]*)?\]\]')   # mirrored in frontend/src/lib/utils/renderContent.ts — say so in both files
expand_blocks(blocks) -> list[dict]             # the READ shape: chem gains 'drawing': {image_url, label, width, height, source_format};
                                                # pdf/image gain 'asset': {url, original_name, size_bytes, width, height}. Bulk-fetched (two queries), never per block.
```

Cross-cutting rows (owned by the backend agent, first pass):
- `activity.ActivityEvent.concept = FK('concepts.Concept', null, SET_NULL)`; `ACTIVITY_KIND_CHOICES += ('concept', …), ('concept_revision', …)`; `record_activity(..., concept=None)`; `ConceptArticle` registered in `activity/signals.py`'s `post_delete` list; `remove_activity_for(concept)` on report removal. Migration `activity/0007`.
- `notifications.Notification.concept = FK('concepts.Concept', null, SET_NULL)`; `NOTIFICATION_TYPES += 'concept_revision_pending', 'concept_revision_decided', 'concept_revision_published'` (all ≤ 32 chars); `_PREFERENCE_FIELD_FOR_TYPE` += the three (`notify_on_content_action`, `notify_on_moderation_decision`, `notify_on_content_action`); `notify(..., concept=None)`. Migration `notifications/0020`.
- `moderation.FEATURE_FLAG_CHOICES += ('concepts', 'Concepts: wiki articles per audience')` → `moderation/0039_alter_featureflag_key` + `0040_seed_concepts_flag` (the 0037 shape, seeded ON) + the seeded-flag-set test.
- `moderation/services.py REPORT_KIND_MODELS['concept_article'] = ConceptArticle` with the Service posture (no viewer pool — reports gather for a human, auto-hide no-ops); `_describe`; `_course_for_report_target` (first branch of the concept, else None → staff only).
- `community/targets.py`: `('concepts', 'conceptarticle'): 'conceptArticle'` (public thread; not in `PRIVATE_TARGET_TYPES`).
- `community/attachments.py used_upload_bytes`: `+ sum(ConceptAsset.size_bytes for uploaded_by=user)` (local import) — the docstring's own rule.
- `exercises/views.py TagViewSet.apply`: `kind='concept'` beside `exercise` and `material` (target = a visible concept; `notify_tag_followers` is not widened — §9).
- `config/settings.py`: `'concepts'` in `INSTALLED_APPS`; throttle scopes `concept_revision` 30/hour, `concept_link` 60/hour, `concept_asset` 60/hour (each with the justifying comment every scope carries). `config/urls.py`: `path('api/', include('concepts.urls'))`. `config/cachemw.py PUBLIC_PREFIXES += '/api/concepts/'` (anonymous readers may see a published edit up to 60 s late; editors are authenticated and bypass — acceptable, stated here).

## 3. The rule modules — `backend/concepts/access.py` (who may) and `backend/concepts/resolve.py` (which page)

```python
# access.py — the ONE place; views and serializers ask it (house rule 4: filter AND object check)
visible_articles(user) -> QuerySet          # not removed/auto-hidden AND (has a published revision OR user is staff OR user authored a revision of it)
visible_concepts(user) -> QuerySet          # concepts with at least one article in visible_articles(user)
can_view(concept, user) -> bool             # object-level twin of visible_concepts
can_view_article(article, user) -> bool     # object-level twin of visible_articles
can_view_revision(rev, user) -> bool        # published/superseded → can_view_article; draft → author or staff; pending/rejected/withdrawn → author or can_review
can_autopublish(user, concept) -> bool      # not is_minor AND (staff OR verified contributor OR is_governor_of_course(user, b) for any b in concept.branches)
can_review(user, article) -> bool           # staff, governor of any of concept.branches, or article.created_by
can_pin(user, concept) -> bool              # staff or governor of a branch
can_edit_draft(rev, user) -> bool           # rev.created_by == user or staff
can_edit_metadata(concept, user) -> bool    # staff, governor, or created_by while the concept has no published revision anywhere
link_block_reason(user) -> None | 'authentication_required' | 'minor'
can_remove_link(link, user) -> bool         # added_by, staff, or governor of a branch of link.concept; False for origin='body'
queue_queryset(branch_ids) -> QuerySet      # pending revisions; set → filter(article__concept__branches__in=…).distinct(); None → all

# resolve.py — the read rule, used by the detail serializer, the list serializer and the page's own notice
AUDIENCE_ORDER = ['early_years', 'primary', 'secondary', 'university', 'adult', 'senior']
resolve_page(concept, *, audiences: list[str] | None, locales: list[str], user) -> tuple[tuple[str, str] | None, dict]
    # over pages that have ≥1 visible article WITH a head. Try, in order:
    #   1. each locale in `locales` (interface locale first): exact audience in `audiences`, then 'all'
    #   2. the same locales: the nearest band by AUDIENCE_ORDER distance to any requested band
    #   3. any locale: the same two steps
    #   4. any page at all
    # audiences=None (no preference): 'all' first, then DEFAULT_AUDIENCE, then nearest to it.
    # Returns ((audience, locale) | None, {'audience_exact': bool, 'locale_exact': bool})
pool(concept, audience, locale, user) -> list[ConceptArticle]    # visible articles of the page with a head: pinned first, then head.published_at desc
pages(concept, user) -> list[dict]          # [{audience, locale, article_count, lead_title}] for every page with a visible headed article
```

Minors: `accounts.minors.is_minor(user)` is consulted in `can_autopublish` (never) and
`link_block_reason` (`'minor'`). Minors may write; a person always reviews what they wrote.

## 4. Services — `backend/concepts/services.py` (the slow half; views stay thin)

```python
allocate_slug(title) -> str                            # slugify or 'concept'; numeric suffix while colliding; bounded retry
allocate_number(article) -> int                        # max+1, bounded retry, per-attempt savepoint, IntegrityError+OperationalError
create_concept(user, *, title, summary, blocks, audience, locale, branches, tags, submit) -> tuple[Concept, ConceptArticle, ConceptRevision]
create_article(concept, user, *, audience, locale, title, summary, blocks, change_note, submit) -> tuple[ConceptArticle, ConceptRevision]
    # article + revision 1 (draft); submit=True → submit_revision at once
create_revision(article, user, *, title, summary, blocks, change_note, based_on, submit) -> ConceptRevision
    # one open draft per (article, author) → 409 {'detail': 'draft_exists', 'draft': summary}
save_draft(rev, payload)                               # draft only → 409 'not_draft'
submit_revision(rev, user) -> ConceptRevision
    # 409 'not_draft' unless draft. Stale: article head (may be None) must equal rev.based_on → else raise Stale(head) → 409 {'detail':'stale','head':{…}}
    # can_autopublish(user, concept) → publish_revision; else status='pending', submitted_at=now, notify concept_revision_pending → article.created_by (skip actor)
publish_revision(rev, actor) -> ConceptRevision
    # supersede-first: filter(article, status='published').exclude(pk).update(status='superseded')
    # then ONE WHERE-anchored claim: filter(pk, status__in=('draft','pending')).update(status='published', published_at=now) → 0 rows → Conflict('already_decided')
    # then concept.updated_at bump, harvest_body_links(concept), activity + notifications. On exception: revert both updates and re-raise.
decide_revision(rev, user, decision, note) -> ConceptRevision
    # claim: filter(pk, status='pending').update(reviewed_by, reviewed_at, review_note) → 0 rows → Conflict('already_decided')
    # reject requires a note (400 'note_required') → status='rejected'; accept → publish_revision (no stale refusal: the reviewer saw the diff
    # against the head in the queue row — based_on_is_current is what the row carries)
withdraw_revision(rev, user)                           # author; pending → withdrawn; 409 otherwise
delete_draft(rev, user)                                # draft only; hard delete
set_pinned(article, user, pinned)                      # can_pin; audited
add_link(concept, user, *, target_type, target_id, relation='related') -> ConceptLink
    # LINK_TARGET_MODELS → 404 unknown; target must be visible to the caller → 404; self → 400 'self'; prerequisite on a non-concept → 400 'relation'; duplicate → 409 'already_linked'
remove_link(link, user)                                # can_remove_link → 204; origin='body' → 400 'body_origin'
harvest_body_links(concept)                            # union of blocks.mentioned_slugs over the HEAD revision of every visible article of the concept
                                                       # → visible concepts (excluding self) → sync origin='body' rows: add missing, delete body rows no longer mentioned; manual rows untouched
links_for_target(target_type, target_id, user) -> QuerySet   # visible_concepts(user) only; the exercise/material chip row
store_asset(user, upload) -> ConceptAsset              # community.attachments.process_attachment; quota via used_upload_bytes + Profile allowance (the comment-attachment endpoint's check, same numbers)
```

Side effects (in services, never in views):
- `notify('concept_revision_pending', recipient=article.created_by, actor=rev.created_by, concept=concept)` on a queued submit.
- `notify('concept_revision_decided', recipient=rev.created_by, note=review_note, concept=concept)` on decide.
- `notify('concept_revision_published', recipient=article.created_by and every earlier published/superseded revision's author of that article, actor=rev.created_by, concept=concept)`, skip actor, de-duplicated.
- `record_activity('concept', actor=rev.created_by, concept=concept, target_label=title, source=article)` on the **first** publication anywhere under a concept; `record_activity('concept_revision', …, source=rev)` on every later publish.
- `telemetry.audit.record_audit(request, action='content_edit' | 'moderation_decision', target_type='concept', target_id=concept.pk, summary=…, detail={'article': …, 'revision': …, 'status': …})` for publish/decide, `'content_edit'` with `detail={'link': …}` / `{'pinned': …}` for links and pinning. Instance `.save()`, never `.create()`; called **outside** any `transaction.atomic()`.

## 5. API contract (all JSON snake_case; multipart only on `/api/concept-assets/`)

Gate: `_ConceptsGate = feature_gate('concepts')` on every view. Reads on visible things are `AllowAny`
behind the gate; every write `IsAuthenticated`. Throttle scopes as in §2. `?content_locales=` and
`?audience=` arrive on the list from `client.ts` once `/^\/concepts\/(\?|$)/` is in `AUDIENCE_LIST_PATHS`.

```
GET    /api/concepts/                    ?q= (title/summary/search_text of head revisions, icontains) &branch=<slug> &tag=<slug> &letter=<a-z>
                                         &sort=title|updated (default updated) &audience= &content_locales= &limit= (default 60, max 200)
                                         → [list row]; X-EdMat-Hidden-Languages = concepts with no headed article in the reader's locales
                                         (config/content_locale.py pattern (b) through articles__locale + articles__revisions__status='published').
                                         ?audience= narrows to concepts with a headed article for a requested band or 'all'.
POST   /api/concepts/                    { title, summary?, blocks, audience, locale, branches?: [slug], tags?: [slug], submit?: bool } → 201 detail
GET    /api/concepts/{slug}/             ?audience=<band> ?lang=<locale> ?article=<id> (explicit picks beat the stored preference) → detail; 404 unless can_view
PATCH  /api/concepts/{slug}/             { branches?: [slug] } can_edit_metadata; audited. Tags: /api/tags/{slug}/apply/ kind='concept'.
GET    /api/concepts/{slug}/articles/    every visible article, all pages → [article summary]
POST   /api/concepts/{slug}/articles/    { audience, locale, title, summary?, blocks, change_note?, submit?: bool } → 201 article (full)
GET    /api/concept-articles/{id}/       can_view_article → article (full)
PATCH  /api/concept-articles/{id}/       { pinned: bool } can_pin → 200
GET    /api/concept-articles/{id}/revisions/   published+superseded for anyone who can_view_article; + the caller's own; + everything for can_review. Newest first.
POST   /api/concept-articles/{id}/revisions/   { title, summary?, blocks, change_note?, based_on?: id, submit?: bool }
                                         → 201 revision | 409 {'detail':'stale','head':{…}} | 409 {'detail':'draft_exists','draft':{…}}
GET|POST /api/concept-articles/{id}/comments/   community.views.comment_thread_response, same-thread `parent` check; visibility = can_view_article
GET    /api/concept-revisions/{id}/      can_view_revision → revision (full)
PATCH  /api/concept-revisions/{id}/      draft only, can_edit_draft → save_draft; 409 'not_draft'
DELETE /api/concept-revisions/{id}/      draft only → 204
POST   /api/concept-revisions/{id}/submit/     → 200 revision (pending|published) | 409 stale | 409 not_draft
POST   /api/concept-revisions/{id}/decide/     { decision: accept|reject, note? } can_review → 200 | 409 already_decided | 400 note_required
POST   /api/concept-revisions/{id}/withdraw/   author → 200 | 409
GET    /api/concepts/{slug}/links/       { links: [link], backlinks: [backlink] }   (also embedded in detail)
POST   /api/concepts/{slug}/links/       { target_type, target_id, relation? } → 201 link | 400 {'detail': 'minor'|'self'|'relation'} | 404 | 409 already_linked
DELETE /api/concept-links/{id}/          → 204 | 400 body_origin | 403
GET    /api/concept-links/?target_type=exercise|material&target_id=<pk>   AllowAny → [backlink rows of visible concepts]; [] when the flag is off
POST   /api/concept-assets/              multipart { file } IsAuthenticated, throttle concept_asset → 201 asset | 400 {'file': [...]} | 413-style 400 'quota'
```

Moderation queue (`moderation/services.py`): `build_moderation_queue_payload` gains
`concept_revisions` = `queue_queryset(branch_ids)` serialized with the queue row below;
`count_pending_moderation` gains the matching count. The `material_versions` section is the code to copy.

Serializer shapes:

```
asset            { id, kind, url, original_name, size_bytes, width, height }
block (read)     the stored shape + 'drawing' / 'asset' expansions (blocks.expand_blocks); block (write) = the stored shape
list row         { id, slug, title, summary, audience, locale, article_count, audiences: [band…], locales: [locale…],
                   branch_ids: [slug], branch_names, tags: [slug], updated_at, is_fallback }        (title/summary from the resolved page's lead article)
detail           { id, slug, branch_ids, branch_names, tags, created_by_id, created_by_display_name, created_at, updated_at,
                   page: { audience, locale, audience_exact, locale_exact, articles: [article summary], article: article (full) | null } | null,
                   pages: [{ audience, locale, article_count, lead_title }],
                   links: [link], backlinks: [backlink],
                   my_open: [{ revision_id, article_id, audience, locale, status, updated_at }],   (the caller's draft/pending revisions under this concept; [] anonymous)
                   can_edit_metadata, can_pin, link_block_reason, will_publish }                     (will_publish = can_autopublish for the caller)
article (summary) { id, audience, locale, pinned, title, summary, created_by_id, created_by_display_name, head_published_at, revision_count, comment_count }
article (full)    article (summary) + { concept_id, slug, head: revision (full) | null, my_open: revision (summary) | null, can_review, can_pin, will_publish }
revision (full)   { id, article_id, concept_id, slug, audience, locale, number, status, title, summary, blocks, change_note, based_on_id, based_on_is_current,
                    created_by_id, created_by_display_name, created_at, updated_at, submitted_at,
                    reviewed_by_id, reviewed_by_display_name, reviewed_at, review_note, published_at, will_publish, can_submit, can_decide, can_withdraw, can_delete }
revision (summary){ id, article_id, number, status, title, change_note, created_by_id, created_by_display_name, created_at, published_at }
link              { id, relation, origin, target_type, target_id, target_title, target_slug (concept), target_audience (exercise/material), added_by_id, created_at, can_remove }
backlink          { link_id, concept_id, slug, title, summary, relation, origin }                   (title/summary resolved for the caller like a list row)
queue row         { id, article_id, concept_id, slug, audience, locale, number, title, summary, blocks (read shape), change_note, is_new_concept, is_new_article,
                    based_on_is_current, current: { revision_id, title, blocks } | null, created_by_id, created_by_display_name, created_at, submitted_at, branch_ids, branch_names }
```

Seed: `manage.py seed_concepts` — idempotent by slug — six concepts across three branches: at least one
with articles in three bands, one page with **two** articles by two seeded users, one `all` article,
articles in both pl and en, every block kind used at least once (a markdown block, a latex block, a
chem block on a seeded `ChemDrawing`, a pdf block and an image block on seeded `ConceptAsset`s made from
small generated files), each concept linked to two real exercises and one material of its branch, one
`prerequisite` relation, one `[[…]]` mention. The e2e script and the demo both need it.

## 6. Who touches what — agents and their files

**Agent "backend"** (all of `backend/`). Cross-cutting pass first, in this order, running
`manage.py check` + `makemigrations --check --dry-run` after each: (1) `moderation/models.py` flag +
`0039`/`0040` + seeded-set test; (2) `notifications` types, preference map, FK, `0020`; (3) `activity`
kinds, FK, `0007`, signals; (4) `community/targets.py`, `community/attachments.py used_upload_bytes`;
(5) `moderation/services.py` `REPORT_KIND_MODELS` + describe + course-for-target; (6) `exercises/views.py`
`TagViewSet.apply` kind `concept`; (7) `config/settings.py`, `config/urls.py`, `config/cachemw.py`. Then
the app: `backend/concepts/` — `models`, `blocks`, `access`, `resolve`, `services`, `serializers`, `views`,
`urls`, `admin`, `apps`, `signals`, `tests.py`, `CLAUDE.md`, `migrations/0001_initial`,
`management/commands/seed_concepts.py`; then `moderation/services.py` queue section + count. Finish with
the whole suite green and `makemigrations --check` clean.

**Agent "frontend surfaces"** (new files only, plus the `concept_*` keys they need in **both**
catalogues): `src/lib/types/concept.ts` (+ barrel re-export), `src/lib/services/concepts.ts`, mapper
functions appended to `src/lib/api/mappers.ts` (an append is the one shared-file edit), everything under
`src/lib/components/concept/`, routes `/concepts`, `/concepts/new`, `/concepts/[slug]`,
`/concepts/[slug]/write`, `/concepts/[slug]/articles/[id]/edit`, `/concepts/[slug]/articles/[id]/history`.
Builds against §5 and §7; verifies with `npm run check` / `lint` / `build` before reporting.

**Agent "frontend wiring"** (after "frontend surfaces" reports; shared files only): `lib/api/client.ts`
(`AUDIENCE_LIST_PATHS`), `lib/utils/renderContent.ts` (the `[[…]]` pre-pass), `types/featureFlag.ts` +
`utils/labels.ts` (flag key + label; the §1 unions with a comment naming `backend/concepts/models.py`),
`types/comment.ts` + `services/comments.ts targetPath` (`'conceptArticle'`), `types/report.ts` + report labels
(`'concept_article'`), `TagChip`'s `TaggableKind` + `AddTagToContentModal` (a concepts search branch),
`types/notification.ts` + `NOTIFICATION_TYPE_MAP` + labels + `NotificationCard.svelte` (three types, linking to
`/concepts/<slug>`), `types/activity.ts` + the feed row (two kinds), `Header.svelte` (`browseLinks` "Concepts",
`createItems` "New concept", both behind `can('concepts')`), `routes/+page.svelte` (`TABS` entry `concepts`),
`routes/search/+page.svelte` (a concepts section), `routes/moderation/+page.svelte` (a `concepts` tab, the
`versions` tab as the model), `routes/exercises/[id]`, `routes/materials/[id]`, `routes/branches/[branch]`
(mount `LinkedConcepts` / a concepts section), `e2e/concepts.mjs` (written; run in the next step), and every
key for the above in **both** catalogues. `npm run check` 0/0, `lint`, `build`, `check:katex`, `check:a11y`,
key-set diff.

**Agent "browser verification"** (after "backend" and "frontend wiring"): both servers up, `seed_demo_users`
+ `seed_concepts`, run `e2e/concepts.mjs`, look at every screenshot, fix what it finds on whichever half
(small fixes only; a design problem goes back to the board), re-run to green.

The backend and the two frontend agents share no file. Nobody edits `CLAUDE.md`, `CLAUDE_MAP.md`,
`HISTORY.md` or the boards — the orchestrating session does that at the end.

## 7. Frontend contract

Types (`types/concept.ts`): `Concept`, `ConceptPage`, `ConceptPageRef`, `ConceptArticle`,
`ConceptArticleSummary`, `ConceptRevision`, `ConceptRevisionSummary`, `ConceptBlock` (a discriminated
union on `kind`, read shape with optional `drawing` / `asset`), `ConceptAsset`, `ConceptLink`,
`ConceptBacklink`, `ConceptQueueRow`, `ConceptListRow`, plus the §1 string unions. All ids are
strings; snake→camel in `mappers.ts`. `services/concepts.ts` has one function per §5 endpoint
(`getConcepts`, `searchConcepts`, `getConcept`, `createConcept`, `updateConceptBranches`, `getArticles`,
`createArticle`, `getArticle`, `setArticlePinned`, `getRevisions`, `createRevision`, `getRevision`,
`saveDraft`, `deleteDraft`, `submitRevision`, `decideRevision`, `withdrawRevision`, `getLinks`, `addLink`,
`removeLink`, `getConceptsForTarget`, `uploadConceptAsset` via `postForm`) and nothing else calls `fetch`.

`renderContent.ts`: after the math extraction and **before** markdown-it, replace `[[slug]]` →
`[slug with dashes as spaces](/concepts/slug)` and `[[slug|label]]` → `[label](/concepts/slug)`, with
the same `WIKI_LINK_RE` as `blocks.py` (comment in both files). Running after extraction means `\[\[`
inside stashed maths is never touched; `npm run check:katex` proves it on the corpus. The anchor
survives DOMPurify (relative `href`); `MathContent` already styles `a`.

Components (`src/lib/components/concept/`):
- `BlockRenderer.svelte` — `{ blocks: ConceptBlock[] }`: `markdown` → `MathContent`; `latex` → `MathContent source={'\\[' + source + '\\]'}`; `chem` → `<figure><img class="chem-drawing" src alt={label} width height loading="lazy"><figcaption>`; `pdf` → a row with the name, size, a download link and a "Show preview" toggle mounting the lazy `PdfViewer` (the material page's precedent — never mounted before the click); `image` → `<figure><img><figcaption>`.
- `BlockEditor.svelte` — `bind:blocks`; a vertical list of block cards, each with a kind badge, ▲ ▼ ✕ and an "Add block ▾" menu (the five kinds) below each card and at the end. Per kind:
  - `MarkdownBlockEditor` — `RichEditor` + `InsertStrip` with the `bind:this` / `onChemEdit` pairing from `CommentForm.svelte`, `allowFiles=false` (a PDF is its own block — say so in a comment).
  - `LatexBlockEditor` — a `<textarea>` + a live `MathContent` preview (the InsertStrip LaTeX panel's shape, extracted into this component; leave the strip's own panel alone).
  - `ChemBlockEditor` — "Draw" / "Edit drawing" opens the lazily imported `ChemEditorModal` (`existing` for edits); stores `drawingId` and shows the returned picture; caption input. Hidden when the `chemistry` flag is off and the user cannot moderate (the strip's gate).
  - `PdfBlockEditor` — file input (`accept="application/pdf"`, ≤ 5 MB) → `uploadConceptAsset` → name + size + `PdfViewer` toggle; caption.
  - `ImageBlockEditor` — file input + alt (required) + caption → `uploadConceptAsset` → the picture.
- `ArticleEditor.svelte` — title, summary, `AudienceSelect`, a locale select (`en`/`pl` + the reader's extras; fixed once the article exists), `BlockEditor`, change note, the notice `concept_publicNotice`, buttons **Save draft** / **Submit** (labelled "Publish" when `willPublish`); 409 `stale` shows the head with "reload and redo your change", 409 `draftExists` opens that draft. Create mode (concept: branches via `TaxonomyOptions`, comma-separated tags as `/submit` has), write mode (new article), edit mode (revision of an article; `?revision=` pre-fills from a historical one, based on the head).
- `PageSwitcher.svelte` — one chip per page `(audience, locale)` with its article count, the current selected; **"Write the <band> article"** for the caller's band when that page is missing; the fallback notice line when `audienceExact`/`localeExact` is false.
- `ArticlePool.svelte` — under the switcher: the page's articles as a compact list (title, author, published date, pinned mark), the lead selected; "Write your own article for this audience"; pin/unpin for `canPin`.
- `RevisionList.svelte`, `RevisionView.svelte` (`BlockRenderer` + a per-block diff against the head: markdown blocks through `lib/utils/textDiff.ts` (exists), other kinds "added / removed / changed" markers), `RevisionDecision.svelte` (accept / reject with a note; reject disabled until a note is typed).
- `ConceptLinks.svelte` — Prerequisites, Related concepts, Exercises (`ExerciseCard`), Materials (`MaterialCard`), then "Linked from" backlinks as chips; **Add link** opens `LinkPicker`; body-origin rows carry a "from the text" mark and no remove button.
- `LinkPicker.svelte` — kind switch (exercise | material | concept) + debounced search (`searchExercises`, `searchMaterials`, `searchConcepts`; the `AddTagToContentModal` shape) + a relation select for concept targets.
- `LinkedConcepts.svelte` — the chip row for `/exercises/[id]`, `/materials/[id]`: `getConceptsForTarget`, self-hides when empty or the flag is off (`AppearsInSessions` precedent), plus "Link a concept" for a signed-in adult.
- `ConceptCard.svelte` — list/search card: title (`MathTitle`), summary, audience + locale badges, "N articles", branch and tag chips.

Routes: `/concepts` (`+page.ts` prerendered; search box, `letter` strip, branch/tag/sort filters from the
URL, `HiddenLanguagesNotice path="/concepts/"`, data in `onMount`), `/concepts/new` (`ArticleEditor` create
mode), `/concepts/[slug]` (`?audience=&lang=&article=`; breadcrumb from the first branch, `PageSwitcher`,
`ArticlePool`, `MathTitle` h1, summary, "by <author> · revision N · <date>", `BlockRenderer`, **Edit this
article** / **History**, `ConceptLinks`, tags with `TagChip appliedTo`, `ReportButton kind="concept_article"
objectId={article.id}`, Discussion via `getCommentsForTarget('conceptArticle', article.id)`; `PageHead`),
`/concepts/[slug]/write?audience=&lang=`, `/concepts/[slug]/articles/[id]/edit?revision=` (opens the caller's
open draft when one exists), `/concepts/[slug]/articles/[id]/history` (`RevisionList` + selected `RevisionView`
+ `RevisionDecision` for reviewers). Every route inside `FeatureGate feature="concepts"`; dynamic routes
carry the id-changed idempotency guard (`frontend/CLAUDE.md` trap 2); no service call at component top
level (trap 5 and the prerender rule).

Gating: `Header.svelte` uses `can('concepts')` for both snippets; `LinkedConcepts` renders nothing when
`featureFlagsStore.isEnabled('concepts')` is false and the user cannot moderate. Killed → no tab, nav
entry, menu item, chip rows, search section or moderation tab.

i18n: prefix `concept_`; notification keys `notification_conceptRevisionPending` / `…Decided` / `…Published`;
`moderation_tab_concepts`; the two activity kinds. **Both catalogues in the same change; verify the key
sets are identical.** Every `m.*()` call site carries its trailing `// "Original text"` comment.

## 8. Verification (nothing runs in CI — run it, and say so on the board)

Backend: `manage.py test` (whole suite), `manage.py check`, `makemigrations --check --dry-run`.
Tests to exist (`concepts/tests.py`, sentence-named classes as `galleries/tests.py`): a stranger gets
404 on a concept whose only article has only a pending revision, its author gets 200; a verified
contributor's first revision is `published` and a plain user's is `pending`; a minor verified contributor
still queues; the article's author can decide a stranger's revision of it and a stranger cannot; 409 on
a stale submit and on a double decision; exactly one `published` per article after two accepts
(supersede-first); reject needs a note; withdraw; draft PATCH/DELETE by author only; `draft_exists`;
two articles on one page order pinned-first then newest head, and `?article=` picks the other;
`resolve_page` fallback order with the exact flags; list narrows by `content_locales` and reports the
hidden count; `?audience=` admits `all`; `?q=` finds text inside a markdown block and a latex block
(search_text); `clean_blocks` refuses an unknown kind, an over-long body, a missing asset, an image
asset in a pdf block, and sanitizes a `<script>` in a markdown body; `expand_blocks` runs two queries
for any number of blocks; asset upload re-encodes a PNG to WebP and refuses a PE file named `.pdf`
(the attachment tests' fixtures); quota counts assets; link add/remove circle (adder, staff, governor,
stranger, minor), self-link, prerequisite on an exercise, duplicate 409; body links harvested on publish
across articles and re-synced when a mention is removed, manual rows untouched, `body_origin` refusal;
`GET /api/concept-links/?target_type=exercise` lists only visible concepts and `[]` with the flag off;
the queue section is branch-scoped for a governor, unscoped for staff, and a branch-less concept reaches
staff only; the three notifications honour the preference gate; an activity row on first publish and
on a later publish, none for a draft; report removal of an article hides it and, when it was the last,
the concept and its backlinks; tag apply with `kind='concept'`; `seed_concepts` is idempotent.

Frontend: `npm run check` (0/0), `npm run lint`, `npm run build`, `npm run check:katex`,
`npm run check:a11y`; key-set diff of the two catalogues.

Browser (`e2e/concepts.mjs`, both servers up, `seed_demo_users` + `seed_concepts`): a plain user creates
a concept with a markdown block, a latex block and an image block → invisible to a second browser →
staff accept from the moderation tab → it appears on `/concepts`, the home tab and search; a verified
contributor writes a `primary` article with a chemistry block and a PDF block → a reader with the
`primary` band sees it, the PDF preview opens on click, and a reader with `senior` sees the fallback
notice; a second person writes their own `primary` article → the pool lists two and `?article=`
switches; an edit based on a stale head gets the 409 dialogue; the article's author accepts a stranger's
revision from the history page; `[[derivative]]` in a markdown block renders as a link and shows as a
backlink on `/concepts/derivative`; linking an exercise from the concept page shows the chip on the
exercise page; flag off hides tab, nav, chips and search section. Screenshots looked at.

## 9. Left open by design (name them on the board when landing)

- The CC BY-SA contributor line (lawyer review first, `LEGAL.md` §2).
- Votes on articles in a pool (the `SolutionEntryVote` shape) — ordering is pinned + newest for now.
- Slug rename (staff, admin only) and merging two concepts.
- Watching a concept (`ConceptFollow`) and `notify_tag_followers` for concepts.
- `[[slug]]` mentions inside exercise statements and material bodies render as links but are **not** harvested; only concept articles are.
- No `[[` autocomplete in the editor; a `@tiptap/suggestion` popover is the obvious next step.
- A chemistry block on a read page is a picture; reopening the drawing read-only is not built.
- Galleries on a concept; concept claims (`ClaimBase` fits, deferred until somebody asks).
- Courses cannot file a concept as content (`contentLinks.ts PATH_KINDS`).
- Per-article talk exists; per-concept talk does not.
- No people search is needed here — deliberately.
