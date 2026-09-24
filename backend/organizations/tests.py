"""`organizations` — refusals first, then the happy paths that make the refusals mean something.

The order is this project's standing habit: a feature whose only tests are its happy paths is a
feature whose permission model has never been exercised. Every class below opens with who is told
no, and with which WORD (house rule 6).

The last class is the node seam: `config/nodes.py` gained an `organization` line in this step
(MANAGEMENT-BRIEF.md §4 rule 3 — the only shared-file edit any of the six steps makes), and the four
functions it dispatches to live in `access.py`. Those tests are `config/test_nodes.py`-shaped but
live here, so that the shared file's own suite is not something six branches edit at once.
"""

from django.contrib.contenttypes.models import ContentType
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from courses.models import Course
from moderation.models import FeatureFlag
from organizations.access import (
    can_manage,
    can_manage_organization,
    can_view_organization,
    is_member,
    is_organization_member,
    link_block_reason,
    organization_member_users,
    remove_block_reason,
    role_of,
    visible_organizations,
)
from organizations.models import Organization, OrganizationLink, OrganizationMember
from organizations.services import allocate_slug, found
from organizations.work import work_items
from telemetry.routers import all_log_shards
from testing.factories import make_user, make_viewer


class OrganizationTestCase(APITestCase):
    """`databases` covers the log shards for the same reason every other suite here does: the
    activity/telemetry router sends some writes to `logs_*`, and a test that touches one without
    declaring it fails with `DatabaseOperationForbidden` rather than anything about organisations."""

    databases = set(all_log_shards()) | {'default'}


def make_org(owner, name='Koło Naukowe Fizyków', **kwargs):
    return found(creator=owner, name=name, **kwargs)


def make_course(instructor, **kwargs):
    kwargs.setdefault('title', 'Analiza I')
    kwargs.setdefault('visibility', 'public')
    return Course.objects.create(instructor=instructor, **kwargs)


class FoundingTests(OrganizationTestCase):
    def setUp(self):
        self.adult = make_user('ola')

    def test_an_anonymous_visitor_cannot_found_one(self):
        res = self.client.post('/api/organizations/', {'name': 'X'}, format='json')
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_a_minor_is_refused_with_the_word_minor(self):
        """Founding a body means standing publicly behind it and being the person a stranger writes
        to — the same reasoning that closes event hosting and tutoring to an under-16."""
        child = make_user('mika')
        child.profile.is_minor = True
        child.profile.save(update_fields=['is_minor'])
        self.client.force_authenticate(child)
        res = self.client.post('/api/organizations/', {'name': 'Koło'}, format='json')
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(res.data['detail'], 'minor')

    def test_a_nameless_organisation_is_a_400(self):
        self.client.force_authenticate(self.adult)
        res = self.client.post('/api/organizations/', {'name': '   '}, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_founding_makes_the_founder_the_first_owner(self):
        self.client.force_authenticate(self.adult)
        res = self.client.post(
            '/api/organizations/',
            {'name': 'Koło Naukowe Fizyków', 'kind': 'student_circle', 'city': 'Warszawa'},
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data['my_role'], 'owner')
        self.assertTrue(res.data['can_manage'])
        # `slugify` strips `ł` rather than transliterating it (it has no NFKD decomposition), which
        # is the same answer `concepts.services.allocate_slug` already gives across the platform.
        # Named in this app's "Left open" rather than fixed here, because changing it is a decision
        # about every slug on the site, not about this app.
        self.assertEqual(res.data['slug'], 'koo-naukowe-fizykow')
        org = Organization.objects.get(pk=res.data['id'])
        self.assertEqual(org.members.count(), 1)
        self.assertEqual(org.members.first().role, 'owner')

    def test_the_slug_is_allocated_around_a_collision(self):
        make_org(self.adult, name='Koło')
        self.assertEqual(allocate_slug('Koło'), 'koo-2')

    def test_a_name_with_nothing_sluggable_still_gets_a_slug(self):
        self.assertEqual(allocate_slug('∑∫∂'), 'organization')

    def test_the_description_is_sanitized_on_write(self):
        """House rule 8: the API is a second, independent entry point, and `Organization.save()` is
        where every write path meets the bleach allowlist."""
        self.client.force_authenticate(self.adult)
        res = self.client.post(
            '/api/organizations/',
            {'name': 'Fizycy', 'description': '<script>alert(1)</script><p>Real</p>'},
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertNotIn('<script>', res.data['description'])
        self.assertIn('<p>Real</p>', res.data['description'])


class VisibilityTests(OrganizationTestCase):
    def setUp(self):
        self.owner = make_user('ola')
        self.stranger = make_user('bartek')
        self.org = make_org(self.owner)
        self.closed = make_org(self.owner, name='Rozwiązane Koło')
        self.closed.is_active = False
        self.closed.save(update_fields=['is_active'])

    def test_a_stranger_reads_an_active_organisation(self):
        res = self.client.get(f'/api/organizations/{self.org.pk}/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIsNone(res.data['my_role'])
        self.assertFalse(res.data['can_manage'])

    def test_a_dissolved_organisation_is_404_for_a_stranger_and_open_to_its_own(self):
        """House rule 4: for a stranger it does not exist, which is the honest answer as well as
        the safe one — and the people who were in it keep their page."""
        self.client.force_authenticate(self.stranger)
        self.assertEqual(
            self.client.get(f'/api/organizations/{self.closed.pk}/').status_code,
            status.HTTP_404_NOT_FOUND,
        )
        self.client.force_authenticate(self.owner)
        self.assertEqual(
            self.client.get(f'/api/organizations/{self.closed.pk}/').status_code,
            status.HTTP_200_OK,
        )

    def test_a_dissolved_organisation_leaves_the_public_list(self):
        slugs = {row['slug'] for row in self.client.get('/api/organizations/').data}
        self.assertIn(self.org.slug, slugs)
        self.assertNotIn(self.closed.slug, slugs)

    def test_platform_staff_see_every_row(self):
        moderator = make_user('kasia', is_staff=True)
        self.assertIn(self.closed, visible_organizations(moderator))

    def test_the_mine_filter_is_empty_for_an_anonymous_reader(self):
        self.assertEqual(self.client.get('/api/organizations/?mine=1').data, [])

    def test_the_filters_narrow_by_kind_and_by_text(self):
        make_org(self.owner, name='Wydział Fizyki', kind='faculty', city='Warszawa')
        by_kind = self.client.get('/api/organizations/?kind=faculty').data
        self.assertEqual([row['name'] for row in by_kind], ['Wydział Fizyki'])
        by_text = self.client.get('/api/organizations/?q=warszawa').data
        self.assertEqual([row['name'] for row in by_text], ['Wydział Fizyki'])

    def test_a_list_row_carries_its_counts(self):
        row = next(r for r in self.client.get('/api/organizations/').data if r['id'] == self.org.pk)
        self.assertEqual(row['member_count'], 1)
        self.assertEqual(row['link_count'], 0)


class EditAndDissolveTests(OrganizationTestCase):
    def setUp(self):
        self.owner = make_user('ola')
        self.admin = make_user('bartek')
        self.plain = make_user('czarek')
        self.stranger = make_user('dorota')
        self.org = make_org(self.owner)
        OrganizationMember.objects.create(organization=self.org, user=self.admin, role='admin')
        OrganizationMember.objects.create(organization=self.org, user=self.plain, role='member')

    def test_a_plain_member_may_not_edit(self):
        self.client.force_authenticate(self.plain)
        res = self.client.patch(f'/api/organizations/{self.org.pk}/', {'city': 'Kraków'}, format='json')
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(res.data['detail'], 'not_org_manager')

    def test_a_stranger_may_not_edit(self):
        self.client.force_authenticate(self.stranger)
        res = self.client.patch(f'/api/organizations/{self.org.pk}/', {'city': 'Kraków'}, format='json')
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    def test_an_administrator_edits(self):
        self.client.force_authenticate(self.admin)
        res = self.client.patch(f'/api/organizations/{self.org.pk}/', {'city': 'Kraków'}, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['city'], 'Kraków')

    def test_the_slug_cannot_be_moved_under_a_link_somebody_sent(self):
        self.client.force_authenticate(self.owner)
        self.client.patch(f'/api/organizations/{self.org.pk}/', {'slug': 'inne'}, format='json')
        self.org.refresh_from_db()
        self.assertEqual(self.org.slug, 'koo-naukowe-fizykow')

    def test_an_administrator_may_not_dissolve_it(self):
        self.client.force_authenticate(self.admin)
        res = self.client.delete(f'/api/organizations/{self.org.pk}/')
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(res.data['detail'], 'not_org_owner')

    def test_dissolving_is_a_tombstone_not_a_delete(self):
        self.client.force_authenticate(self.owner)
        res = self.client.delete(f'/api/organizations/{self.org.pk}/')
        self.assertEqual(res.status_code, status.HTTP_204_NO_CONTENT)
        self.org.refresh_from_db()
        self.assertFalse(self.org.is_active)
        self.assertTrue(Organization.objects.filter(pk=self.org.pk).exists())


class RosterTests(OrganizationTestCase):
    def setUp(self):
        self.owner = make_user('ola')
        self.admin = make_user('bartek')
        self.plain = make_user('czarek')
        self.newcomer = make_viewer('dorota')
        self.org = make_org(self.owner)
        OrganizationMember.objects.create(organization=self.org, user=self.admin, role='admin')
        self.plain_row = OrganizationMember.objects.create(
            organization=self.org, user=self.plain, role='member'
        )

    def test_the_roster_is_readable_by_a_stranger(self):
        """A body's membership is what it is for; hiding it would make the page a name and nothing
        else. No email is ever in the answer."""
        res = self.client.get(f'/api/organizations/{self.org.pk}/members/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res.data), 3)
        self.assertNotIn('email', res.data[0]['user'])

    def test_a_plain_member_may_not_add_anybody(self):
        self.client.force_authenticate(self.plain)
        res = self.client.post(
            f'/api/organizations/{self.org.pk}/members/',
            {'user_id': self.newcomer.pk},
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(res.data['detail'], 'not_org_manager')

    def test_an_unknown_account_id_is_a_400_with_its_own_word(self):
        self.client.force_authenticate(self.owner)
        res = self.client.post(
            f'/api/organizations/{self.org.pk}/members/', {'user_id': 99999}, format='json'
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.data['detail'], 'no_such_user')

    def test_adding_somebody_twice_is_409_already_member(self):
        self.client.force_authenticate(self.owner)
        res = self.client.post(
            f'/api/organizations/{self.org.pk}/members/', {'user_id': self.plain.pk}, format='json'
        )
        self.assertEqual(res.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(res.data['detail'], 'already_member')

    def test_an_administrator_adds_by_account_id(self):
        self.client.force_authenticate(self.admin)
        res = self.client.post(
            f'/api/organizations/{self.org.pk}/members/',
            {'user_id': self.newcomer.pk, 'role': 'member'},
            format='json',
        )
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data['user']['id'], self.newcomer.pk)
        self.assertEqual(res.data['added_by']['id'], self.admin.pk)

    def test_the_last_owner_cannot_be_removed(self):
        owner_row = OrganizationMember.objects.get(organization=self.org, user=self.owner)
        self.client.force_authenticate(self.owner)
        res = self.client.delete(f'/api/organization-members/{owner_row.pk}/')
        self.assertEqual(res.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(res.data['detail'], 'last_owner')

    def test_the_last_owner_cannot_be_demoted_either(self):
        """A rule that only guarded DELETE would be walked around by a PATCH — the end state is the
        same organisation with nobody able to run it."""
        owner_row = OrganizationMember.objects.get(organization=self.org, user=self.owner)
        self.client.force_authenticate(self.owner)
        res = self.client.patch(
            f'/api/organization-members/{owner_row.pk}/', {'role': 'admin'}, format='json'
        )
        self.assertEqual(res.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(res.data['detail'], 'last_owner')

    def test_a_second_owner_makes_the_first_removable(self):
        OrganizationMember.objects.filter(pk=self.plain_row.pk).update(role='owner')
        owner_row = OrganizationMember.objects.get(organization=self.org, user=self.owner)
        self.client.force_authenticate(self.owner)
        res = self.client.delete(f'/api/organization-members/{owner_row.pk}/')
        self.assertEqual(res.status_code, status.HTTP_204_NO_CONTENT)

    def test_an_administrator_may_not_evict_an_owner(self):
        OrganizationMember.objects.filter(pk=self.plain_row.pk).update(role='owner')
        owner_row = OrganizationMember.objects.get(organization=self.org, user=self.owner)
        self.client.force_authenticate(self.admin)
        res = self.client.delete(f'/api/organization-members/{owner_row.pk}/')
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(res.data['detail'], 'not_org_owner')

    def test_anybody_may_leave_by_themselves(self):
        self.client.force_authenticate(self.plain)
        res = self.client.delete(f'/api/organization-members/{self.plain_row.pk}/')
        self.assertEqual(res.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(is_member(self.plain, self.org))

    def test_leaving_still_cannot_strand_the_organisation(self):
        owner_row = OrganizationMember.objects.get(organization=self.org, user=self.owner)
        self.client.force_authenticate(self.owner)
        res = self.client.delete(f'/api/organization-members/{owner_row.pk}/')
        self.assertEqual(res.status_code, status.HTTP_409_CONFLICT)

    def test_a_member_of_another_organisation_is_404_not_403(self):
        """The queryset is scoped to organisations this reader can see; a row on a dissolved body
        they were never in does not exist for them."""
        other_owner = make_user('ewa')
        other = make_org(other_owner, name='Inne Koło')
        other.is_active = False
        other.save(update_fields=['is_active'])
        row = OrganizationMember.objects.get(organization=other, user=other_owner)
        self.client.force_authenticate(self.plain)
        res = self.client.patch(
            f'/api/organization-members/{row.pk}/', {'role': 'member'}, format='json'
        )
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    def test_remove_block_reason_recounts_rather_than_trusting_a_counter(self):
        owner_row = OrganizationMember.objects.get(organization=self.org, user=self.owner)
        self.assertEqual(remove_block_reason(self.org, owner_row), 'last_owner')
        OrganizationMember.objects.filter(pk=self.plain_row.pk).update(role='owner')
        self.assertIsNone(remove_block_reason(self.org, owner_row))


class LinkTests(OrganizationTestCase):
    def setUp(self):
        self.owner = make_user('ola')
        self.teacher = make_user('bartek')
        self.org = make_org(self.owner)
        self.course = make_course(self.teacher)

    def _link(self, user, **body):
        self.client.force_authenticate(user)
        body.setdefault('node_kind', 'course')
        body.setdefault('node_id', self.course.pk)
        return self.client.post(f'/api/organizations/{self.org.pk}/links/', body, format='json')

    def test_running_only_the_organisation_is_not_enough(self):
        """A badge saying "run by" is a claim about two parties, so both have to have agreed."""
        res = self._link(self.owner)
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(res.data['detail'], 'not_node_manager')

    def test_running_only_the_course_is_not_enough_either(self):
        res = self._link(self.teacher)
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(res.data['detail'], 'not_org_manager')

    def test_running_both_ends_links_them(self):
        OrganizationMember.objects.create(organization=self.org, user=self.teacher, role='admin')
        res = self._link(self.teacher, kind='supports')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data['kind'], 'supports')
        self.assertEqual(res.data['node']['kind'], 'course')
        self.assertEqual(res.data['node']['title'], 'Analiza I')

    def test_the_same_pair_twice_is_409_already_linked(self):
        OrganizationMember.objects.create(organization=self.org, user=self.teacher, role='admin')
        self._link(self.teacher)
        res = self._link(self.teacher)
        self.assertEqual(res.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(res.data['detail'], 'already_linked')

    def test_an_organisation_is_not_a_linkable_target(self):
        """A body inside a body is a hierarchy this step deliberately does not model."""
        other = make_org(self.owner, name='Wydział', kind='faculty')
        res = self._link(self.owner, node_kind='organization', node_id=other.pk)
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res.data['detail'], 'not_linkable')

    def test_a_node_the_caller_cannot_see_is_a_404_not_a_403(self):
        hidden = make_course(self.teacher, title='Prywatny', visibility='only_you')
        res = self._link(self.owner, node_id=hidden.pk)
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    def test_an_unknown_node_kind_is_a_404(self):
        res = self._link(self.owner, node_kind='banana', node_id=1)
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_link_to_something_a_reader_cannot_see_is_left_out_of_the_list(self):
        """A link is only as public as the less public of its two ends."""
        OrganizationMember.objects.create(organization=self.org, user=self.teacher, role='admin')
        hidden = make_course(self.teacher, title='Prywatny', visibility='only_you')
        OrganizationLink.objects.create(
            organization=self.org,
            content_type=ContentType.objects.get_for_model(Course),
            object_id=hidden.pk,
            kind='runs',
        )
        self._link(self.teacher)
        self.client.force_authenticate(None)
        titles = [row['node']['title'] for row in self.client.get(f'/api/organizations/{self.org.pk}/links/').data]
        self.assertEqual(titles, ['Analiza I'])

    def test_either_end_may_take_the_badge_off(self):
        OrganizationMember.objects.create(organization=self.org, user=self.teacher, role='admin')
        link_id = self._link(self.teacher).data['id']
        # The course's instructor, who is no longer an organisation manager, still may.
        OrganizationMember.objects.filter(organization=self.org, user=self.teacher).delete()
        self.client.force_authenticate(self.teacher)
        res = self.client.delete(f'/api/organization-links/{link_id}/')
        self.assertEqual(res.status_code, status.HTTP_204_NO_CONTENT)

    def test_a_bystander_may_not_take_the_badge_off(self):
        OrganizationMember.objects.create(organization=self.org, user=self.teacher, role='admin')
        link_id = self._link(self.teacher).data['id']
        self.client.force_authenticate(make_user('czarek'))
        res = self.client.delete(f'/api/organization-links/{link_id}/')
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    def test_link_block_reason_is_the_one_place_the_rule_lives(self):
        self.assertEqual(link_block_reason(self.teacher, self.org, self.course), 'not_org_manager')
        OrganizationMember.objects.create(organization=self.org, user=self.teacher, role='admin')
        self.assertIsNone(link_block_reason(self.teacher, self.org, self.course))


class NodeOrganizationsTests(OrganizationTestCase):
    """`GET /api/nodes/{kind}/{id}/organizations/` — what the panel on a course page reads."""

    def setUp(self):
        self.owner = make_user('ola')
        self.org = make_org(self.owner)
        self.course = make_course(self.owner)
        OrganizationLink.objects.create(
            organization=self.org,
            content_type=ContentType.objects.get_for_model(Course),
            object_id=self.course.pk,
            kind='runs',
        )

    def test_a_stranger_sees_the_badge_on_a_public_course(self):
        res = self.client.get(f'/api/nodes/course/{self.course.pk}/organizations/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res.data), 1)
        self.assertEqual(res.data[0]['organization']['slug'], self.org.slug)

    def test_a_node_the_reader_cannot_see_is_a_404(self):
        hidden = make_course(self.owner, title='Prywatny', visibility='only_you')
        res = self.client.get(f'/api/nodes/course/{hidden.pk}/organizations/')
        self.assertEqual(res.status_code, status.HTTP_404_NOT_FOUND)

    def test_a_dissolved_body_takes_its_badge_off_the_public_page(self):
        self.org.is_active = False
        self.org.save(update_fields=['is_active'])
        self.assertEqual(self.client.get(f'/api/nodes/course/{self.course.pk}/organizations/').data, [])

    def test_an_unknown_kind_is_a_404_rather_than_a_500(self):
        self.assertEqual(
            self.client.get('/api/nodes/banana/1/organizations/').status_code,
            status.HTTP_404_NOT_FOUND,
        )


class ManagedListTests(OrganizationTestCase):
    def setUp(self):
        self.owner = make_user('ola')
        self.plain = make_user('bartek')
        self.org = make_org(self.owner)
        OrganizationMember.objects.create(organization=self.org, user=self.plain, role='member')

    def test_a_plain_member_manages_nothing(self):
        self.client.force_authenticate(self.plain)
        self.assertEqual(self.client.get('/api/organizations/managed/').data, [])

    def test_an_owner_manages_their_own(self):
        self.client.force_authenticate(self.owner)
        rows = self.client.get('/api/organizations/managed/').data
        self.assertEqual([row['slug'] for row in rows], [self.org.slug])

    def test_it_needs_a_sign_in(self):
        self.assertEqual(
            self.client.get('/api/organizations/managed/').status_code,
            status.HTTP_401_UNAUTHORIZED,
        )


class KillSwitchTests(OrganizationTestCase):
    """House rule 3, asserted as a NON-staff caller — a staff-bypassed check proves nothing about a
    FeatureFlag (`frontend/e2e/CLAUDE.md` trap 10 says the same about the browser)."""

    def setUp(self):
        self.owner = make_user('ola')
        self.org = make_org(self.owner)
        FeatureFlag.objects.update_or_create(key='organizations', defaults={'is_enabled': False})

    def tearDown(self):
        FeatureFlag.objects.update_or_create(key='organizations', defaults={'is_enabled': True})

    def test_the_whole_surface_closes(self):
        # Asserted as a signed-in ordinary reader: DRF answers an ANONYMOUS permission failure with
        # 401 (TokenAuthentication offers a `WWW-Authenticate` header), which is a different sentence
        # from "this feature is off" and would make the check pass for the wrong reason.
        self.client.force_authenticate(make_user('zosia'))
        self.assertEqual(self.client.get('/api/organizations/').status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(
            self.client.get(f'/api/organizations/{self.org.pk}/').status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_an_anonymous_caller_is_told_to_sign_in_rather_than_500ing(self):
        self.assertEqual(
            self.client.get('/api/organizations/').status_code, status.HTTP_401_UNAUTHORIZED
        )

    def test_a_moderator_still_reaches_their_own_tools(self):
        self.client.force_authenticate(make_user('kasia', is_staff=True))
        self.assertEqual(self.client.get('/api/organizations/').status_code, status.HTTP_200_OK)

    def test_the_node_seam_itself_keeps_working(self):
        """A neighbouring endpoint must keep working while returning nothing for the killed feature
        (house rule 3, second half)."""
        course = make_course(self.owner)
        self.assertEqual(
            self.client.get(f'/api/nodes/course/{course.pk}/').status_code, status.HTTP_200_OK
        )
        self.client.force_authenticate(make_user('zosia'))
        self.assertEqual(
            self.client.get(f'/api/nodes/course/{course.pk}/').status_code, status.HTTP_200_OK
        )
        self.assertEqual(
            self.client.get(f'/api/nodes/course/{course.pk}/organizations/').status_code,
            status.HTTP_403_FORBIDDEN,
        )


class WorkProviderTests(OrganizationTestCase):
    """`work_items(user)` in the §3.F shape — the integrator registers it; this proves its shape and
    that it stays quiet when there is nothing to say."""

    ITEM_KEYS = {'kind', 'title', 'url', 'due_at', 'status', 'urgency', 'node'}

    def setUp(self):
        self.owner = make_user('ola')
        self.org = make_org(self.owner)

    def test_an_anonymous_caller_gets_an_empty_list_rather_than_an_exception(self):
        from django.contrib.auth.models import AnonymousUser

        self.assertEqual(work_items(AnonymousUser()), [])

    def test_a_one_person_organisation_is_not_a_row(self):
        """Nobody is relying on it, so there is nothing to act on — permanent noise is how a
        dashboard trains its reader to ignore it."""
        self.assertEqual(work_items(self.owner), [])

    def test_a_sole_owner_with_a_roster_is_one_row_in_the_expected_shape(self):
        OrganizationMember.objects.create(
            organization=self.org, user=make_viewer('bartek'), role='member'
        )
        items = work_items(self.owner)
        self.assertEqual(len(items), 1)
        self.assertEqual(set(items[0]), self.ITEM_KEYS)
        self.assertEqual(items[0]['kind'], 'organization')
        self.assertEqual(items[0]['status'], 'sole_owner')
        self.assertEqual(items[0]['url'], f'/organizations/{self.org.slug}/manage')
        self.assertIsNone(items[0]['due_at'])

    def test_a_second_owner_clears_the_row(self):
        OrganizationMember.objects.create(
            organization=self.org, user=make_viewer('bartek'), role='owner'
        )
        self.assertEqual(work_items(self.owner), [])

    def test_a_dissolved_body_never_appears(self):
        OrganizationMember.objects.create(
            organization=self.org, user=make_viewer('bartek'), role='member'
        )
        self.org.is_active = False
        self.org.save(update_fields=['is_active'])
        self.assertEqual(work_items(self.owner), [])


class NodeSeamTests(OrganizationTestCase):
    """The `organization` kind in `config/nodes.py` (MANAGEMENT-BRIEF.md §2, §4 rule 3).

    `config/test_nodes.py`-shaped, but kept in this app's own suite: the shared file is read-only
    for the other five steps, and a test file six branches all append to is a merge conflict on
    every merge.
    """

    def setUp(self):
        self.owner = make_user('ola')
        self.plain = make_user('bartek')
        self.stranger = make_user('czarek')
        self.org = make_org(self.owner)
        OrganizationMember.objects.create(organization=self.org, user=self.plain, role='member')

    def test_the_kind_resolves(self):
        from config import nodes

        self.assertIn('organization', nodes.NODE_KINDS)
        self.assertEqual(nodes.resolve_node('organization', self.org.pk), self.org)
        self.assertEqual(nodes.kind_of(self.org), 'organization')
        self.assertIsNone(nodes.resolve_node('organization', 99999))

    def test_the_seam_dispatches_to_this_app(self):
        from config import nodes

        self.assertTrue(nodes.can_view_node(self.stranger, self.org))
        self.assertTrue(nodes.is_node_staff(self.plain, self.org))
        self.assertFalse(nodes.is_node_staff(self.stranger, self.org))
        self.assertTrue(nodes.can_manage_node(self.owner, self.org))
        self.assertFalse(nodes.can_manage_node(self.plain, self.org))
        self.assertEqual(
            set(nodes.node_staff_users(self.org).values_list('pk', flat=True)),
            {self.owner.pk, self.plain.pk},
        )

    def test_member_and_staff_are_the_same_set_here(self):
        """An organisation's roster has no reader tier, so the seam's two questions have one
        answer — said in `access.is_organization_member` and asserted here."""
        from config import nodes

        self.assertEqual(
            nodes.is_node_member(self.plain, self.org), nodes.is_node_staff(self.plain, self.org)
        )

    def test_a_dissolved_body_is_invisible_to_the_seam_too(self):
        from config import nodes

        self.org.is_active = False
        self.org.save(update_fields=['is_active'])
        self.assertFalse(nodes.can_view_node(self.stranger, self.org))
        self.assertTrue(nodes.can_view_node(self.plain, self.org))

    def test_the_node_ref_endpoint_answers_for_an_organisation(self):
        self.client.force_authenticate(self.owner)
        res = self.client.get(f'/api/nodes/organization/{self.org.pk}/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['kind'], 'organization')
        self.assertEqual(res.data['title'], self.org.name)
        self.assertTrue(res.data['can_manage'])

    def test_the_staff_endpoint_is_the_roster_and_404s_a_stranger(self):
        self.client.force_authenticate(self.stranger)
        self.assertEqual(
            self.client.get(f'/api/nodes/organization/{self.org.pk}/staff/').status_code,
            status.HTTP_404_NOT_FOUND,
        )
        self.client.force_authenticate(self.plain)
        res = self.client.get(f'/api/nodes/organization/{self.org.pk}/staff/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual({row['id'] for row in res.data}, {self.owner.pk, self.plain.pk})

    def test_the_four_dispatch_functions_answer_directly(self):
        self.assertTrue(can_view_organization(self.stranger, self.org))
        self.assertTrue(is_organization_member(self.plain, self.org))
        self.assertTrue(can_manage_organization(self.owner, self.org))
        self.assertFalse(can_manage_organization(self.plain, self.org))
        self.assertEqual(organization_member_users(self.org).count(), 2)
        self.assertEqual(role_of(self.owner, self.org), 'owner')
        self.assertTrue(can_manage(self.owner, self.org))

    def test_the_seam_does_not_grant_anything_on_what_the_body_runs(self):
        """The one 2donet decision deliberately narrowed (MANAGEMENT-BRIEF.md §1): a membership
        cascades nothing. A member of the organisation that runs a course is not course staff."""
        from config import nodes

        course = make_course(make_user('dorota'))
        OrganizationLink.objects.create(
            organization=self.org,
            content_type=ContentType.objects.get_for_model(Course),
            object_id=course.pk,
            kind='runs',
        )
        self.assertFalse(nodes.is_node_staff(self.plain, course))
        self.assertFalse(nodes.can_manage_node(self.owner, course))


class SlugResolutionTests(OrganizationTestCase):
    """`/organizations/[slug]` on the frontend resolves through `?slug=`, the `venues` shape."""

    def setUp(self):
        self.owner = make_user('ola')
        self.org = make_org(self.owner)

    def test_the_slug_filter_finds_exactly_one(self):
        make_org(self.owner, name='Inne Koło')
        rows = self.client.get(f'/api/organizations/?slug={self.org.slug}').data
        self.assertEqual([row['id'] for row in rows], [self.org.pk])

    def test_an_unknown_slug_is_an_empty_list_not_an_error(self):
        self.assertEqual(self.client.get('/api/organizations/?slug=nie-ma').data, [])

    def test_created_at_is_a_real_timestamp(self):
        self.assertLessEqual(self.org.created_at, timezone.now())
