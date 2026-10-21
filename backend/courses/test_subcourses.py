"""The course tree (owner, 2026-10-21: "courses can have their own courses (subcourses) … having
parent-child relationship"): a course under a course, any depth, told apart from a university
version by the two rows' kinds — `rules.py`, the tree section.

Weighted at refusals, as `tests.py` says of itself: the properties that fail silently. A loop, a
tree past the cap, a stranger carving somebody else's course into parts, a subcourse more visible
than its parent — none of these announces itself on the happy path.
"""

from django.contrib.auth.models import User

from . import rules
from .models import Course
from .tests import ApiTestCase


class SubcourseTests(ApiTestCase):
    def add(self, parent, client=None, **extra):
        body = {'title': 'Część', 'parent': parent.pk, 'visibility': 'public', **extra}
        return (client or self.as_(self.instructor)).post('/api/courses/', body, format='json')

    def test_the_owner_adds_a_subcourse_and_it_reads_as_one(self):
        root = self.make_course(title='Analiza')
        res = self.add(root, title='Analiza 1')
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data['parent'], root.pk)
        self.assertEqual(res.data['parent_relation'], 'subcourse')
        self.assertEqual(res.data['kind'], 'topic')
        self.assertEqual(
            res.data['ancestors'], [{'id': root.pk, 'title': 'Analiza', 'kind': 'topic'}]
        )
        # Its own course: run by whoever made it, with its own owner row.
        self.assertEqual(res.data['instructor']['id'], self.instructor.pk)

    def test_a_stranger_may_not_add_a_subcourse_but_may_still_add_a_version(self):
        root = self.make_course(title='Analiza')
        refused = self.add(root, client=self.as_(self.student))
        self.assertEqual(refused.status_code, 400)
        self.assertEqual(refused.data['parent'], ['not_parent_staff'])
        version = self.add(
            root, client=self.as_(self.student), kind='university', university='UW'
        )
        self.assertEqual(version.status_code, 201, version.data)
        self.assertEqual(version.data['parent_relation'], 'version')

    def test_an_assistant_of_the_parent_may_add_a_subcourse(self):
        root = self.make_course(title='Analiza')
        root.staff.create(user=self.student, role='assistant', added_by=self.instructor)
        res = self.add(root, client=self.as_(self.student))
        self.assertEqual(res.status_code, 201, res.data)

    def test_the_tree_nests_to_the_cap_and_no_further(self):
        node = self.make_course(title='L1')
        for level in range(2, rules.MAX_COURSE_DEPTH + 1):
            res = self.add(node, title=f'L{level}')
            self.assertEqual(res.status_code, 201, res.data)
            node = Course.objects.get(pk=res.data['id'])
        self.assertEqual(rules.depth_of(node), rules.MAX_COURSE_DEPTH)
        too_deep = self.add(node, title='one more')
        self.assertEqual(too_deep.status_code, 400)
        self.assertEqual(too_deep.data['parent'], ['too_deep'])
        # The breadcrumb carries the whole chain, root first.
        page = self.as_(self.instructor).get(f'/api/courses/{node.pk}/')
        self.assertEqual(
            [row['title'] for row in page.data['ancestors']],
            [f'L{n}' for n in range(1, rules.MAX_COURSE_DEPTH)],
        )

    def test_moving_a_course_under_its_own_descendant_is_refused(self):
        root = self.make_course(title='Root')
        child = Course.objects.get(pk=self.add(root, title='Child').data['id'])
        grandchild = Course.objects.get(pk=self.add(child, title='Grandchild').data['id'])
        res = self.as_(self.instructor).patch(
            f'/api/courses/{root.pk}/', {'parent': grandchild.pk}, format='json'
        )
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['parent'], ['parent_is_descendant'])
        self_ref = self.as_(self.instructor).patch(
            f'/api/courses/{root.pk}/', {'parent': root.pk}, format='json'
        )
        self.assertEqual(self_ref.data['parent'], ['parent_is_self'])

    def test_moving_counts_what_the_moved_course_carries_beneath_it(self):
        # A two-level tree moved under a course at depth MAX-1 would end past the cap.
        deep = self.make_course(title='D1')
        for level in range(2, rules.MAX_COURSE_DEPTH):
            deep = Course.objects.get(pk=self.add(deep, title=f'D{level}').data['id'])
        self.assertEqual(rules.depth_of(deep), rules.MAX_COURSE_DEPTH - 1)
        movable = self.make_course(title='M1')
        self.add(movable, title='M2')
        res = self.as_(self.instructor).patch(
            f'/api/courses/{movable.pk}/', {'parent': deep.pk}, format='json'
        )
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['parent'], ['too_deep'])

    def test_detaching_and_moving_are_the_administrators_and_keep_the_rank_rule(self):
        root = self.make_course(title='Root', visibility='private')
        child = Course.objects.get(
            pk=self.add(root, title='Child', visibility='private').data['id']
        )
        # Narrowing or widening the child alone is still checked against the parent's rank —
        # without being asked to "place" it, so no `not_parent_staff` for an administrator of the
        # child who is not the parent's staff.
        child.staff.create(user=self.other, role='admin', added_by=self.instructor)
        root.staff.filter(user=self.other).delete()
        wider = self.as_(self.other).patch(
            f'/api/courses/{child.pk}/', {'visibility': 'public'}, format='json'
        )
        self.assertEqual(wider.status_code, 400)
        self.assertEqual(wider.data['parent'], ['more_visible_than_parent'])
        same = self.as_(self.other).patch(
            f'/api/courses/{child.pk}/', {'visibility': 'only_you'}, format='json'
        )
        self.assertEqual(same.status_code, 200, same.data)
        # Detaching needs nobody's permission but the child's own administrator.
        detached = self.as_(self.other).patch(
            f'/api/courses/{child.pk}/', {'parent': None}, format='json'
        )
        self.assertEqual(detached.status_code, 200, detached.data)
        self.assertIsNone(detached.data['parent'])
        self.assertIsNone(detached.data['parent_relation'])
        self.assertEqual(detached.data['ancestors'], [])

    def test_a_subcourse_is_hidden_with_its_parent_from_strangers_but_not_from_members(self):
        root = self.make_course(title='Root')
        child_id = self.add(root, title='Child').data['id']
        self.as_(self.other).post(f'/api/courses/{child_id}/enrol/')
        stranger = User.objects.create_user('obcy', 'obcy@x.example', 'pw12345!')
        self.assertEqual(self.as_(stranger).get(f'/api/courses/{child_id}/').status_code, 200)
        root.visibility = 'only_you'
        root.save(update_fields=['visibility'])
        self.assertEqual(self.as_(stranger).get(f'/api/courses/{child_id}/').status_code, 404)
        member = self.as_(self.other).get(f'/api/courses/{child_id}/')
        self.assertEqual(member.status_code, 200)
        self.assertIsNone(member.data['parent_summary'])
        self.assertEqual(member.data['ancestors'], [])

    def test_the_ancestor_trail_starts_below_the_first_course_the_viewer_cannot_see(self):
        root = self.make_course(title='Root')
        mid = Course.objects.get(pk=self.add(root, title='Mid').data['id'])
        leaf_id = self.add(mid, title='Leaf').data['id']
        self.as_(self.other).post(f'/api/courses/{leaf_id}/enrol/')
        # The root goes private; the member of the leaf still sees "Mid › Leaf".
        root.visibility = 'only_you'
        root.save(update_fields=['visibility'])
        Course.objects.filter(pk=mid.pk).update(visibility='public')
        page = self.as_(self.other).get(f'/api/courses/{leaf_id}/')
        self.assertEqual(page.status_code, 200)
        self.assertEqual([row['title'] for row in page.data['ancestors']], ['Mid'])

    def test_a_school_class_takes_no_subcourses(self):
        from organizations.models import Organization, OrganizationLink, OrganizationMember
        from django.contrib.contenttypes.models import ContentType

        klass = self.make_course(title='7a')
        school = Organization.objects.create(
            name='SP 12', slug='sp12', kind='school', created_by=self.instructor
        )
        OrganizationMember.objects.create(organization=school, user=self.instructor, role='owner')
        OrganizationLink.objects.create(
            organization=school,
            content_type=ContentType.objects.get_for_model(Course),
            object_id=klass.pk,
            kind='runs',
            added_by=self.instructor,
        )
        res = self.add(klass)
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data['parent'], ['parent_is_class'])

    def test_parent_lists_both_kinds_of_child_and_general_lists_roots_only(self):
        root = self.make_course(title='Root')
        sub_id = self.add(root, title='Part').data['id']
        version_id = self.add(
            root, client=self.as_(self.student), kind='university', university='UW'
        ).data['id']
        client = self.as_(self.other)
        rows = client.get(f'/api/courses/?parent={root.pk}').data
        self.assertEqual(
            {(row['id'], row['parent_relation']) for row in rows},
            {(sub_id, 'subcourse'), (version_id, 'version')},
        )
        general = [row['id'] for row in client.get('/api/courses/?general=true').data]
        self.assertEqual(general, [root.pk])

    def test_descendant_ids_walks_the_whole_subtree(self):
        root = self.make_course(title='Root')
        a = Course.objects.get(pk=self.add(root, title='A').data['id'])
        b = Course.objects.get(pk=self.add(root, title='B').data['id'])
        aa = Course.objects.get(pk=self.add(a, title='AA').data['id'])
        self.assertEqual(set(rules.descendant_ids(root)), {a.pk, b.pk, aa.pk})
        self.assertEqual(rules.descendant_ids(aa), [])
        self.assertEqual(rules.subtree_height(root), 3)
        self.assertEqual(rules.subtree_height(aa), 1)

    def test_the_materials_index_gathers_the_whole_subtree(self):
        from .models import CourseItem

        root = self.make_course(title='Root')
        part = Course.objects.get(pk=self.add(root, title='Part').data['id'])
        deeper = Course.objects.get(pk=self.add(part, title='Deeper').data['id'])
        m1 = self.make_material('m1', 'Skrypt 1')
        m2 = self.make_material('m2', 'Skrypt 2')
        CourseItem.objects.create(course=part, material=m1)
        CourseItem.objects.create(course=deeper, material=m2)
        rows = self.as_(self.other).get(f'/api/courses/{root.pk}/materials/').data
        self.assertEqual({row['course']['title'] for row in rows}, {'Part', 'Deeper'})
        self.assertEqual({row['material'] for row in rows}, {m1.pk, m2.pk})
