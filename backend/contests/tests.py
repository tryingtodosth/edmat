"""`contests` — the prep's own assertions (CONTESTS-BRIEF.md §2). Step A and step B each add their
own test modules beside this one (`test_api.py`, `test_presets.py`, …) rather than growing it.

What the prep fixes and these rows pin: a draft contest does not exist for a stranger (house rule
4); the organiser who founded it manages it without a staff row; a jury member is staff and may
score but may not manage; a secretary may neither; the node seam dispatches every one of those
answers; the flag is seeded ON and closes the presets endpoint to a non-staff caller; founding a
contest is a creation-gate kind.
"""

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from config import nodes
from config.creation import CREATION_KINDS
from contests import access
from contests.models import Contest, ContestStaff
from moderation.models import FeatureFlag
from telemetry.routers import all_log_shards
from testing.factories import make_user


def _flag(key, enabled):
    FeatureFlag.objects.update_or_create(key=key, defaults={'is_enabled': enabled})


class ContestPrepTests(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        _flag('contests', True)
        self.organiser = make_user('contest-organiser')
        self.jury = make_user('contest-jury')
        self.secretary = make_user('contest-secretary')
        self.stranger = make_user('contest-stranger')
        self.contest = Contest.objects.create(title='Konkurs Matematyczny', organiser=self.organiser)
        ContestStaff.objects.create(contest=self.contest, user=self.jury, role='jury')
        ContestStaff.objects.create(contest=self.contest, user=self.secretary, role='secretary')

    def test_a_draft_does_not_exist_for_a_stranger_and_exists_for_its_staff(self):
        self.assertFalse(access.can_view(self.stranger, self.contest))
        self.assertFalse(access.can_view(None, self.contest))
        self.assertTrue(access.can_view(self.jury, self.contest))
        self.assertTrue(access.can_view(self.organiser, self.contest))
        self.assertNotIn(self.contest, access.visible_contests(self.stranger))
        self.assertIn(self.contest, access.visible_contests(self.secretary))

    def test_announced_and_public_exists_for_everyone(self):
        self.contest.status = 'announced'
        self.contest.visibility = 'public'
        self.contest.save()
        self.assertTrue(access.can_view(None, self.contest))
        self.assertIn(self.contest, access.visible_contests(None))
        # Announced but still private: staff only. `status` asks "has this been announced",
        # `visibility` asks "to whom" — the same two axes an event has.
        self.contest.visibility = 'private'
        self.contest.save()
        self.assertFalse(access.can_view(self.stranger, self.contest))

    def test_roles_organiser_without_a_row_jury_scores_secretary_does_neither(self):
        self.assertEqual(access.role_of(self.organiser, self.contest), 'organiser')
        self.assertTrue(access.can_manage(self.organiser, self.contest))
        self.assertTrue(access.can_score(self.organiser, self.contest))
        self.assertEqual(access.role_of(self.jury, self.contest), 'jury')
        self.assertTrue(access.is_staff(self.jury, self.contest))
        self.assertTrue(access.can_score(self.jury, self.contest))
        self.assertFalse(access.can_manage(self.jury, self.contest))
        self.assertFalse(access.can_score(self.secretary, self.contest))
        self.assertFalse(access.can_manage(self.secretary, self.contest))
        self.assertIsNone(access.role_of(self.stranger, self.contest))
        self.assertFalse(access.is_member(self.stranger, self.contest))

    def test_the_node_seam_dispatches_to_access(self):
        self.assertEqual(nodes.kind_of(self.contest), 'contest')
        self.assertEqual(nodes.resolve_node('contest', self.contest.pk), self.contest)
        self.assertFalse(nodes.can_view_node(self.stranger, self.contest))
        self.assertTrue(nodes.is_node_staff(self.jury, self.contest))
        self.assertFalse(nodes.can_manage_node(self.jury, self.contest))
        self.assertTrue(nodes.can_manage_node(self.organiser, self.contest))
        staff = set(nodes.node_staff_users(self.contest))
        self.assertEqual(staff, {self.organiser, self.jury, self.secretary})
        ref = nodes.node_ref(self.contest, self.organiser)
        self.assertEqual(ref['kind'], 'contest')
        self.assertTrue(ref['can_manage'])
        self.assertIsNone(ref['slug'])

    def test_node_ref_endpoint_404s_a_stranger_and_answers_staff(self):
        url = reverse('node-ref', kwargs={'kind': 'contest', 'pk': self.contest.pk})
        self.client.force_authenticate(self.stranger)
        self.assertEqual(self.client.get(url).status_code, status.HTTP_404_NOT_FOUND)
        self.client.force_authenticate(self.jury)
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['title'], 'Konkurs Matematyczny')

    def test_presets_endpoint_is_public_and_answers_to_the_flag(self):
        url = reverse('contest-presets')
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        keys = [p['key'] for p in response.data['presets']]
        self.assertEqual(keys[0], 'challenge')  # the prize-free default comes first
        self.assertNotIn('kuratorium', keys)  # staff-only (CONTESTS-LAW.md §14 item 9)
        self.assertIn('kc_921_1', response.data['law'])
        _flag('contests', False)
        # DRF answers an anonymous caller 401 and a signed-in one 403 when the gate refuses — the
        # same two codes every other killed surface gives, so both are pinned here.
        self.assertEqual(self.client.get(url).status_code, status.HTTP_401_UNAUTHORIZED)
        self.client.force_authenticate(self.stranger)
        self.assertEqual(self.client.get(url).status_code, status.HTTP_403_FORBIDDEN)
        self.client.force_authenticate(make_user('contest-mod', is_staff=True))
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('kuratorium', [p['key'] for p in response.data['presets']])

    def test_the_flag_is_seeded_on_and_a_contest_is_a_creation_kind(self):
        self.assertIn('contest', CREATION_KINDS)
        self.assertTrue(FeatureFlag.objects.filter(key='contests').exists())

    def test_description_is_sanitized_on_write(self):
        self.contest.description = '<p>ok</p><script>alert(1)</script>'
        self.contest.save()
        self.contest.refresh_from_db()
        self.assertNotIn('<script', self.contest.description)
        self.assertIn('ok', self.contest.description)
