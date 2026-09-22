# Co-authoring — the contract every agent on this feature builds against

Written 2026-09-20 on branch `coauthoring`. This is the spec; `HISTORY.md` §17BC will be the
write-up once it lands. Read the root `CLAUDE.md`, then `backend/CLAUDE.md` or `frontend/CLAUDE.md`
for your half, then this file. When this file and the code disagree after landing, the code wins
and this file gets corrected.

**What it is.** A new app, `coauthoring`, that gives every material a *project* with a *team* and a
history of immutable *versions*. Improving a material = proposing a version the team accepts or
rejects. Creating one together = a draft project whose first version goes through the existing
moderation queue. The `Material` row stays the **published projection**: publishing a version copies
its payload onto the material and its title/description onto the original-locale translation row,
so every existing read site (listings, courses, galleries, reports, activity) keeps working unchanged
and a killed switch never removes a material.

## 0. Decisions already taken (Piotr's call, inferred for an open-source / open-science project)

| Question | Decision |
|---|---|
| Do co-authors publish without staff review? | **Yes.** Staff/governors review only a project's *first* publication and proposals on *orphan* materials (no members). Reports + the kill switch cover abuse, the same bet posts and galleries make. |
| Minors | May **propose** (a person always reviews a proposal). May **not** create a project, be added, accept an invite or ask to join — refused with reason `minor`. |
| The single-shot `/submit-material` form | **Folded** into "a project with a team of one" in phase 3, and `moderation.MaterialSubmission` retired with a data migration. Two ways to create a material is the defect the board already names. |
| Licence text | **Not written.** `LEGAL.md` §2 says to check with Piotr before any new licensing text. The version editor shows a factual notice (public, attributed, may be improved by others); the CC BY-SA line is a named gap in `LEGAL.md` and on the board. |
| Real-time editing | Still out (PRODUCT.md non-goal). Collaboration is turn-based: every save is a new version, a stale save gets **409** with the current head. |
| Name | app `coauthoring`; UI "Co-authoring" / "Współtworzenie"; noun "project" / "projekt"; members are "co-authors" / "współautorzy". |
| Kill switches | `coauthoring` (new) gates collaboration on existing materials: versions, proposals, members, invites, join requests. `material_submissions` (existing) keeps gating **creating a new material** (project creation + the submit form). Two abilities, two switches. `material_uploads_verified_only` applies to any version that carries a file. |

## 1. Vocabulary (mirror these strings exactly on both halves)

```
MaterialVersion.status   draft | proposed | published | superseded | rejected | withdrawn
MaterialVersion.kind     file | link | body
ProjectMember.role       owner | coauthor
ProjectJoinRequest.status  pending | accepted | declined | withdrawn
scan_status              skipped | clean | flagged        (same as MaterialSubmission today)
decision (request body)  accept | reject                 (versions)   accept | decline (join requests)
```

No `approved` anywhere in this app — the exercise/translation vocabulary clash (`approved` vs
`published`) is documented in `backend/moderation/CLAUDE.md`; the positive terminal state here is
what the row *is*: `published`.

**Head** = the highest-numbered version whose status is `draft` or `published`. **Published** = the
one `published` row (partial unique). For a non-member, head == published.

## 2. Data model — `backend/coauthoring/models.py`

```python
class MaterialProject(models.Model):
    material = models.OneToOneField('materials.Material', null=True, blank=True,
                                    on_delete=models.CASCADE, related_name='project')
    branch = models.ForeignKey('taxonomy.Branch', on_delete=models.CASCADE, related_name='material_projects')
    locale = models.CharField(max_length=8, default='pl')      # language of the versions' title/description
    # Catalogue fields, used ONLY while drafting (material is NULL). After first publication these
    # are read from / written to the Material row; the copies here are frozen and ignored.
    type = models.CharField(max_length=50, blank=True)         # validate_material_type on write
    audience = models.CharField(max_length=12, choices=AUDIENCE_CHOICES, default=DEFAULT_AUDIENCE)
    author = models.CharField(max_length=200, blank=True)      # free text provenance, never a FK
    source_url = models.URLField(max_length=500, blank=True)
    price_amount = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    price_currency = models.CharField(max_length=3, choices=CURRENCY_CHOICES, default='PLN', blank=True)
    estimated_minutes = models.PositiveIntegerField(null=True, blank=True)
    requirements = models.JSONField(default=list, blank=True)   # list[str]
    coverage = models.JSONField(default=list, blank=True)       # list[{topic_id, level, kind}]
    seeking_coauthors = models.BooleanField(default=False)
    seeking_note = models.CharField(max_length=500, blank=True)
    created_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL,
                                   related_name='material_projects_created')
    created_at = models.DateTimeField(auto_now_add=True)
    # save(): on self._state.adding and created_by set → get_or_create the owner ProjectMember row
    # (the Course.save() precedent; seeds/admin/tests create projects too).

class ProjectMember(models.Model):
    project = FK(MaterialProject, related_name='members', CASCADE)
    user = FK(User, related_name='material_project_memberships', CASCADE)
    role = CharField(10, choices owner|coauthor)
    added_by = FK(User, null, SET_NULL, related_name='+')
    added_at = auto_now_add
    constraints: UniqueConstraint(project, user, name='unique_member_per_project')
                 UniqueConstraint(fields=['project'], condition=Q(role='owner'), name='one_owner_per_project')

class ProjectInvite(models.Model):
    project = FK(MaterialProject, related_name='invites', CASCADE)
    token = CharField(64, unique=True, db_index=True)   # secrets.token_urlsafe(32)
    label = CharField(100, blank=True)
    created_by = FK(User, null, SET_NULL, related_name='+')
    max_uses = PositiveIntegerField(default=0)           # 0 = unlimited
    uses = PositiveIntegerField(default=0)
    expires_at = DateTimeField(null=True, blank=True)
    revoked_at = DateTimeField(null=True, blank=True)    # revoke = timestamp, never delete
    created_at = auto_now_add
    def unusable_reason(self, now=None) -> 'revoked' | 'expired' | 'used_up' | None

class ProjectJoinRequest(models.Model):
    project = FK(MaterialProject, related_name='join_requests', CASCADE)
    user = FK(User, related_name='material_project_join_requests', CASCADE)
    statement = TextField()                              # ≥ 20 chars, like GovernorApplication
    status = CharField(10, pending|accepted|declined|withdrawn, default pending)
    decided_by = FK(User, null, SET_NULL, '+'); decided_at = DateTimeField(null); decision_note = TextField(blank)
    created_at = auto_now_add
    constraints: UniqueConstraint(fields=['project','user'], condition=Q(status='pending'), name='one_pending_join_request')

class MaterialVersion(models.Model):
    project = FK(MaterialProject, related_name='versions', CASCADE)
    number = PositiveIntegerField()                      # 1-based, allocated max+1 in a bounded retry loop
    status = CharField(10, choices §1, default 'draft')
    kind = CharField(5, choices file|link|body)
    file = FileField(upload_to=version_upload_path,      # 'material_versions/<uuid32><ext>'
                     blank=True, validators=[validate_material_submission_file])
    url = URLField(500, blank=True)
    body = TextField(blank=True)                         # Markdown+HTML+LaTeX, sanitized in save()
    title = CharField(300)                               # sanitized in save()
    description = TextField(blank=True)                  # sanitized in save()
    change_note = CharField(500, blank=True)
    based_on = FK('self', null, blank, SET_NULL, related_name='+')
    created_by = FK(User, null, SET_NULL, related_name='material_versions')
    created_at = auto_now_add
    decided_by = FK(User, null, SET_NULL, '+'); decided_at = DateTimeField(null); decision_note = TextField(blank)
    published_at = DateTimeField(null, blank)
    scan_status = CharField(10, skipped|clean|flagged, default 'skipped'); scan_detail = CharField(200, blank)
    file_size = PositiveBigIntegerField(default=0)       # recorded at upload; the quota still sums live
    file_reclaimed_at = DateTimeField(null, blank)       # rejected/withdrawn file blobs are reclaimed, row kept
    Meta: ordering ['project', 'number']
          UniqueConstraint(project, number, name='unique_version_number')
          UniqueConstraint(fields=['project'], condition=Q(status='published'), name='one_published_version_per_project')
    # "exactly one payload" is enforced in clean() + the serializer, NOT a DB CheckConstraint:
    # a rejected file version has its blob reclaimed (file='') and must remain a valid row.
    def is_visible_to_readers(self): return self.status in ('published', 'superseded')
```

Also (owned by the cross-cutting agent):
- `materials.Material.body = TextField(blank=True)` + `Material.clean()` becomes file-or-url-or-body;
  `MaterialSerializer` gains `body` and `project_id` (int | null, read via `getattr(obj, 'project', None)`).
- `materials.MaterialTranslation.updated_at = DateTimeField(auto_now=True)` (for the stale marker).
- `notifications.Notification.material_project = FK('coauthoring.MaterialProject', null, SET_NULL)`
  and `notify(..., material_project=None)` (owned by the app agent, after the cross-cutting one).

## 3. The rule module — `backend/coauthoring/access.py` (the ONE place; views ask it)

```python
role_of(project, user) -> 'owner' | 'coauthor' | None           # iterates project.members.all() (prefetch-friendly)
is_member(project, user) -> bool
can_manage(project, user) -> bool      # owner, staff, or governor (material governor once published, else branch governor)
can_edit(project, user) -> bool        # member, staff, or governor — saves drafts, publishes, edits catalogue
can_view(project, user) -> bool        # published material → everyone; draft → member/staff/governor;
                                       # seeking draft → everyone sees the TEASER (serializer decides fields)
visible_projects(user) -> QuerySet     # the queryset half of can_view (house rule 4: you need both)
can_view_version(version, user) -> bool   # published/superseded → whoever can_view the project;
                                          # draft → can_edit; proposed/rejected/withdrawn → author + can_edit
can_decide(version, user) -> bool      # first publication (project.material is None) or orphan project
                                       # (no members): staff or is_governor_of_course(user, project.branch);
                                       # otherwise: member, staff, or is_governor_of_material(user, material)
can_autopublish_first(user, branch) -> bool   # staff / verified contributor / branch governor (mirrors exercises.entries.can_autopublish_entry)
needs_staff_review(project) -> bool    # project.material is None or project has no members
propose_block_reason(project, user) -> None | 'authentication_required' | 'member' | 'not_published' | 'removed' | 'pending_exists'
join_block_reason(project, user)    -> None | 'authentication_required' | 'not_seeking' | 'member' | 'minor' | 'pending_exists' | 'published'
```

Minors: `accounts.minors.is_minor(user)` is consulted in project create, member add, invite accept
and join request → 400 `{'detail': 'minor'}`.

## 4. Services — `backend/coauthoring/services.py` (the slow half; views stay thin)

```python
allocate_number(project) -> int                        # SQLite rule 3: bounded retry, per-attempt savepoint, IntegrityError+OperationalError
create_project(user, *, branch, locale, catalogue: dict, version_payload: dict) -> MaterialProject   # project + owner row + version 1 (draft)
save_version(project, user, payload, *, based_on) -> MaterialVersion
    # member/staff/governor → status 'draft'; anyone else → 'proposed' (based_on must be the PUBLISHED version)
    # based_on != head.id → raise Stale(head)  → view answers 409 {'detail':'stale','head':{...summary}}
    # file payload: validate_material_submission_file (field validator), process_material_file, scan_for_malware
    #   → scan_status/scan_detail, file_size; per-account quota via Profile.material_upload_bytes (+ incoming size);
    #   RequireVerifiedContributorForMaterialUploads semantics when the version carries a file
publish_version(version, user) -> MaterialVersion
    # requires status 'draft' and number > (published.number or 0), else Conflict('not_draft' | 'stale')
    # first publication and not can_autopublish_first → status 'proposed' (queue), return
    # else: supersede-first (one UPDATE published→superseded), then ONE WHERE-anchored claim draft→published,
    #       then sync_material(); on exception revert both and re-raise (the _publish_translation shape)
decide_version(version, user, decision, note) -> MaterialVersion
    # claim: filter(pk, status='proposed').update(status=target, decided_by, decided_at, decision_note); 0 rows → Conflict('already_decided')
    # reject requires a note (400 'note_required'); reject reclaims a file blob (row kept, file_reclaimed_at)
    # accept → the publish path above (including materialise for a first publication); revert claim on failure
withdraw_version(version, user)                         # proposer only, proposed → withdrawn, reclaim blob
sync_material(project, version)                         # THE projection: Material.file/url/body from kind, then
                                                        # MaterialTranslation.update_or_create(material, locale=project.locale, title, description)
materialise(project, version, actor) -> Material        # first publication: materials.publish.create_material(...) with the
                                                        # project's catalogue + the version payload; sets project.material,
                                                        # Material.submitted_by = the owner (or actor)
reclaim_version_file(version)
add_member(project, user, *, role='coauthor', added_by)   # refuse minors, refuse duplicates ('already_member')
remove_member(project, user, *, by)                       # owner_immutable → 400
transfer_ownership(project, from_user, to_user)           # demote first, then promote (the partial unique index)
accept_invite(invite, user)                               # unusable_reason precheck; already_member; minor;
                                                          # claim: filter(pk, revoked_at__isnull=True).filter(Q(max_uses=0)|Q(uses__lt=F('max_uses'))).update(uses=F('uses')+1) → 0 rows → 'used_up'
decide_join_request(req, user, decision, note)            # accept → add_member; claim → 409 on race
```

Side effects (all in services, never in views):
- `notifications.services.notify(...)` types (preference field):
  `material_version_proposed` → every member, skip actor (`notify_on_content_action`);
  `material_version_decided` → version.created_by, note=decision_note (`notify_on_moderation_decision`);
  `material_version_published` → other members (`notify_on_content_action`);
  `project_invite_used` → invite.created_by (`notify_on_content_action`);
  `project_member_added` → the added user (`notify_on_content_action`);
  `project_join_requested` → every member (`notify_on_content_action`);
  `project_join_decided` → the requester, note (`notify_on_moderation_decision`).
  Pass `material=` when the project has one, else `material_project=`.
- `activity.services.record_activity('material_version', actor=version.created_by, material=material,
  target_label=version.title, source=version)` on publish of a version of a **published** material
  (never on the backfilled v1, never on a first publication — that one already records kind
  'material' inside `create_material`). The forgetting half: `remove_activity_for(material)` already
  fires on report removal; register `MaterialVersion` in `activity/signals.py`'s `post_delete` list.
- `telemetry.audit.record_audit(request, action=..., target_type='material_project', target_id=project.pk, summary=..., detail={...})`
  for publish/decide (`content_edit` / `moderation_decision`) and member/invite/transfer (`permission_change`).
  Instance `.save()`, never `.create()`; called OUTSIDE any `transaction.atomic()`.

## 5. API contract (all JSON snake_case; multipart where a file may be sent)

Gates: `_CoauthGate = feature_gate('coauthoring')`; `_CreateGate = feature_gate('material_submissions')` on
project creation only. Reads on a **published** material's project (project GET, versions list of
published/superseded, members) are `AllowAny` behind the gate; everything else `IsAuthenticated`.
Throttle scopes (add to `config/settings.py`): `material_version` 30/hour, `project_invite` 30/hour, `project_join` 10/hour.

```
GET    /api/material-projects/                 ?mine=1 (member of, IsAuthenticated) | ?seeking=1 [&branch=<slug>] (public teasers) | ?material=<id>
POST   /api/material-projects/                 create a DRAFT project (material_submissions gate; minors refused)
       body: { branch (slug), locale, type, audience, author?, source_url?, price_amount?, price_currency?,
               estimated_minutes?, requirements?: [str], coverage?: [{topic_id, level, kind}],
               title, description?, kind, file? | url? | body?, change_note? }        → 201 project (with head_version)
GET    /api/material-projects/{id}/            project (or the teaser for a non-member of a seeking draft); 404 otherwise
PATCH  /api/material-projects/{id}/            can_edit; catalogue fields (routed to the Material after publication),
                                               seeking_coauthors, seeking_note, locale (drafting only); audited
GET    /api/material-projects/{id}/versions/   list: members/staff/governors see all; others see published+superseded (+ their own proposals)
POST   /api/material-projects/{id}/versions/   save_version — body: { kind, file?|url?|body?, title, description?, change_note?, based_on }
                                               201 version | 409 {detail:'stale', head:{…}} | 400 {detail: propose_block_reason}
GET    /api/material-versions/{id}/            can_view_version
POST   /api/material-versions/{id}/publish/    can_edit → 200 version with status 'published' OR 'proposed' (first publication needing review)
                                               409 {detail:'not_draft'|'stale'}
POST   /api/material-versions/{id}/decide/     { decision: accept|reject, note? } can_decide; 409 {detail:'already_decided'}; 400 {detail:'note_required'}
POST   /api/material-versions/{id}/withdraw/   proposer; 409 if not proposed
GET|POST /api/material-versions/{id}/comments/ community.views.comment_thread_response, same-thread `parent` check; visibility = can_view_version
GET    /api/material-projects/{id}/members/    [{ user_id, display_name, role, added_at }]
POST   /api/material-projects/{id}/members/    { user_id } can_manage → 201 | 400 {detail:'minor'|'already_member'}
DELETE /api/material-projects/{id}/members/{user_id}/   can_manage, or the member themself (leave); 400 {detail:'owner_immutable'}
POST   /api/material-projects/{id}/transfer/   { user_id } owner only (staff too) → 200 project
GET|POST /api/material-projects/{id}/invites/  can_manage; POST { label?, max_uses?, expires_at? } → 201 { id, token, url_path, label, max_uses, uses, expires_at, revoked_at, created_at, is_usable, unusable_reason }
DELETE /api/material-projects/{id}/invites/{invite_id}/   revoke (timestamp) → 204
GET    /api/project-invites/<token>/           AllowAny, thin: { project_id, material_id, title, branch_name, created_by_display_name, is_usable, unusable_reason }
POST   /api/project-invites/<token>/accept/    IsAuthenticated → 200 project | 400 {detail:'revoked'|'expired'|'used_up'|'minor'|'already_member'}
GET|POST /api/material-projects/{id}/join-requests/   members list pending; POST { statement } → 201 | 400 {detail: join_block_reason} | 409 already_pending
POST   /api/project-join-requests/{id}/decide/  { decision: accept|decline, note? } can_manage; decline requires note
POST   /api/project-join-requests/{id}/withdraw/
```

Moderation queue (`moderation/services.py`): `build_moderation_queue_payload` gains
`material_versions` = `MaterialVersion` rows with `status='proposed'` where `needs_staff_review(project)`,
filtered by `project__branch_id__in` when `branch_ids` is a set (never when `None`), serialized with
the queue serializer below; `count_pending_moderation` gains the matching `material_versions` count.
Decisions go through `/api/material-versions/{id}/decide/` — **never a new `_KIND_MODELS` kind**
(`backend/moderation/CLAUDE.md`, the solution_entries precedent).

Serializer shapes:

```
version (full)    { id, project_id, material_id, number, status, kind, file_url, file_name, url, body, title, description,
                    change_note, based_on_id, created_by_id, created_by_display_name, created_at,
                    decided_by_id, decided_by_display_name, decided_at, decision_note, published_at,
                    scan_status, scan_detail, file_size, comment_count, can_publish, can_decide, can_withdraw }
version (summary) { id, number, status, kind, title, change_note, created_by_id, created_by_display_name,
                    created_at, published_at, file_url, file_name, url, scan_status }
project           { id, material_id, branch_id (slug), branch_name, locale, type, audience, author, source_url,
                    price_amount, price_currency, estimated_minutes, requirements, coverage, seeking_coauthors,
                    seeking_note, created_by_id, created_at, title, description,
                    published_version (summary|null), head_version (summary|null; == published for non-members),
                    members [{user_id, display_name, role, added_at}], member_count,
                    my_role, can_edit, can_manage, can_propose, propose_block_reason,
                    join_block_reason, pending_proposals_count (members only, else 0), pending_join_requests_count (managers only) }
teaser            same keys; catalogue + title/description/seeking_* filled; versions null; members display names only;
                    my_role null; can_* false
queue row         { id, project_id, number, kind, title, description, file_url, file_name, url, body_excerpt (200 chars, tags stripped),
                    scan_status, scan_detail, created_by_id, created_by_display_name, created_at, branch_id, branch_name,
                    type, author, source_url, requirements, coverage, price_amount, price_currency, estimated_minutes, audience, is_first_publication }
join request      { id, project_id, user_id, display_name, statement, status, decided_by_id, decided_at, decision_note, created_at }
```

Backfill (`coauthoring/migrations/0002_backfill_projects.py`, reversible to a no-op): for every
existing `Material` create a project (`branch`, `locale` = its lone translation's locale, else `pl`;
catalogue copied), an owner row from `submitted_by` when set, and a `published` version 1
(`kind` from file/url, the **same stored file reference**, title/description from that translation,
`published_at = material.created_at`, `created_by = submitted_by`). No activity rows, no notifications.

## 6. Cross-cutting wiring (who touches what)

**Agent "cross-cutting backend" (runs first):**
- `moderation/models.py` FEATURE_FLAG_CHOICES += `('coauthoring', 'Co-authoring materials: versions, teams, proposals')`;
  migrations `0036_alter_featureflag_key` + `0037_seed_coauthoring_flag`; the seeded-flag-set test in `moderation/tests.py`.
- `notifications/models.py` NOTIFICATION_TYPES += the seven types in §4 (all ≤ 32 chars);
  `notifications/services.py` `_PREFERENCE_FIELD_FOR_TYPE` += the seven; migration `0018_alter_notification_type`.
- `activity/models.py` ACTIVITY_KIND_CHOICES += `('material_version', …)`; migration `0006_material_version_kind`.
- `telemetry/audit.py` new: `record_audit(request, *, action, target_type, target_id, summary, detail=None)`;
  `courses/history.py record_content_change` becomes a thin wrapper over it. Honour its two rules.
- `community/targets.py`: `('coauthoring', 'materialversion'): 'materialVersion'` in `TARGET_TYPE_BY_MODEL` **and** in `PRIVATE_TARGET_TYPES`.
- `materials/publish.py` new: `create_material(*, branch, type, audience, submitted_by, locale, title, description, file=None, url='', body='', author='', source_url='', price_amount=None, price_currency='PLN', estimated_minutes=None, requirements=(), coverage=(), activity_actor=None) -> Material`
  extracted from `moderation/views.py _apply_material_submission` (slug loop, Material, MaterialTranslation, requirements, coverage, `record_activity('material', …)`); `_apply_material_submission` becomes a call to it.
- `materials/models.py`: `Material.body`, `Material.clean()` file-or-url-or-body, `MaterialTranslation.updated_at`; migration `0018_material_body_translation_updated_at`.
- `materials/serializers.py`: `body`, `project_id` on the material serializers (read-only).
- `manage.py check`, `makemigrations --check --dry-run`, `manage.py test materials moderation notifications activity courses telemetry community` green.

**Agent "coauthoring app" (runs second):** everything under `backend/coauthoring/` (`models`, `access`, `services`,
`serializers`, `views`, `urls`, `admin`, `signals` for the activity post_delete hook, `apps`, `tests`, `CLAUDE.md`,
migrations `0001_initial` + `0002_backfill_projects`), `config/settings.py` (INSTALLED_APPS + throttle scopes),
`config/urls.py` (`path('api/', include('coauthoring.urls'))`), `notifications` FK + `notify(material_project=)` +
migration `0019_notification_material_project`, `accounts/models.py Profile.material_upload_bytes` also summing
`MaterialVersion.file` sizes (local import), `moderation/services.py` queue section + count, and
`materials/serializers.py translation_stale` (resolved-locale translation `updated_at` < `published_version.published_at`
and locale ≠ `project.locale`). Full suite green, `makemigrations --check` clean.

**Agent "frontend new surfaces" (in parallel with the backend):** only NEW files plus two mounts —
`src/lib/types/materialProject.ts` (+ re-export from `types/index.ts`), `src/lib/services/materialProjects.ts`,
mapper functions appended to `src/lib/api/mappers.ts`, `src/lib/components/coauthoring/*`, routes
`/material-projects`, `/material-projects/new`, `/material-projects/[id]`, `/material-projects/[id]/versions/[number]`,
`/project-invites/[token]`, the `ProjectPanel` mount on `/materials/[id]`, and every `coauth_*` message key it needs in
**both** catalogues.

**Agent "frontend wiring" (after the new-surfaces agent):** shared files only — `Header.svelte` (Add… item behind
`can('material_submissions')`, and a "Co-authoring" entry where the account menu lists things of mine), `moderation/+page.svelte`
(a `versions` section rendering `material_versions` with the same row content as the material queue, decide via the app endpoint),
`settings/+page.svelte` (link to `/material-projects?tab=mine`), `types/featureFlag.ts` + `utils/labels.ts` (flag key + label),
`types/notification.ts` + `mappers.ts NOTIFICATION_TYPE_MAP` + `labels.ts` (category + label) + `NotificationCard.svelte` (seven types,
linking to the material or the project), `types/comment.ts CommentTargetType += 'materialVersion'`, `types/material.ts` `body`/`projectId`/
`translationStale` + mapper, `MaterialCard.svelte` ("Read" instead of Download/Open for a body material; body rendered on the detail page),
the stale-translation notice on `/materials/[id]`, `PageHead` titles for the new routes, `e2e/coauthoring.mjs` (written, run later),
message keys for all of the above in both catalogues.

**Phase 3 agents (after phases 1–2 are green):**
- backend: data migration `coauthoring/0003_fold_material_submissions` (pending → draft project + `proposed` version;
  rejected → draft project + `rejected` version with decision fields and the reclaimed-file stamp; approved → link
  `resulting_material.project`'s v1 `created_by`/`scan_status`), then remove `MaterialSubmission` (model, viewset, serializer,
  `_KIND_MODELS['material']`, `_apply_material_submission`, `_reclaim_rejected_material_file`, queue section + count,
  `Profile.material_upload_bytes` submission half, tests) with `moderation/00xx_delete_materialsubmission` depending on the fold;
  keep the `material_submission_*` notification types (history rows carry them). Grep the whole backend, seeds and `setup.sh`.
- frontend: `/submit-material` rewritten onto `POST /api/material-projects/` + `publish/` (same form, same "Other…" pickers,
  same `FeatureGate feature="material_submissions"`), the moderation `materials` tab reads `material_versions` only,
  `types/materialSubmission.ts` + `submitMaterial`/`getMaterialSubmissionsForBranch` removed, `lib/utils/textDiff.ts`
  (in-house word/line LCS, lazily imported) used by the version page for body/title/description comparison.

## 7. Frontend contract

Files: `types/materialProject.ts` exports `MaterialProject`, `MaterialProjectTeaser`, `MaterialVersion`, `MaterialVersionSummary`,
`ProjectMember`, `ProjectInvite`, `ProjectJoinRequest`, `ProjectInvitePreview`, plus the string unions from §1 (mirrored in
`utils/labels.ts` with a comment naming `backend/coauthoring/models.py`, house rule 13). All ids are strings; snake→camel in
`mappers.ts` (`mapMaterialProject`, `mapMaterialVersion`, …). `services/materialProjects.ts` has one function per endpoint
in §5 and nothing else calls `fetch`.

Components (`src/lib/components/coauthoring/`):
- `ProjectPanel.svelte` — on `/materials/[id]` under the previews: "Version N · published <date> by <name>", the co-authors,
  a link to the project page, **Improve this material** (readers; opens `VersionEditor` in propose mode inline, the exercise
  page's inline-card precedent), **Edit** (members), the propose-block reason line when refused.
- `VersionList.svelte` — history rows with status badges, download links, "open".
- `VersionView.svelte` — renders one version: PDF via the existing lazy `PdfViewer`, pictures inline, links, body via `MathContent`.
- `VersionEditor.svelte` — kind switch (file / link / body); body uses `RichEditor` with `InsertStrip` (`allowFiles=false`);
  title, description, change note; the licence-neutral notice `coauth_publicNotice`; buttons by role: Save draft / Publish /
  Propose; a 409 `stale` shows the head with "reload and redo your change".
- `VersionDecision.svelte` — accept / reject with a note (reject disabled until a note is typed, the entries-tab precedent).
- `MembersPanel.svelte`, `InvitesPanel.svelte` (mirror the course invite UI: create, copy link, revoke), `JoinRequestsPanel.svelte`.
- `ProjectCard.svelte` — teaser card for `/material-projects` listings; `CatalogueForm.svelte` — type / audience / author /
  source URL / price / minutes / coverage / requirements, with the same "Other…" pickers `/submit-material` has.

Routes: `/material-projects` (tabs `mine` | `seeking`; the account menu links here), `/material-projects/new` (start together;
behind `material_submissions`), `/material-projects/[id]` (project page: head rendered, versions, members, invites, join requests,
editor), `/material-projects/[id]/versions/[number]` (version page + review thread via `DiscussionThread target='materialVersion'` +
`VersionDecision`), `/project-invites/[token]` (preview, accept; noindex). Every new route inside `FeatureGate`.

Gating: `Header.svelte` uses `can('coauthoring')` / `can('material_submissions')`; `ProjectPanel` renders nothing when
`featureFlagsStore.isEnabled('coauthoring')` is false and the user cannot moderate. Killed → no panel, no menu items, no routes.

i18n: prefix `coauth_`; notification keys follow `notification_materialVersionProposed` etc. and `notifPref_*` if a new
preference row is needed (it is not: the seven types map to existing categories). **Both catalogues in the same change;
verify the key sets are identical.** Every `m.*()` call site carries its trailing `// "Original text"` comment.

## 8. Verification (nothing runs in CI — run it, and say so on the board)

Backend: `manage.py test` (whole suite), `manage.py check`, `makemigrations --check --dry-run`. Tests to exist:
stranger 404 on a draft project and its versions; teaser for a seeking draft; 409 on a stale save and on a double decision;
one published per project; the projection equals the material after publish (file, url, body, title, description);
quota counts version files; the deciding circle per state (member / staff / material governor / branch governor / stranger);
reject needs a note; withdraw; invite expiry, revocation, `used_up` race, minor, already_member; join request flow;
flag off → 403 for a plain user and bypass for staff; notifications gated by preference; an activity row only on a public
publish and none for the backfill; the moderation queue section is branch-scoped for a governor and unscoped for staff;
`translation_stale`.

Frontend: `npm run check` (0/0), `npm run lint`, `npm run build`, `npm run check:a11y`; key-set diff of the two catalogues.

Browser (`e2e/coauthoring.mjs`, both servers up, seeded users): owner creates an invite link → second user accepts →
uploads a new PDF as a draft → owner publishes → the material page's download serves the new file → third user proposes
→ owner rejects with a note → third user sees the reason → a draft project started together reaches the moderation queue
→ staff publish it and the material appears → flag off hides the panel and menu items. Screenshots looked at.

## 9. Left open by design (name them on the board when landing)

- The CC BY-SA contributor line (lawyer review first, `LEGAL.md` §2).
- Translations of a material other than the project's locale are not versioned; the stale marker only says so.
- Storage: superseded versions keep their files (that is the history); the per-account quota is the bound.
- No people search: members are added by account id, as courses do; invites by link are the ergonomic path.
- No branch/discipline follow notifications for new versions.

---

## 10. What the build changed about this brief (2026-09-22, after it landed)

The code wins where the two disagree; this is the list of places they do, so nobody reads a stale
contract and builds against it.

- **`publish_block_reason` (new).** Publishing a draft checks not only that its number is above the
  published one but that the first `published`/`superseded` row up its `based_on` chain IS the
  version published now. Without it, a draft written while somebody's proposal was waiting could be
  published after that proposal was accepted and silently overwrite it. Read by the publish service
  and by `can_publish`.
- **`head_version` can be a `proposed` row — but only before the first publication.** A queued first
  publication is neither a draft nor published, and without this a project that had just been
  submitted had no name in any listing and no basis for its next save. After the first publication
  the head is a draft or the published row, as §1 says.
- **`POST /material-projects/` takes `publish: true`** (phase 3): it creates the project, its owner
  and version 1 and publishes it in one request, which is what `/submit-material` now does.
- **The two switches answer per project, not per endpoint** (`access.governing_switch`): a first
  publication answers to `material_submissions`, everything else to `coauthoring`, so killing
  collaboration leaves submitting a new material and accepting it working.
- **The version serializer carries `file_reclaimed_at`**, so a rejected upload can say that its
  bytes are gone rather than looking like a version that never had a file.
- **A project names itself by the version the caller may see** (`_naming_version`), never by the raw
  head — a member's unpublished draft title is not public. A teaser and a team's own rejected-only
  project are the two deliberate exceptions.
- **`coauthoring/backfill.py` + `manage.py backfill_material_projects` exist** beside migration
  `0002`, because a clean clone imports the corpus AFTER migrating and an applied migration never
  runs again. `import_legacy_corpus` calls it.
- **Phase 3 is done, not deferred**: `moderation.MaterialSubmission` is retired
  (`coauthoring.0003_fold_material_submissions` + `moderation.0038`), its whole test suite ported.
