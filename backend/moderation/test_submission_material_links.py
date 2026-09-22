""""Add an exercise to this material" — the submission half.

A brand-new exercise written from a material's page carries the material in its
`ExerciseSubmission.payload` draft (`material_id` / `material_role` / `material_locator`, key names
owned by `exercises/links.py`). Two things have to hold and neither is visible from the other:

1. the draft is **validated at submission time**, not silently at apply time weeks later;
2. the link is created on BOTH approval paths — a moderator's approve and the verified-contributor
   fast path — because `_apply_submission` is one function with two callers and a step added for
   one of them only is exactly the drift moderation/CLAUDE.md warns about.

Its own module rather than an addition to `tests.py`, the shape `test_governor_applications.py`
already established for a feature with its own story.
"""

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from exercises.models import ExerciseMaterialLink
from moderation.models import ExerciseSubmission
from testing.factories import make_course, make_material, make_user


class SubmissionPayloadValidationTests(APITestCase):
    def setUp(self):
        self.branch = make_course(slug='sub-link-branch')
        self.material = make_material(self.branch, slug='sub-link-script', title='For material X')
        self.student = make_user('sub-link-student')
        self.client.force_authenticate(self.student)

    def _post(self, **payload_extras):
        return self.client.post(
            reverse('exercise-submission-list'),
            {
                'branch': self.branch.slug,
                'payload': {
                    'difficulty': 'easy',
                    'locale': 'pl',
                    'title': 'Drafted for a material',
                    'statement': 'Prove something.',
                    **payload_extras,
                },
            },
            format='json',
        )

    def test_a_draft_naming_a_real_published_material_is_accepted(self):
        response = self._post(
            material_id=self.material.pk, material_role='practice', material_locator='p. 12'
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_a_draft_naming_a_material_that_does_not_exist_is_refused(self):
        self.assertEqual(self._post(material_id=999999).status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_draft_naming_an_unpublished_material_is_refused(self):
        self.material.published = False
        self.material.save(update_fields=['published'])
        self.assertEqual(
            self._post(material_id=self.material.pk).status_code, status.HTTP_400_BAD_REQUEST
        )

    def test_an_unknown_role_is_refused(self):
        response = self._post(material_id=self.material.pk, material_role='vibes')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_an_over_long_locator_is_refused(self):
        response = self._post(material_id=self.material.pk, material_locator='x' * 121)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_draft_with_no_material_at_all_is_untouched(self):
        """The overwhelmingly common case — every submission made before this feature existed, and
        every one made from `/submit` without a material."""
        self.assertEqual(self._post().status_code, status.HTTP_201_CREATED)


class SubmissionApprovalCreatesTheLinkTests(APITestCase):
    def setUp(self):
        self.branch = make_course(slug='apply-link-branch')
        self.material = make_material(self.branch, slug='apply-link-script', title='The script')
        self.student = make_user('apply-link-student')
        self.moderator = make_user('apply-link-mod', is_staff=True)

    def _submission(self, **payload_extras):
        return ExerciseSubmission.objects.create(
            branch=self.branch,
            submitted_by=self.student,
            payload={
                'difficulty': 'easy',
                'locale': 'pl',
                'title': 'Transcribed from the script',
                'statement': 'Prove something.',
                **payload_extras,
            },
        )

    def _approve(self, submission):
        self.client.force_authenticate(self.moderator)
        return self.client.post(
            reverse(
                'moderation-action',
                kwargs={'kind': 'submission', 'pk': submission.pk, 'decision': 'approve'},
            ),
            {},
            format='json',
        )

    def test_approving_creates_the_link_credited_to_the_submitter(self):
        submission = self._submission(
            material_id=self.material.pk, material_role='source', material_locator='p. 34, ex. 3.2'
        )
        self.assertEqual(self._approve(submission).status_code, status.HTTP_200_OK)
        submission.refresh_from_db()
        link = ExerciseMaterialLink.objects.get(exercise=submission.resulting_exercise)
        self.assertEqual(link.material, self.material)
        self.assertEqual(link.role, 'source')
        self.assertEqual(link.locator, 'p. 34, ex. 3.2')
        self.assertEqual(link.added_by, self.student)

    def test_the_role_defaults_to_source_when_the_draft_did_not_say(self):
        submission = self._submission(material_id=self.material.pk)
        self._approve(submission)
        submission.refresh_from_db()
        self.assertEqual(
            ExerciseMaterialLink.objects.get(exercise=submission.resulting_exercise).role, 'source'
        )

    def test_a_material_unpublished_while_the_submission_waited_still_publishes_the_exercise(self):
        submission = self._submission(material_id=self.material.pk)
        self.material.published = False
        self.material.save(update_fields=['published'])
        self.assertEqual(self._approve(submission).status_code, status.HTTP_200_OK)
        submission.refresh_from_db()
        self.assertIsNotNone(submission.resulting_exercise)
        self.assertFalse(ExerciseMaterialLink.objects.exists())

    def test_rejecting_never_creates_a_link(self):
        submission = self._submission(material_id=self.material.pk)
        self.client.force_authenticate(self.moderator)
        self.client.post(
            reverse(
                'moderation-action',
                kwargs={'kind': 'submission', 'pk': submission.pk, 'decision': 'reject'},
            ),
            {'review_note': 'Not sound.'},
            format='json',
        )
        self.assertFalse(ExerciseMaterialLink.objects.exists())

    def test_the_verified_contributor_fast_path_creates_the_same_link(self):
        """`perform_create` publishes a verified contributor's submission synchronously through the
        SAME `_apply_submission`, so the link must arrive without any moderator ever acting."""
        verified = make_user('apply-link-verified', is_verified_contributor=True)
        self.client.force_authenticate(verified)
        response = self.client.post(
            reverse('exercise-submission-list'),
            {
                'branch': self.branch.slug,
                'payload': {
                    'difficulty': 'easy',
                    'locale': 'pl',
                    'title': 'Straight to live',
                    'statement': 'Prove something.',
                    'material_id': self.material.pk,
                    'material_role': 'practice',
                    'material_locator': 'ch. 5',
                },
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['status'], 'approved')
        link = ExerciseMaterialLink.objects.get(exercise_id=response.data['resulting_exercise'])
        self.assertEqual(link.material, self.material)
        self.assertEqual(link.role, 'practice')
        self.assertEqual(link.locator, 'ch. 5')
        self.assertEqual(link.added_by, verified)


class QueueShowsWhichMaterialTests(APITestCase):
    """The moderator has to be able to see "for material X" before deciding — otherwise the link
    lands on approval as a surprise nobody reviewed."""

    def setUp(self):
        self.branch = make_course(slug='queue-link-branch')
        self.material = make_material(self.branch, slug='queue-link-script', title='Queue script')
        self.student = make_user('queue-link-student')
        self.moderator = make_user('queue-link-mod', is_staff=True)

    def test_the_queue_row_names_the_material(self):
        ExerciseSubmission.objects.create(
            branch=self.branch,
            submitted_by=self.student,
            payload={
                'difficulty': 'easy',
                'locale': 'pl',
                'title': 'Drafted',
                'statement': 'Prove something.',
                'material_id': self.material.pk,
            },
        )
        self.client.force_authenticate(self.moderator)
        response = self.client.get(reverse('moderation-queue'))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        row = response.data['submissions'][0]
        self.assertEqual(row['material_id'], self.material.pk)
        self.assertEqual(row['material_title'], 'Queue script')

    def test_a_submission_with_no_material_says_so_with_nulls(self):
        ExerciseSubmission.objects.create(
            branch=self.branch,
            submitted_by=self.student,
            payload={
                'difficulty': 'easy',
                'locale': 'pl',
                'title': 'Plain',
                'statement': 'Prove something.',
            },
        )
        self.client.force_authenticate(self.moderator)
        row = self.client.get(reverse('moderation-queue')).data['submissions'][0]
        self.assertIsNone(row['material_id'])
        self.assertIsNone(row['material_title'])
