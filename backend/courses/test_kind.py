"""A course is a community around a topic OR the companion to one university course (owner,
2026-10-14). What these pin is the shape of that one field: a university course must say which
university, a community carries no university fields at all (not even stale ones after an edit),
and the hub's two filters find exactly what they say they find.
"""

from django.contrib.auth.models import User

from .models import Course, CourseItem
from .tests import ApiTestCase


class CourseKindTests(ApiTestCase):
    def test_a_course_founded_without_a_kind_is_a_topic_community(self):
        res = self.as_(self.instructor).post('/api/courses/', {'title': 'Algebra'}, format='json')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['kind'], 'topic')
        self.assertEqual(res.data['university'], '')

    def test_a_university_course_carries_its_university_code_term_and_branch(self):
        res = self.as_(self.instructor).post(
            '/api/courses/',
            {
                'title': 'Analiza II — ćwiczenia',
                'kind': 'university',
                'university': '  Uniwersytet Warszawski ',
                'course_code': '1000-112bAM2',
                'current_term': '2026/27, lato',
                'subjects': ['analiza-2'],
            },
            format='json',
        )
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['kind'], 'university')
        self.assertEqual(res.data['university'], 'Uniwersytet Warszawski')
        self.assertEqual(res.data['course_code'], '1000-112bAM2')
        self.assertEqual(res.data['current_term'], '2026/27, lato')
        self.assertEqual(res.data['subject_slugs'], ['analiza-2'])

    def test_a_university_course_without_a_university_is_refused_with_the_reason(self):
        res = self.as_(self.instructor).post(
            '/api/courses/',
            {'title': 'Somewhere', 'kind': 'university', 'course_code': 'X-1'},
            format='json',
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn('university', res.data)

    def test_an_unknown_kind_is_refused(self):
        res = self.as_(self.instructor).post(
            '/api/courses/', {'title': 'x', 'kind': 'club'}, format='json'
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn('kind', res.data)

    def test_a_topic_community_drops_university_fields_even_when_sent(self):
        res = self.as_(self.instructor).post(
            '/api/courses/',
            {'title': 'Linear algebra for everyone', 'kind': 'topic', 'university': 'UW'},
            format='json',
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['university'], '')

    def test_switching_to_topic_clears_the_stale_code(self):
        course = self.make_course(
            kind='university', university='UW', course_code='1000-1', current_term='zima'
        )
        res = self.as_(self.instructor).patch(
            f'/api/courses/{course.pk}/', {'kind': 'topic'}, format='json'
        )
        self.assertEqual(res.status_code, 200, res.data)
        course.refresh_from_db()
        self.assertEqual((course.university, course.course_code, course.current_term), ('', '', ''))

    def test_editing_another_field_of_a_university_course_keeps_it_valid(self):
        """A PATCH that does not mention the university must not trip the "names its university"
        rule — the stored one counts."""
        course = self.make_course(kind='university', university='UW')
        res = self.as_(self.instructor).patch(
            f'/api/courses/{course.pk}/', {'title': 'Renamed'}, format='json'
        )
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['university'], 'UW')

    def test_the_kind_and_university_filters(self):
        topic = self.make_course(title='Topic')
        uw = self.make_course(title='At UW', kind='university', university='Uniwersytet Warszawski')
        uwr = self.make_course(
            title='At UWr', kind='university', university='Uniwersytet Wrocławski'
        )
        client = self.as_(self.other)

        def ids(query):
            return {row['id'] for row in client.get(f'/api/courses/{query}').data}

        self.assertEqual(ids('?kind=topic'), {topic.pk})
        self.assertEqual(ids('?kind=university'), {uw.pk, uwr.pk})
        # Whole and case-insensitive: one spelling differing only in case is the same university,
        # and a prefix is not.
        self.assertEqual(ids('?university=uniwersytet warszawski'), {uw.pk})
        self.assertEqual(ids('?university=Uniwersytet'), set())
        # An unknown kind is ignored, like an unknown audience.
        self.assertEqual(ids('?kind=club'), {topic.pk, uw.pk, uwr.pk})

    def test_search_finds_a_course_by_its_code(self):
        self.make_course(title='Something', kind='university', university='UW', course_code='AM2-xyz')
        res = self.as_(self.other).get('/api/courses/?q=am2-XYZ')
        self.assertEqual([row['title'] for row in res.data], ['Something'])

    def test_filters_never_widen_visibility(self):
        """House rule 4: the filter narrows the visible queryset, it does not replace it."""
        self.make_course(title='Hidden', kind='university', university='UW', visibility='only_you')
        res = self.as_(self.other).get('/api/courses/?kind=university&university=UW')
        self.assertEqual(res.data, [])
        self.assertTrue(Course.objects.filter(title='Hidden').exists())


class UniversityVersionTests(ApiTestCase):
    """A general course and its university/faculty versions (owner, 2026-10-14) — `rules.py`."""

    def make_version(self, parent, client=None, **extra):
        body = {
            'title': 'AM2 na MIM',
            'parent': parent.pk,
            # Sent explicitly since 2026-10-21: a child's kind is the client's to say (a `topic`
            # child is a SUBCOURSE and takes the parent's staff), and the form sends it.
            'kind': 'university',
            'university': 'Uniwersytet Warszawski',
            'faculty': 'MIM',
            'visibility': 'public',
            **extra,
        }
        return (client or self.as_(self.student)).post('/api/courses/', body, format='json')

    def test_anyone_who_may_found_a_course_may_add_a_version_and_it_is_a_university_course(self):
        general = self.make_course(title='Analiza 2')
        res = self.make_version(general)
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['parent'], general.pk)
        self.assertEqual(
            res.data['parent_summary'], {'id': general.pk, 'title': 'Analiza 2', 'kind': 'topic'}
        )
        self.assertEqual(res.data['parent_relation'], 'version')
        self.assertEqual(res.data['ancestors'], [{'id': general.pk, 'title': 'Analiza 2', 'kind': 'topic'}])
        self.assertEqual(res.data['kind'], 'university')
        self.assertEqual(res.data['faculty'], 'MIM')
        # Its own course, run by whoever made it — not by the general course's owner.
        self.assertEqual(res.data['instructor']['id'], self.student.pk)

    def test_a_version_needs_a_university(self):
        general = self.make_course()
        res = self.make_version(general, university='')
        self.assertEqual(res.status_code, 400)
        self.assertIn('university', res.data)

    def test_a_version_under_a_version_is_a_subcourse_and_takes_the_parents_staff(self):
        # Until 2026-10-21 this was `parent_is_subcourse` ("one level only"). A course under a
        # university course is now a SUBCOURSE of it — one university's lab group — which the
        # parent's own staff may add and a stranger may not (`not_parent_staff`); `test_subcourses`
        # has the tree itself.
        general = self.make_course()
        version = Course.objects.get(pk=self.make_version(general).data['id'])
        res = self.make_version(version, client=self.as_(self.other))
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['parent'], ['not_parent_staff'])
        ok = self.make_version(version, client=self.as_(self.student), title='Grupa 3')
        self.assertEqual(ok.status_code, 201, ok.data)
        self.assertEqual(ok.data['parent_relation'], 'subcourse')

    def test_a_university_course_under_a_standalone_university_course_is_a_subcourse(self):
        # Was `parent_not_general` before the tree: "a version of one university's course means
        # nothing" is still true, and the row is now read as a subcourse instead.
        standalone = self.make_course(kind='university', university='UW')
        res = self.make_version(standalone, client=self.as_(self.instructor))
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['parent_relation'], 'subcourse')

    def test_a_version_cannot_be_more_visible_than_its_parent(self):
        general = self.make_course(visibility='private', title='Unlisted')
        res = self.make_version(general, client=self.as_(self.instructor), visibility='public')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['parent'], ['more_visible_than_parent'])
        ok = self.make_version(general, client=self.as_(self.instructor), visibility='private')
        self.assertEqual(ok.status_code, 201, ok.data)
        # …and the same check on a later edit of the version.
        res = self.as_(self.instructor).patch(
            f"/api/courses/{ok.data['id']}/", {'visibility': 'public'}, format='json'
        )
        self.assertEqual(res.status_code, 400)

    def test_a_parent_the_caller_cannot_see_is_refused_as_not_found(self):
        hidden = self.make_course(visibility='only_you')
        res = self.make_version(hidden, visibility='only_you')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['parent'], ['parent_not_found'])

    def test_a_version_may_be_moved_to_another_general_course_by_its_administrator(self):
        # `parent_fixed` until 2026-10-21; moving is the tree's own feature now and the same
        # refusals apply at the new place (`test_subcourses` has the rest of them).
        general = self.make_course()
        other_general = self.make_course(title='Other')
        version = self.make_version(general)
        res = self.as_(self.student).patch(
            f"/api/courses/{version.data['id']}/", {'parent': other_general.pk}, format='json'
        )
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data['parent'], other_general.pk)
        self.assertEqual(res.data['parent_relation'], 'version')
        # A stranger to the version cannot move it: the PATCH itself is 404 for them.
        res = self.as_(self.other).patch(
            f"/api/courses/{version.data['id']}/", {'parent': general.pk}, format='json'
        )
        self.assertEqual(res.status_code, 404)

    def test_narrowing_the_parent_hides_its_versions_from_strangers_but_not_from_members(self):
        general = self.make_course()
        version_id = self.make_version(general).data['id']
        self.as_(self.other).post(f'/api/courses/{version_id}/enrol/')
        stranger = User.objects.create_user('obcy', 'obcy@x.example', 'pw12345!')
        self.assertEqual(self.as_(stranger).get(f'/api/courses/{version_id}/').status_code, 200)
        general.visibility = 'only_you'
        general.save(update_fields=['visibility'])
        self.assertEqual(self.as_(stranger).get(f'/api/courses/{version_id}/').status_code, 404)
        member = self.as_(self.other).get(f'/api/courses/{version_id}/')
        self.assertEqual(member.status_code, 200)
        # …and the member is not told the title of a course they can no longer read.
        self.assertIsNone(member.data['parent_summary'])

    def test_parent_top_and_faculty_filters(self):
        general = self.make_course(title='General')
        version_id = self.make_version(general).data['id']
        client = self.as_(self.other)

        def ids(query):
            return [row['id'] for row in client.get(f'/api/courses/{query}').data]

        self.assertEqual(ids(f'?parent={general.pk}'), [version_id])
        # The versions list belongs to a course's page, which never narrows by language.
        self.assertEqual(ids(f'?parent={general.pk}&content_locales=en'), [version_id])
        self.assertEqual(ids('?top=true&content_locales=en'), [])
        self.assertEqual(ids('?top=true'), [general.pk])
        self.assertEqual(ids('?faculty=mim'), [version_id])

    def test_deleting_the_general_course_leaves_the_version_standing(self):
        general = self.make_course()
        version_id = self.make_version(general).data['id']
        general.delete()
        version = Course.objects.get(pk=version_id)
        self.assertIsNone(version.parent_id)
        self.assertEqual(version.kind, 'university')

    def test_materials_gathers_the_versions_materials_in_one_list(self):
        general = self.make_course(title='General')
        version = Course.objects.get(pk=self.make_version(general).data['id'])
        own = self.make_material('own', 'Notatki ogólne')
        theirs = self.make_material('theirs', 'Notatki z MIM')
        pending = self.make_material('pending', 'Czeka')
        CourseItem.objects.create(course=general, material=own, status='approved')
        CourseItem.objects.create(course=version, material=theirs, status='approved')
        CourseItem.objects.create(course=version, material=pending, status='pending')
        res = self.as_(self.other).get(f'/api/courses/{general.pk}/materials/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(
            [(r['material'], r['course']['is_this_course']) for r in res.data],
            [(own.pk, True), (theirs.pk, False)],
        )
        self.assertEqual(res.data[1]['course']['faculty'], 'MIM')
        # A version's own list is just its own.
        res = self.as_(self.other).get(f'/api/courses/{version.pk}/materials/')
        self.assertEqual([r['material'] for r in res.data], [theirs.pk])

    def test_materials_leaves_out_a_version_the_viewer_cannot_see(self):
        general = self.make_course()
        hidden = self.make_course(
            title='Hidden', parent=general, kind='university', university='UW', visibility='only_you'
        )
        CourseItem.objects.create(
            course=hidden, material=self.make_material('h', 'Hidden notes'), status='approved'
        )
        res = self.as_(self.other).get(f'/api/courses/{general.pk}/materials/')
        self.assertEqual(res.data, [])
