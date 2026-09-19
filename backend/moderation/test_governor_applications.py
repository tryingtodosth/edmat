"""Applying to look after a discipline, a branch or one material (root CLAUDE.md §17AY).

Weighted at who may do what, and at the two things this queue deliberately does NOT have: any way
to buy a better position, and any way for a governor to grant authority to somebody else.
"""

from django.contrib.contenttypes.models import ContentType
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from moderation.models import GovernorApplication, NodeGovernor
from notifications.models import Notification
from taxonomy.models import Branch
from testing.factories import make_branch, make_material, make_user

STATEMENT = 'I photographed this handout and I would like to keep its pages in order.'


class ApplyingTests(APITestCase):
    def setUp(self):
        self.branch = make_branch()
        self.material = make_material(self.branch)
        self.applicant = make_user('app-applicant')
        self.staff = make_user('app-staff', is_staff=True)

    def apply_for(self, kind='material', node_ref=None, statement=STATEMENT, as_user=None):
        self.client.force_authenticate(as_user or self.applicant)
        return self.client.post(
            reverse('governor-application-list'),
            {
                'kind': kind,
                'node_ref': str(node_ref if node_ref is not None else self.material.pk),
                'statement': statement,
            },
            format='json',
        )

    def test_anybody_signed_in_can_apply_for_one_material(self):
        response = self.apply_for()

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['status'], 'pending')
        self.assertEqual(response.data['kind'], 'material')
        self.assertEqual(response.data['queue_position'], 1)

    def test_applying_needs_an_account(self):
        self.client.force_authenticate(None)
        response = self.client.post(
            reverse('governor-application-list'),
            {'kind': 'material', 'node_ref': str(self.material.pk), 'statement': STATEMENT},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_a_branch_is_applied_for_by_slug(self):
        response = self.apply_for(kind='branch', node_ref=self.branch.slug)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['node_ref'], self.branch.slug)

    def test_an_empty_application_is_refused(self):
        response = self.apply_for(statement='please')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('statement', response.data)

    def test_a_node_that_does_not_exist_is_refused(self):
        response = self.apply_for(node_ref='999999')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_applying_twice_for_the_same_thing_is_refused(self):
        self.apply_for()
        again = self.apply_for()
        self.assertEqual(again.status_code, status.HTTP_400_BAD_REQUEST)

    def test_applying_for_something_you_already_look_after_is_refused(self):
        NodeGovernor.objects.create(
            user=self.applicant,
            content_type=ContentType.objects.get_for_model(type(self.material)),
            object_id=self.material.pk,
        )
        response = self.apply_for()
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_staff_are_told_there_is_something_waiting(self):
        self.apply_for()

        self.assertTrue(
            Notification.objects.filter(
                recipient=self.staff, type='governor_application_submitted'
            ).exists()
        )


class QueueTests(APITestCase):
    def setUp(self):
        self.branch = make_branch()
        self.material = make_material(self.branch)
        self.second_material = make_material(self.branch, slug='second-material')
        self.first = make_user('queue-first')
        self.second = make_user('queue-second')
        self.staff = make_user('queue-staff', is_staff=True)
        self.a = GovernorApplication.objects.create(
            applicant=self.first,
            content_type=ContentType.objects.get_for_model(type(self.material)),
            object_id=self.material.pk,
            statement=STATEMENT,
        )
        self.b = GovernorApplication.objects.create(
            applicant=self.second,
            content_type=ContentType.objects.get_for_model(type(self.second_material)),
            object_id=self.second_material.pk,
            statement=STATEMENT,
        )

    def test_an_applicant_sees_only_their_own(self):
        self.client.force_authenticate(self.first)
        response = self.client.get(reverse('governor-application-list'))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([row['id'] for row in response.data], [self.a.pk])

    def test_asking_for_the_queue_without_being_staff_still_shows_only_your_own(self):
        self.client.force_authenticate(self.second)
        response = self.client.get(reverse('governor-application-list'), {'queue': '1'})

        self.assertEqual([row['id'] for row in response.data], [self.b.pk])

    def test_staff_see_the_whole_queue_oldest_first(self):
        self.client.force_authenticate(self.staff)
        response = self.client.get(reverse('governor-application-list'), {'queue': '1'})

        self.assertEqual([row['id'] for row in response.data], [self.a.pk, self.b.pk])

    def test_the_position_is_the_honest_one_and_nothing_can_change_it(self):
        """There is no priority column, no fee and no hook for one — the queue is the order people
        asked in. This pins that the second application really is told it is second."""
        self.client.force_authenticate(self.second)
        response = self.client.get(reverse('governor-application-list'))

        self.assertEqual(response.data[0]['queue_position'], 2)

    def test_a_decided_application_has_no_position(self):
        self.a.status = 'declined'
        self.a.save(update_fields=['status'])

        self.client.force_authenticate(self.first)
        response = self.client.get(reverse('governor-application-list'))
        self.assertIsNone(response.data[0]['queue_position'])


class DecidingTests(APITestCase):
    def setUp(self):
        self.branch = make_branch()
        self.material = make_material(self.branch)
        self.applicant = make_user('dec-applicant')
        self.staff = make_user('dec-staff', is_staff=True)
        self.application = GovernorApplication.objects.create(
            applicant=self.applicant,
            content_type=ContentType.objects.get_for_model(type(self.material)),
            object_id=self.material.pk,
            statement=STATEMENT,
        )

    def decide(self, user, decision='approve', note=''):
        self.client.force_authenticate(user)
        return self.client.post(
            reverse('governor-application-decide', args=[self.application.pk]),
            {'decision': decision, 'note': note},
            format='json',
        )

    def test_approving_creates_the_real_grant(self):
        response = self.decide(self.staff)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['status'], 'approved')
        self.assertTrue(
            NodeGovernor.objects.filter(
                user=self.applicant,
                content_type=self.application.content_type,
                object_id=self.material.pk,
            ).exists()
        )

    def test_the_applicant_is_told(self):
        self.decide(self.staff)

        self.assertTrue(
            Notification.objects.filter(
                recipient=self.applicant, type='governor_application_decided'
            ).exists()
        )

    def test_declining_needs_a_reason(self):
        response = self.decide(self.staff, decision='decline')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.application.refresh_from_db()
        self.assertEqual(self.application.status, 'pending')

    def test_declining_with_a_reason_grants_nothing(self):
        response = self.decide(self.staff, decision='decline', note='Already looked after.')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['status'], 'declined')
        self.assertEqual(response.data['decision_note'], 'Already looked after.')
        self.assertFalse(NodeGovernor.objects.filter(user=self.applicant).exists())

    def test_the_applicant_cannot_decide_their_own(self):
        response = self.decide(self.applicant)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_a_governor_of_the_branch_above_cannot_decide_it_either(self):
        """Deciding grants authority, and delegated granting is deliberately not built (§17M)."""
        governor = make_user('dec-governor')
        NodeGovernor.objects.create(
            user=governor,
            content_type=ContentType.objects.get_for_model(Branch),
            object_id=self.branch.pk,
        )

        response = self.decide(governor)
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_deciding_twice_is_a_clean_conflict(self):
        self.decide(self.staff)
        again = self.decide(self.staff)

        self.assertEqual(again.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(NodeGovernor.objects.filter(user=self.applicant).count(), 1)

    def test_approving_when_the_grant_already_exists_still_reads_as_yes(self):
        NodeGovernor.objects.create(
            user=self.applicant,
            content_type=self.application.content_type,
            object_id=self.material.pk,
        )

        response = self.decide(self.staff)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(NodeGovernor.objects.filter(user=self.applicant).count(), 1)

    def test_an_approved_governor_can_then_curate_that_materials_gallery(self):
        """The whole point of the feature, end to end: applying is how somebody earns the right the
        gallery's own curation check asks about."""
        from moderation.services import is_governor_of_material

        self.assertFalse(is_governor_of_material(self.applicant, self.material))
        self.decide(self.staff)
        self.assertTrue(is_governor_of_material(self.applicant, self.material))


class WithdrawTests(APITestCase):
    def setUp(self):
        self.branch = make_branch()
        self.material = make_material(self.branch)
        self.applicant = make_user('wd-applicant')
        self.other = make_user('wd-other')
        self.application = GovernorApplication.objects.create(
            applicant=self.applicant,
            content_type=ContentType.objects.get_for_model(type(self.material)),
            object_id=self.material.pk,
            statement=STATEMENT,
        )

    def test_the_applicant_can_withdraw(self):
        self.client.force_authenticate(self.applicant)
        response = self.client.post(
            reverse('governor-application-withdraw', args=[self.application.pk])
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['status'], 'withdrawn')

    def test_somebody_else_cannot_see_it_to_withdraw_it(self):
        self.client.force_authenticate(self.other)
        response = self.client.post(
            reverse('governor-application-withdraw', args=[self.application.pk])
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_withdrawing_twice_is_a_conflict(self):
        self.client.force_authenticate(self.applicant)
        self.client.post(reverse('governor-application-withdraw', args=[self.application.pk]))
        again = self.client.post(
            reverse('governor-application-withdraw', args=[self.application.pk])
        )
        self.assertEqual(again.status_code, status.HTTP_409_CONFLICT)
