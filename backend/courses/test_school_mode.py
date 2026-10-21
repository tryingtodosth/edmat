"""School mode, the completion certificate, the branch record and `seed_school_demo`.

Learning step C. A separate file rather than four hundred more lines in `tests.py`, following the
app's own precedent (`test_claims.py`, `test_content_links.py`): one feature, one file.

Refusal-weighted, like everything else in this project's backend suite. The happy paths here are
small and announce themselves immediately — a certificate that does not issue is noticed in one
click. What fails silently is the other half: a class whose teacher can read a `private` tracker
**only** because a school runs it, a guardian column that reaches somebody it should not, a
certificate readable by a stranger, a revoked one that can be revoked twice.
"""

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Guardianship
from organizations.models import Organization, OrganizationLink, OrganizationMember
from taxonomy.models import Branch, Discipline
from telemetry.routers import all_log_shards

from . import record, rules
from .models import Chapter, Course, CourseCompletion, Enrollment, Lesson, LessonProgress


class SchoolTestCase(TestCase):
    """One school, one class it runs, one class it does not, a teacher and three pupils."""

    databases = set(all_log_shards()) | {'default'}

    def setUp(self):
        self.teacher = User.objects.create_user('teacher', 'teacher@x.example', 'pw12345!')
        self.head = User.objects.create_user('head', 'head@x.example', 'pw12345!')
        self.guardian = User.objects.create_user('guardian', 'g@x.example', 'pw12345!')
        self.stranger = User.objects.create_user('stranger', 's@x.example', 'pw12345!')
        self.discipline = Discipline.objects.create(slug='fizyka')
        self.branch = Branch.objects.create(slug='mechanika', discipline=self.discipline)

        # `private` tracking: nobody but each pupil sees their own row — UNLESS a school runs it.
        # The whole of school mode is the difference between this course and `self.plain`.
        self.klass = Course.objects.create(
            instructor=self.teacher,
            title='Fizyka 2a',
            visibility='private',
            status='running',
            progress_visibility='private',
        )
        self.klass.subjects.set([self.branch])
        self.plain = Course.objects.create(
            instructor=self.teacher,
            title='Reading group',
            visibility='public',
            status='running',
            progress_visibility='private',
        )

        self.school = Organization.objects.create(
            name='TEST=FAKE Szkoła', slug='szkola', kind='school', created_by=self.head
        )
        OrganizationMember.objects.create(organization=self.school, user=self.head, role='owner')
        self.link = self._link(self.school, self.klass, kind='runs')

        self.chapter = Chapter.objects.create(course=self.klass, title='Kinematyka')
        self.lessons = [
            Lesson.objects.create(chapter=self.chapter, title=f'Lekcja {n}', order=n)
            for n in range(3)
        ]

        self.finished = self._pupil('zofia', guardians=[self.guardian])
        self.halfway = self._pupil('jan', guardians=[self.guardian])
        self.grown = self._pupil('kacper', guardians=[])
        for pupil in (self.finished, self.halfway, self.grown):
            Enrollment.objects.create(course=self.klass, participant=pupil, status='active')
        for lesson in self.lessons:
            LessonProgress.objects.create(lesson=lesson, participant=self.finished, status='done')
        LessonProgress.objects.create(
            lesson=self.lessons[0], participant=self.halfway, status='done'
        )

    # -- fixtures -------------------------------------------------------------------------------

    def _pupil(self, username, *, guardians):
        user = User.objects.create_user(username, '', 'pw12345!')
        if guardians:
            user.profile.is_minor = True
            user.profile.save(update_fields=['is_minor'])
        for guardian in guardians:
            Guardianship.objects.create(guardian=guardian, child=user)
        return user

    def _link(self, organization, course, *, kind='runs'):
        from django.contrib.contenttypes.models import ContentType

        return OrganizationLink.objects.create(
            organization=organization,
            content_type=ContentType.objects.get_for_model(Course),
            object_id=course.pk,
            kind=kind,
        )

    def as_(self, user):
        client = APIClient()
        client.force_authenticate(user)
        return client


class IsSchoolCourseTests(SchoolTestCase):
    def test_a_runs_link_from_a_school_makes_the_course_a_class(self):
        self.assertEqual(rules.is_school_course(self.klass), self.school)
        self.assertIsNone(rules.is_school_course(self.plain))

    def test_supports_is_not_runs(self):
        """A faculty lending its name has not taken responsibility for the roster."""
        self.link.kind = 'supports'
        self.link.save(update_fields=['kind'])
        self.assertIsNone(rules.is_school_course(self.klass))

    def test_a_university_running_a_course_does_not_make_a_class(self):
        self.school.kind = 'university'
        self.school.save(update_fields=['kind'])
        self.assertIsNone(rules.is_school_course(self.klass))

    def test_a_dissolved_school_runs_nothing(self):
        """`is_active=False` is the tombstone; every badge comes off every page, and so does this."""
        self.school.is_active = False
        self.school.save(update_fields=['is_active'])
        self.assertIsNone(rules.is_school_course(self.klass))

    def test_the_bulk_map_and_the_single_lookup_agree(self):
        """Two spellings of one question is how the roster and the register start disagreeing."""
        bulk = rules.schools_running_courses()
        self.assertEqual(bulk.get(self.klass.pk), self.school)
        self.assertNotIn(self.plain.pk, bulk)

    def test_a_class_cannot_have_university_versions(self):
        """WP11: a class's `kind` is the default `topic` — school mode is a link, not a kind — so
        the kind test alone let a class through as "a general course" with versions under it. The
        refusal is its own word, and the same class without its school takes versions again."""
        self.assertEqual(self.klass.kind, 'topic')
        self.assertEqual(
            rules.subcourse_block_reason(
                self.teacher, self.klass, visibility='private', kind='university'
            ),
            'parent_is_class',
        )
        self.teacher.profile.is_verified_contributor = True
        self.teacher.profile.save(update_fields=['is_verified_contributor'])
        body = {
            'title': 'Fizyka 2a na UW',
            'parent': self.klass.pk,
            'university': 'Uniwersytet Warszawski',
            'visibility': 'private',
        }
        response = self.as_(self.teacher).post('/api/courses/', body, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['parent'], ['parent_is_class'])
        self.assertFalse(Course.objects.filter(parent=self.klass).exists())

        # `supports` is not `runs`: a school lending its name does not make a class.
        self.link.kind = 'supports'
        self.link.save(update_fields=['kind'])
        self.assertIsNone(
            rules.subcourse_block_reason(
                self.teacher, self.klass, visibility='private', kind='university'
            )
        )

    def test_the_course_payload_names_the_school(self):
        response = self.as_(self.teacher).get(f'/api/courses/{self.klass.pk}/')
        self.assertEqual(response.data['school']['slug'], 'szkola')
        plain = self.as_(self.teacher).get(f'/api/courses/{self.plain.pk}/')
        self.assertIsNone(plain.data['school'])


class ProgressWideningTests(SchoolTestCase):
    def _progress(self, client, course, lesson):
        return client.get(f'/api/courses/{course.pk}/lessons/{lesson.pk}/progress/')

    def test_staff_of_a_class_read_every_pupils_row_although_the_mode_is_private(self):
        response = self._progress(self.as_(self.teacher), self.klass, self.lessons[0])
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['school_mode'])
        states = {row['participant']['id']: row['status'] for row in response.data['people']}
        self.assertEqual(states[self.finished.pk], 'done')
        self.assertEqual(states[self.grown.pk], 'not_started')
        self.assertEqual(response.data['summary']['participants'], 3)

    def test_the_same_teacher_on_an_ordinary_private_course_learns_nothing(self):
        """The control: the widening is the school's link, not the teacher's role.

        A 200 rather than a 403, and that is the pre-existing behaviour rather than something school
        mode changed — under `private`, staff are still members, so `progress_visible_to` lets them
        have the envelope and then every part of it is empty. Asserted on the CONTENTS for that
        reason: a status-code-only control would have passed against a response that named every
        participant.
        """
        chapter = Chapter.objects.create(course=self.plain, title='Week 1')
        lesson = Lesson.objects.create(chapter=chapter, title='One')
        response = self._progress(self.as_(self.teacher), self.plain, lesson)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data['school_mode'])
        self.assertIsNone(response.data['people'])
        self.assertIsNone(response.data['summary'])

    def test_a_pupil_in_a_class_learns_nothing_about_anybody_else(self):
        response = self._progress(self.as_(self.halfway), self.klass, self.lessons[0])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['mine'], 'done')
        self.assertIsNone(response.data['people'])
        self.assertIsNone(response.data['summary'])
        self.assertFalse(response.data['school_mode'])

    def test_school_mode_deliberately_does_not_widen_off(self):
        """`off` is not a narrowing, it is "there is no tracker", and the course has told its
        participants nobody is watching. A school override would make that untrue for children after
        the fact — `rules.staff_sees_all_progress` says so at length. A class that wants the register
        turns tracking on, which is one visible setting."""
        self.klass.progress_visibility = 'off'
        self.klass.save(update_fields=['progress_visibility'])
        self.assertFalse(rules.staff_sees_all_progress(self.teacher, self.klass))
        teacher = self._progress(self.as_(self.teacher), self.klass, self.lessons[0])
        self.assertEqual(teacher.status_code, 403)
        refused = self.as_(self.halfway).put(
            f'/api/courses/{self.klass.pk}/lessons/{self.lessons[0].pk}/progress/',
            {'status': 'done'},
            format='json',
        )
        self.assertEqual(refused.status_code, 403)

    def test_staff_do_not_write_a_pupils_row_in_school_mode_either(self):
        """A progress entry is the participant speaking about themselves, and a class does not
        change that — `progress_writable_by` is participants only, school or no school."""
        response = self.as_(self.teacher).put(
            f'/api/courses/{self.klass.pk}/lessons/{self.lessons[0].pk}/progress/',
            {'status': 'done'},
            format='json',
        )
        self.assertEqual(response.status_code, 403)

    def test_a_stranger_gets_nothing_from_a_class(self):
        response = self._progress(self.as_(self.stranger), self.klass, self.lessons[0])
        self.assertEqual(response.status_code, 404)

    def test_the_course_payload_widens_too(self):
        """The panel on the course page reads `chapters[].lessons[].progress`, not the standalone
        endpoint, so the widening has to reach both — it once reached only one."""
        response = self.as_(self.teacher).get(f'/api/courses/{self.klass.pk}/')
        progress = response.data['chapters'][0]['lessons'][0]['progress']
        self.assertTrue(progress['school_mode'])
        self.assertIsNotNone(progress['people'])


class GuardianColumnTests(SchoolTestCase):
    def test_staff_of_a_class_see_each_pupils_guardians(self):
        response = self.as_(self.teacher).get(f'/api/courses/{self.klass.pk}/participants/')
        self.assertEqual(response.status_code, 200)
        rows = {row['participant']['id']: row for row in response.data}
        self.assertEqual(
            [g['id'] for g in rows[self.finished.pk]['guardians']], [self.guardian.pk]
        )
        self.assertTrue(rows[self.finished.pk]['is_minor'])

    def test_a_pupil_who_is_not_a_minor_reports_an_absence_rather_than_nothing(self):
        """`guardians: []` and `is_minor: false` are two different facts — an adult has no guardian,
        and so does a minor whose guardian revoked consent. The second is the row to chase."""
        response = self.as_(self.teacher).get(f'/api/courses/{self.klass.pk}/participants/')
        row = next(r for r in response.data if r['participant']['id'] == self.grown.pk)
        self.assertEqual(row['guardians'], [])
        self.assertFalse(row['is_minor'])

    def test_a_revoked_guardianship_is_not_who_a_teacher_writes_to(self):
        Guardianship.objects.filter(child=self.halfway).update(
            revoked_at='2026-01-01T00:00:00Z'
        )
        response = self.as_(self.teacher).get(f'/api/courses/{self.klass.pk}/participants/')
        row = next(r for r in response.data if r['participant']['id'] == self.halfway.pk)
        self.assertEqual(row['guardians'], [])
        # Still a minor. That is the point: the column now says "a child with nobody on file".
        self.assertTrue(row['is_minor'])

    def test_a_fellow_pupil_sees_no_guardians_and_no_age_band(self):
        response = self.as_(self.halfway).get(f'/api/courses/{self.klass.pk}/participants/')
        self.assertEqual(response.status_code, 200)
        for row in response.data:
            self.assertEqual(row['guardians'], [])
            self.assertFalse(row['is_minor'])

    def test_the_guardian_column_survives_a_tracker_that_is_off(self):
        """The two widenings are one decision but not one rule: a guardian is who a teacher writes
        to about a child, which has nothing to do with whether the course keeps a tracker. The first
        draft of `courses/rules.py` coupled them by having one function call the other."""
        self.klass.progress_visibility = 'off'
        self.klass.save(update_fields=['progress_visibility'])
        self.assertTrue(rules.staff_sees_guardians(self.teacher, self.klass))
        self.assertFalse(rules.staff_sees_all_progress(self.teacher, self.klass))
        response = self.as_(self.teacher).get(f'/api/courses/{self.klass.pk}/participants/')
        row = next(r for r in response.data if r['participant']['id'] == self.finished.pk)
        self.assertEqual([g['id'] for g in row['guardians']], [self.guardian.pk])

    def test_staff_of_an_ordinary_course_see_no_guardians(self):
        Enrollment.objects.create(course=self.plain, participant=self.finished, status='active')
        response = self.as_(self.teacher).get(f'/api/courses/{self.plain.pk}/participants/')
        row = next(r for r in response.data if r['participant']['id'] == self.finished.pk)
        self.assertEqual(row['guardians'], [])
        self.assertFalse(row['is_minor'])


class CompletionBlockReasonTests(SchoolTestCase):
    def test_none_for_a_participant_whose_own_statements_say_done(self):
        self.assertIsNone(
            rules.completion_block_reason(self.teacher, self.klass, self.finished)
        )

    def test_not_staff_for_anybody_who_does_not_run_the_course(self):
        self.assertEqual(
            rules.completion_block_reason(self.stranger, self.klass, self.finished), 'not_staff'
        )
        self.assertEqual(
            rules.completion_block_reason(self.halfway, self.klass, self.finished), 'not_staff'
        )

    def test_not_participant_for_somebody_off_the_roster(self):
        self.assertEqual(
            rules.completion_block_reason(self.teacher, self.klass, self.stranger),
            'not_participant',
        )
        self.assertEqual(
            rules.completion_block_reason(self.teacher, self.klass, None), 'not_participant'
        )

    def test_a_removed_participant_is_not_a_participant(self):
        Enrollment.objects.filter(course=self.klass, participant=self.finished).update(
            status='removed'
        )
        self.assertEqual(
            rules.completion_block_reason(self.teacher, self.klass, self.finished),
            'not_participant',
        )

    def test_not_done_until_every_lesson_is_ticked(self):
        self.assertEqual(
            rules.completion_block_reason(self.teacher, self.klass, self.halfway), 'not_done'
        )

    def test_a_lesson_added_later_un_completes_everybody(self):
        """The count is recounted, never stored (house rule 5) — an issued certificate keeps its own
        note, but somebody who has not yet earned one does not get one from a stale number."""
        Lesson.objects.create(chapter=self.chapter, title='Lekcja 4', order=9)
        self.assertEqual(
            rules.completion_block_reason(self.teacher, self.klass, self.finished), 'not_done'
        )

    def test_a_course_with_no_lessons_is_not_vacuously_complete(self):
        self.lessons[0].delete()
        self.lessons[1].delete()
        self.lessons[2].delete()
        self.assertEqual(
            rules.completion_block_reason(self.teacher, self.klass, self.finished), 'not_done'
        )

    def test_already_issued_counts_a_revoked_one(self):
        completion = CourseCompletion.objects.create(
            course=self.klass, participant=self.finished, issued_by=self.teacher
        )
        self.assertEqual(
            rules.completion_block_reason(self.teacher, self.klass, self.finished),
            'already_issued',
        )
        completion.revoked_at = '2026-01-01T00:00:00Z'
        completion.save(update_fields=['revoked_at'])
        self.assertEqual(
            rules.completion_block_reason(self.teacher, self.klass, self.finished),
            'already_issued',
        )

    def test_the_note_carries_the_count_it_was_issued_on(self):
        self.assertEqual(
            rules.completion_note(self.klass, self.finished),
            "3 of 3 lessons, by the participant's own statements",
        )


class CompletionEndpointTests(SchoolTestCase):
    def _issue(self, actor, participant, **extra):
        return self.as_(actor).post(
            f'/api/courses/{self.klass.pk}/completions/',
            {'participant': participant.pk, **extra},
            format='json',
        )

    def test_staff_issue_one_and_the_note_is_written_server_side(self):
        response = self._issue(self.teacher, self.finished, note='Gratulacje!')
        self.assertEqual(response.status_code, 201)
        self.assertIn("3 of 3 lessons, by the participant's own statements", response.data['note'])
        self.assertIn('Gratulacje!', response.data['note'])
        self.assertEqual(response.data['issued_by']['id'], self.teacher.pk)
        self.assertFalse(response.data['is_revoked'])
        self.assertEqual(response.data['organization']['slug'], 'szkola')

    def test_every_refusal_carries_its_word_and_its_own_status(self):
        for actor, participant, expected_status, word in (
            (self.stranger, self.finished, 404, None),
            (self.halfway, self.finished, 404, None),
            (self.teacher, self.stranger, 400, 'not_participant'),
            (self.teacher, self.halfway, 409, 'not_done'),
        ):
            with self.subTest(word=word or 'not_staff'):
                response = self._issue(actor, participant)
                self.assertEqual(response.status_code, expected_status)
                if word:
                    self.assertEqual(response.data['detail'], word)

    def test_a_second_certificate_for_one_pair_is_a_409(self):
        self.assertEqual(self._issue(self.teacher, self.finished).status_code, 201)
        second = self._issue(self.teacher, self.finished)
        self.assertEqual(second.status_code, 409)
        self.assertEqual(second.data['detail'], 'already_issued')
        self.assertEqual(CourseCompletion.objects.filter(course=self.klass).count(), 1)

    def test_no_grade_field_exists_to_send(self):
        """§4.5 and §5: no grade, no mark, no rank. A client that sends one is ignored rather than
        refused, because there is nothing on the model for it to land in — asserted so that adding
        such a field becomes a visible decision rather than a quiet one."""
        response = self._issue(self.teacher, self.finished, grade='5', mark=5, rank=1)
        self.assertEqual(response.status_code, 201)
        self.assertNotIn('grade', response.data)
        self.assertNotIn('mark', response.data)
        self.assertNotIn('rank', response.data)

    def test_the_list_is_scoped_not_refused(self):
        self._issue(self.teacher, self.finished)
        staff = self.as_(self.teacher).get(f'/api/courses/{self.klass.pk}/completions/')
        self.assertEqual(len(staff.data), 1)
        holder = self.as_(self.finished).get(f'/api/courses/{self.klass.pk}/completions/')
        self.assertEqual(len(holder.data), 1)
        # A fellow pupil with none of their own gets an empty list, which leaks neither the other
        # certificate nor the size of the roster.
        peer = self.as_(self.halfway).get(f'/api/courses/{self.klass.pk}/completions/')
        self.assertEqual(peer.data, [])
        self.assertEqual(
            self.as_(self.stranger).get(f'/api/courses/{self.klass.pk}/completions/').status_code,
            404,
        )

    def test_the_detail_page_resolves_for_the_three_people_who_may_read_it(self):
        completion = self._issue(self.teacher, self.finished).data
        for actor in (self.teacher, self.finished):
            with self.subTest(actor=actor.username):
                response = self.as_(actor).get(f'/api/course-completions/{completion["id"]}/')
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.data['course_title'], 'Fizyka 2a')

    def test_a_stranger_gets_404_on_the_certificate_not_403(self):
        """403 would confirm that somebody finished a course, which is the fact the page carries."""
        completion = self._issue(self.teacher, self.finished).data
        self.assertEqual(
            self.as_(self.stranger).get(f'/api/course-completions/{completion["id"]}/').status_code,
            404,
        )

    def test_a_fellow_participant_gets_404_too(self):
        completion = self._issue(self.teacher, self.finished).data
        self.assertEqual(
            self.as_(self.halfway).get(f'/api/course-completions/{completion["id"]}/').status_code,
            404,
        )

    def test_a_school_leaver_keeps_their_own_certificate(self):
        """Found by the test above failing: `_visible_courses` is "listed, or run by you, or enrolled
        in by you", so a pupil who leaves a PRIVATE class — which is what a school runs — fell out of
        the queryset and their own certificate 404'd on them, at the one moment they are most likely
        to want to show it to somebody. `get_queryset` now admits their own rows explicitly."""
        completion = self._issue(self.teacher, self.finished).data
        Enrollment.objects.filter(course=self.klass, participant=self.finished).update(status='left')
        response = self.as_(self.finished).get(f'/api/course-completions/{completion["id"]}/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['participant']['id'], self.finished.pk)
        # And it still does not widen who else may read it.
        self.assertEqual(
            self.as_(self.stranger).get(f'/api/course-completions/{completion["id"]}/').status_code,
            404,
        )

    def test_the_issuer_keeps_reading_it_after_losing_their_staff_row(self):
        """Somebody who signed a certificate must still be able to see what they put their name to.

        Built through a second staff member, because the owner row cannot be removed (the app's own
        hostage-proofing) and `can_read_completion` would answer True through `is_staff_member`
        anyway — which would make this test vacuous.
        """
        from .models import CourseStaff

        assistant = User.objects.create_user('ola', 'ola@x.example', 'pw12345!')
        CourseStaff.objects.create(course=self.klass, user=assistant, role='admin')
        completion = self._issue(assistant, self.finished).data
        CourseStaff.objects.filter(course=self.klass, user=assistant).delete()
        response = self.as_(assistant).get(f'/api/course-completions/{completion["id"]}/')
        self.assertEqual(response.status_code, 200)


class RevokeTests(SchoolTestCase):
    def setUp(self):
        super().setUp()
        self.completion = CourseCompletion.objects.create(
            course=self.klass, participant=self.finished, issued_by=self.teacher, note='3 of 3'
        )

    def _revoke(self, actor):
        return self.as_(actor).post(f'/api/course-completions/{self.completion.pk}/revoke/')

    def test_staff_revoke_it_and_the_row_survives(self):
        response = self._revoke(self.teacher)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['is_revoked'])
        self.assertIsNotNone(response.data['revoked_at'])
        # Tombstone, not a delete (house rule 12): a holder who printed the sheet finds the page
        # saying it was withdrawn rather than a 404.
        self.assertTrue(CourseCompletion.objects.filter(pk=self.completion.pk).exists())

    def test_the_holder_cannot_revoke_their_own(self):
        self.assertEqual(self._revoke(self.finished).status_code, 404)

    def test_a_stranger_gets_404(self):
        self.assertEqual(self._revoke(self.stranger).status_code, 404)

    def test_revoking_twice_is_a_409_with_the_word(self):
        self.assertEqual(self._revoke(self.teacher).status_code, 200)
        again = self._revoke(self.teacher)
        self.assertEqual(again.status_code, 409)
        self.assertEqual(again.data['detail'], 'already_revoked')

    def test_the_holder_still_reads_a_revoked_certificate(self):
        self._revoke(self.teacher)
        response = self.as_(self.finished).get(
            f'/api/course-completions/{self.completion.pk}/'
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['is_revoked'])


class KillSwitchTests(SchoolTestCase):
    """A staff-bypassed check proves nothing about a FeatureFlag (`e2e/CLAUDE.md` trap 10), so
    every actor here is an ordinary account."""

    def _set(self, key, enabled):
        from moderation.models import FeatureFlag

        FeatureFlag.objects.update_or_create(key=key, defaults={'is_enabled': enabled})

    def test_courses_off_takes_the_completion_surface_with_it(self):
        completion = CourseCompletion.objects.create(
            course=self.klass, participant=self.finished, issued_by=self.teacher
        )
        self._set('courses', False)
        self.assertEqual(
            self.as_(self.teacher).get(f'/api/courses/{self.klass.pk}/completions/').status_code,
            403,
        )
        self.assertEqual(
            self.as_(self.finished).get(f'/api/course-completions/{completion.pk}/').status_code,
            403,
        )

    def test_organizations_off_deliberately_does_not_un_school_a_class(self):
        """The flag governs the organisations SURFACE — the directory, the panel, the "run by" line.
        Turning it off in the middle of a term must not change what a teacher is shown about a child
        or what the roster says about them. `courses/rules.py` says so at the top; this pins it."""
        self._set('organizations', False)
        self.assertEqual(rules.is_school_course(self.klass), self.school)
        response = self.as_(self.teacher).get(
            f'/api/courses/{self.klass.pk}/lessons/{self.lessons[0].pk}/progress/'
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['school_mode'])


class BranchRecordTests(SchoolTestCase):
    """`courses/record.py` — the dict step B's registry consumes (`prompts/03-learning-record.md`)."""

    def test_lessons_done_are_counted_per_branch(self):
        self.assertEqual(
            record.activity_by_branch(self.finished), {self.branch.pk: {'lessons_done': 3}}
        )
        self.assertEqual(
            record.activity_by_branch(self.halfway), {self.branch.pk: {'lessons_done': 1}}
        )

    def test_a_statement_that_is_not_done_is_not_counted(self):
        LessonProgress.objects.filter(participant=self.halfway).update(status='stuck')
        self.assertEqual(record.activity_by_branch(self.halfway), {})

    def test_a_course_with_no_branch_contributes_nothing(self):
        self.klass.subjects.clear()
        self.assertEqual(record.activity_by_branch(self.finished), {})

    def test_a_course_under_two_branches_counts_in_both(self):
        """Deliberate: picking one branch per course would be the server inventing a primary
        subject the course never declared."""
        second = Branch.objects.create(slug='termodynamika', discipline=self.discipline)
        self.klass.subjects.add(second)
        self.assertEqual(
            record.activity_by_branch(self.finished),
            {self.branch.pk: {'lessons_done': 3}, second.pk: {'lessons_done': 3}},
        )

    def test_an_anonymous_caller_gets_an_empty_dict(self):
        from django.contrib.auth.models import AnonymousUser

        self.assertEqual(record.activity_by_branch(AnonymousUser()), {})
        self.assertEqual(record.activity_by_branch(None), {})


class SchoolDemoSeedTests(TestCase):
    """`seed_school_demo` — that it builds, that a second run leaves one of everything, that its
    containment check is not a no-op, and that `--reset` takes it all away."""

    databases = set(all_log_shards()) | {'default'}

    def _build(self):
        from testing import school_demo

        return school_demo.build_school_demo('seed-pass-test')

    def test_it_builds_a_school_two_classes_and_one_certificate(self):
        from testing import school_demo

        built = self._build()
        self.assertEqual(built['school'].kind, 'school')
        self.assertTrue(built['school'].name.startswith(school_demo.FAKE_PREFIX))
        self.assertEqual(len(built['classes']), 2)
        self.assertEqual(len(built['pupils']), 12)
        self.assertEqual(built['report']['minors'], 11)
        self.assertEqual(CourseCompletion.objects.count(), 1)
        for built_class in built['classes'].values():
            self.assertTrue(built_class['course'].title.startswith(school_demo.FAKE_PREFIX))
            self.assertEqual(rules.is_school_course(built_class['course']), built['school'])

    def test_the_certificate_is_one_the_rules_would_have_issued(self):
        """`_issue_certificate` asks `completion_block_reason` first, so a hand-edited plan fails the
        command instead of seeding a certificate the API refuses. Checked from the other side here:
        the pupil who holds it is complete, and the next candidate is refused `already_issued`
        only because they have none yet."""
        from testing import school_demo

        built = self._build()
        course = built['classes']['2a']['course']
        holder = built['pupils'][school_demo.CERTIFIED_PUPIL]
        self.assertEqual(
            rules.completion_block_reason(built['teacher'], course, holder), 'already_issued'
        )
        self.assertIsNone(
            rules.completion_block_reason(built['teacher'], course, built['pupils']['05'])
        )
        self.assertEqual(
            rules.completion_block_reason(built['teacher'], course, built['pupils']['06']),
            'not_done',
        )

    def test_a_second_run_leaves_one_of_everything(self):
        first = self._build()
        second = self._build()
        self.assertEqual(first['school'].pk, second['school'].pk)
        self.assertEqual(
            first['classes']['2a']['course'].pk, second['classes']['2a']['course'].pk
        )
        self.assertEqual(Course.objects.count(), 2)
        self.assertEqual(CourseCompletion.objects.count(), 1)
        self.assertEqual(second['report']['progress_rows'], first['report']['progress_rows'])
        # The items were refiled, not duplicated — `CourseItem.lesson` is SET_NULL, so deleting the
        # chapters alone would have left an unfiled pile behind on every re-run.
        from .models import CourseItem

        self.assertEqual(CourseItem.objects.filter(lesson__isnull=True).count(), 0)

    def test_containment_refuses_an_account_that_reached_outside_the_demo(self):
        from testing import school_demo

        built = self._build()
        outsider = Course.objects.create(
            instructor=User.objects.create_user('real', 'r@x.example', 'pw12345!'),
            title='A real course',
            visibility='public',
        )
        from .models import CourseStaff

        CourseStaff.objects.create(course=outsider, user=built['teacher'], role='admin')
        with self.assertRaises(RuntimeError) as caught:
            school_demo.assert_contained(
                built['school'], [b['course'] for b in built['classes'].values()]
            )
        self.assertIn('CourseStaff', str(caught.exception))

    def test_containment_refuses_a_seeded_account_that_became_platform_staff(self):
        from testing import school_demo

        built = self._build()
        built['teacher'].is_staff = True
        built['teacher'].save(update_fields=['is_staff'])
        with self.assertRaises(RuntimeError) as caught:
            school_demo.assert_contained(
                built['school'], [b['course'] for b in built['classes'].values()]
            )
        self.assertIn('is_staff', str(caught.exception))

    def test_every_containment_model_still_imports(self):
        """A rename must not turn the check into a silent no-op — `conference_demo`'s own reasoning."""
        from importlib import import_module

        from testing import school_demo

        for label, path, _scope in school_demo.CONTAINMENT_MODELS:
            with self.subTest(model=label):
                module_path, _, class_name = path.rpartition('.')
                self.assertTrue(hasattr(import_module(module_path), class_name))

    def test_reset_takes_the_school_the_classes_the_links_and_the_people(self):
        from django.contrib.contenttypes.models import ContentType

        from testing import school_demo

        self._build()
        school_demo.remove_school_demo()
        self.assertEqual(Course.objects.count(), 0)
        self.assertEqual(Organization.objects.filter(slug=school_demo.SCHOOL_SLUG).count(), 0)
        self.assertEqual(User.objects.filter(username__startswith=school_demo.PREFIX).count(), 0)
        # The generic FK has no cascade of its own, so a link row left pointing at a deleted course
        # would be dropped silently by `_readable_links` on every page — a tidy-looking leak.
        self.assertEqual(
            OrganizationLink.objects.filter(
                content_type=ContentType.objects.get_for_model(Course)
            ).count(),
            0,
        )

    def test_the_command_runs_and_prints_the_password(self):
        from io import StringIO

        from django.core.management import call_command

        out = StringIO()
        call_command('seed_school_demo', '--password', 'printed-pass', stdout=out)
        printed = out.getvalue()
        self.assertIn('printed-pass', printed)
        self.assertIn('TEST=FAKE', printed)
        self.assertIn('1 certificate', printed)


class GeneralCourseTests(SchoolTestCase):
    """WP12: "General courses" on the hub meant "has no parent", which is also true of a school class
    and of a stand-alone university course. `rules.general_courses` is the meaning (`?general=true`),
    and the hub's row-by-row mirror of it is held to it here."""

    def setUp(self):
        super().setUp()
        self.general = Course.objects.create(
            instructor=self.teacher, title='Mechanika dla wszystkich', visibility='public'
        )
        self.version = Course.objects.create(
            instructor=self.teacher,
            title='Mechanika na UW',
            visibility='public',
            kind='university',
            university='Uniwersytet Warszawski',
            parent=self.general,
        )
        self.standalone = Course.objects.create(
            instructor=self.teacher,
            title='Fizyka I na PW',
            visibility='public',
            kind='university',
            university='Politechnika Warszawska',
        )

    def _general(self):
        return set(rules.general_courses(Course.objects.all()).values_list('pk', flat=True))

    def test_only_a_topic_course_with_no_parent_and_no_school_is_general(self):
        # `self.klass` is the one that slipped through: topic, no parent — and a school runs it.
        self.assertEqual(self._general(), {self.general.pk, self.plain.pk})

    def test_a_supporting_school_or_a_dissolved_one_leaves_a_general_course_general(self):
        self.link.kind = 'supports'
        self.link.save(update_fields=['kind'])
        self.assertIn(self.klass.pk, self._general())
        self.link.kind = 'runs'
        self.link.save(update_fields=['kind'])
        self.school.is_active = False
        self.school.save(update_fields=['is_active'])
        self.assertIn(self.klass.pk, self._general())

    def test_the_filter_and_the_payload_the_hub_mirrors_it_from_agree(self):
        """`?general=true` is the rule; the hub applies `labels.ts: isGeneralCourse` to each row's
        `kind`, `parent` and `school`. Both are asked of the same list here, so a drift between the
        payload and the rule fails a test rather than a reader's chip."""
        rows = self.as_(self.teacher).get('/api/courses/').data  # inside the private class
        mirrored = {
            row['id']
            for row in rows
            if row['kind'] == 'topic' and row['parent'] is None and row['school'] is None
        }
        listed = {row['id'] for row in self.as_(self.teacher).get('/api/courses/?general=true').data}
        self.assertEqual(listed, mirrored)
        self.assertEqual(listed, {self.general.pk, self.plain.pk})
        # `?top=true` stays the SHAPE (no parent), class and stand-alone course included.
        top = {row['id'] for row in self.as_(self.teacher).get('/api/courses/?top=true').data}
        self.assertTrue({self.klass.pk, self.standalone.pk, self.general.pk} <= top)
        self.assertNotIn(self.version.pk, top)


class SchoolTakesOnAVersionTests(SchoolTestCase):
    """WP12: WP11's `parent_is_class` stops a version being made UNDER a class. The other door is a
    school starting to RUN a course that is already a version, or already has versions — through a
    new `runs` link, or by a body that already runs it turning into a school. Both are refused with
    a word (`rules.school_run_block_reason`), and everything next to them still works."""

    def setUp(self):
        super().setUp()
        # The teacher runs the courses AND administers the bodies: a link needs both ends.
        OrganizationMember.objects.create(organization=self.school, user=self.teacher, role='admin')
        self.general = Course.objects.create(
            instructor=self.teacher, title='Mechanika dla wszystkich', visibility='public'
        )
        self.version = Course.objects.create(
            instructor=self.teacher,
            title='Mechanika na UW',
            visibility='public',
            kind='university',
            university='Uniwersytet Warszawski',
            parent=self.general,
        )
        self.circle = Organization.objects.create(
            name='Koło fizyków', slug='kolo', kind='student_circle', created_by=self.teacher
        )
        OrganizationMember.objects.create(organization=self.circle, user=self.teacher, role='owner')

    def _post_link(self, organization, course, kind='runs'):
        return self.as_(self.teacher).post(
            f'/api/organizations/{organization.pk}/links/',
            {'node_kind': 'course', 'node_id': course.pk, 'kind': kind},
            format='json',
        )

    def _links(self, course):
        return OrganizationLink.objects.filter(object_id=course.pk).exclude(pk=self.link.pk)

    def test_the_rule_names_both_shapes_and_passes_an_ordinary_course(self):
        self.assertEqual(rules.school_run_block_reason(self.version), 'course_is_version')
        self.assertEqual(rules.school_run_block_reason(self.general), 'course_has_versions')
        self.assertIsNone(rules.school_run_block_reason(self.plain))
        self.assertEqual(
            set(rules.SCHOOL_RUN_REFUSALS),
            {'course_is_version', 'course_is_subcourse', 'course_has_versions'},
        )
        # A subcourse (2026-10-21) answers its own word, so the organisation form can say which.
        part = Course.objects.create(
            instructor=self.teacher, title='Część', visibility='public', parent=self.general
        )
        self.assertEqual(rules.school_run_block_reason(part), 'course_is_subcourse')

    def test_a_school_may_not_start_to_run_a_version(self):
        response = self._post_link(self.school, self.version)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data['detail'], 'course_is_version')
        self.assertFalse(self._links(self.version).exists())
        self.assertIsNone(rules.is_school_course(self.version))

    def test_a_school_may_not_start_to_run_a_general_course_with_versions(self):
        response = self._post_link(self.school, self.general)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data['detail'], 'course_has_versions')
        self.assertFalse(self._links(self.general).exists())

    def test_the_same_general_course_without_versions_may_become_a_class(self):
        self.version.delete()  # SET_NULL leaves nothing under it
        response = self._post_link(self.school, self.general)
        self.assertEqual(response.status_code, 201)
        self.assertIsNotNone(rules.is_school_course(self.general))

    def test_supports_and_other_kinds_of_body_are_not_refused(self):
        """Only a school RUNNING it makes a class; nothing else is this rule's business."""
        self.assertEqual(self._post_link(self.school, self.version, kind='supports').status_code, 201)
        self.assertEqual(self._post_link(self.circle, self.version).status_code, 201)
        self.assertEqual(self._post_link(self.circle, self.general).status_code, 201)
        self.assertIsNone(rules.is_school_course(self.version))

    def test_a_body_that_runs_a_version_may_not_turn_into_a_school(self):
        self.assertEqual(self._post_link(self.circle, self.version).status_code, 201)
        response = self.as_(self.teacher).patch(
            f'/api/organizations/{self.circle.pk}/', {'kind': 'school'}, format='json'
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data['detail'], 'course_is_version')
        self.circle.refresh_from_db()
        self.assertEqual(self.circle.kind, 'student_circle')
        self.assertIsNone(rules.is_school_course(self.version))

    def test_a_body_that_runs_a_parent_of_versions_may_not_turn_into_a_school(self):
        self.assertEqual(self._post_link(self.circle, self.general).status_code, 201)
        response = self.as_(self.teacher).patch(
            f'/api/organizations/{self.circle.pk}/', {'kind': 'school'}, format='json'
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data['detail'], 'course_has_versions')

    def test_a_body_that_only_supports_a_version_or_runs_a_plain_course_may_become_a_school(self):
        self.assertEqual(self._post_link(self.circle, self.version, kind='supports').status_code, 201)
        self.assertEqual(self._post_link(self.circle, self.plain).status_code, 201)
        response = self.as_(self.teacher).patch(
            f'/api/organizations/{self.circle.pk}/', {'kind': 'school'}, format='json'
        )
        self.assertEqual(response.status_code, 200)
        self.circle.refresh_from_db()
        self.assertEqual(self.circle.kind, 'school')
        # An edit that leaves the kind alone is never asked the question.
        response = self.as_(self.teacher).patch(
            f'/api/organizations/{self.school.pk}/', {'city': 'Warszawa'}, format='json'
        )
        self.assertEqual(response.status_code, 200)
