"""The cooperation overview: one project, as a picture of who does what on it.

Everything here is DERIVED from `coauthoring`'s rows — versions, members, join requests — and
filtered through that app's own visibility rules per row (`can_view_version`), so the overview a
stranger sees is built only from what they could reach anyway (house rule 9: public by
construction, not filtered from private). No number is stored; every count is a recount over the
rows the caller may see (house rule 5).

The timeline is the same principle in time order: an event exists here only because a row the
caller can see says it happened. A draft's `version_drafted` therefore appears for the team and
not for a reader, without a second rule saying so.
"""

from django.contrib.contenttypes.models import ContentType

from coauthoring.access import (
    can_edit,
    can_manage,
    can_view_version,
    join_block_reason,
    propose_block_reason,
    role_of,
)
from coauthoring.serializers import (
    MaterialVersionSummarySerializer,
    _display_name,
)
from community.models import Comment

from .policy import can_post, policy_of, post_block_reason, settings_for

# Mirrored in `frontend/src/lib/types/materialsCoop.ts` (house rule 13).
TIMELINE_KINDS = (
    'version_drafted',
    'version_proposed',
    'version_published',
    'version_rejected',
    'version_withdrawn',
    'member_joined',
)
TIMELINE_LIMIT = 40


def _visible_versions(project, user):
    return [v for v in project.versions.all() if can_view_version(v, user)]


def _member_rows(project, versions):
    """The team, each with what they have actually done here — recounted from the visible
    versions rather than stored on the membership row."""
    by_user = {}
    for version in versions:
        if version.created_by_id is None:
            continue
        bucket = by_user.setdefault(
            version.created_by_id, {'versions': 0, 'published': 0, 'last_active_at': None}
        )
        bucket['versions'] += 1
        if version.status in ('published', 'superseded'):
            bucket['published'] += 1
        stamp = version.published_at or version.created_at
        if bucket['last_active_at'] is None or stamp > bucket['last_active_at']:
            bucket['last_active_at'] = stamp

    rows = []
    member_ids = set()
    for member in project.members.all():
        member_ids.add(member.user_id)
        stats = by_user.get(member.user_id, {'versions': 0, 'published': 0, 'last_active_at': None})
        rows.append(
            {
                'user_id': member.user_id,
                'display_name': _display_name(member.user),
                'role': member.role,
                'added_at': member.added_at,
                'versions_count': stats['versions'],
                'published_count': stats['published'],
                'last_active_at': stats['last_active_at'] or member.added_at,
            }
        )

    # People who are not on the team but whose proposal was accepted (or is waiting): the
    # contributors a roster would otherwise silently drop, and exactly the people a `request`
    # policy would invite next.
    outsiders = []
    seen = set()
    for version in versions:
        uid = version.created_by_id
        if uid is None or uid in member_ids or uid in seen:
            continue
        seen.add(uid)
        stats = by_user[uid]
        outsiders.append(
            {
                'user_id': uid,
                'display_name': _display_name(version.created_by),
                'role': None,
                'added_at': None,
                'versions_count': stats['versions'],
                'published_count': stats['published'],
                'last_active_at': stats['last_active_at'],
            }
        )
    return rows, outsiders


def _timeline(project, versions):
    events = []

    def add(kind, at, version=None, actor=None):
        if at is None:
            return
        events.append(
            {
                'kind': kind,
                'at': at,
                'actor_id': actor.pk if actor is not None else None,
                'actor_display_name': _display_name(actor) if actor is not None else '',
                'version_id': version.pk if version is not None else None,
                'version_number': version.number if version is not None else None,
                'label': (version.change_note or version.title) if version is not None else '',
            }
        )

    for version in versions:
        author = version.created_by
        if version.status == 'draft':
            add('version_drafted', version.created_at, version, author)
        elif version.status in ('published', 'superseded'):
            add('version_published', version.published_at or version.created_at, version, author)
        elif version.status == 'proposed':
            add('version_proposed', version.created_at, version, author)
        elif version.status == 'rejected':
            add('version_proposed', version.created_at, version, author)
            add('version_rejected', version.decided_at, version, version.decided_by)
        elif version.status == 'withdrawn':
            add('version_proposed', version.created_at, version, author)
            add('version_withdrawn', version.decided_at or version.created_at, version, author)
    for member in project.members.all():
        add('member_joined', member.added_at, None, member.user)

    events.sort(key=lambda e: e['at'], reverse=True)
    return events[:TIMELINE_LIMIT]


def build_overview(project, user) -> dict:
    """The whole payload `GET /api/materials/{id}/coop/` answers with. Call with a project loaded
    through `coauthoring.access.visible_projects` and prefetched `members__user__profile` and
    `versions__created_by__profile`, and it runs in a bounded number of queries."""
    versions = _visible_versions(project, user)
    members, contributors = _member_rows(project, versions)
    editor = can_edit(project, user)
    manager = can_manage(project, user)
    row = settings_for(project)
    published = project.published_version
    head = project.head_version

    ordered = sorted(versions, key=lambda v: v.number, reverse=True)
    pending_proposals = [v for v in ordered if v.status == 'proposed'] if editor else []
    pending_join = (
        project.join_requests.filter(status='pending').count() if manager else 0
    )
    content_type = ContentType.objects.get_for_model(project)
    comment_count = Comment.objects.filter(
        content_type=content_type, object_id=project.pk, is_removed=False
    ).count()

    published_dates = [
        v.published_at for v in versions if v.published_at is not None
    ]
    propose_reason = propose_block_reason(project, user)
    join_reason = join_block_reason(project, user)

    return {
        'material_id': project.material_id,
        'project_id': project.pk,
        'title': (published or head).title if (published or head) else '',
        'policy': policy_of(project),
        'welcome_note': row.welcome_note if row is not None else '',
        'my_role': role_of(project, user),
        'can_edit': editor,
        'can_manage': manager,
        'can_propose': propose_reason is None,
        'propose_block_reason': propose_reason,
        'join_block_reason': join_reason,
        'can_post': can_post(project, user),
        'post_block_reason': post_block_reason(project, user),
        'published_version': MaterialVersionSummarySerializer(published).data if published else None,
        'head_version': MaterialVersionSummarySerializer(head).data if head else None,
        'members': members,
        'contributors': contributors,
        'versions': MaterialVersionSummarySerializer(ordered, many=True).data,
        'pending_proposals': MaterialVersionSummarySerializer(pending_proposals, many=True).data,
        'stats': {
            'versions_total': len(versions),
            'published_count': sum(1 for v in versions if v.status in ('published', 'superseded')),
            'proposals_pending': len(pending_proposals),
            'join_requests_pending': pending_join,
            'members_count': len(members),
            'contributors_count': len(members) + len(contributors),
            'comment_count': comment_count,
            'first_published_at': min(published_dates) if published_dates else None,
            'last_published_at': max(published_dates) if published_dates else None,
        },
        'timeline': _timeline(project, versions),
    }


__all__ = ['build_overview', 'TIMELINE_KINDS', 'TIMELINE_LIMIT']
