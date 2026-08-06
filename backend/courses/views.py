"""Courses run by users — public discovery, instructor-owned writes, and enrolment.

The permission split is the one this app already uses everywhere else (`ServiceViewSet`,
`ExerciseSetViewSet`): anyone may read what is published, only the owner may change it, and scoping
is done in the queryset rather than by after-the-fact checks — so somebody poking at another
instructor's draft gets a 404, which is also the honest answer, since for them it does not exist.
"""

from django.contrib.auth import get_user_model
from django.contrib.contenttypes.models import ContentType
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.response import Response

from community.models import Comment
from community.serializers import CommentSerializer
from moderation.permissions import feature_gate
from notifications.services import notify, notify_course_participants

from .models import (
    ACTIVE_ENROLLMENT_STATUSES,
    BLOCKING_ENROLLMENT_STATUSES,
    LISTED_VISIBILITIES,
    Chapter,
    CourseInvite,
    CourseItem,
    CourseStaff,
    Enrollment,
    Lesson,
    Course,
)
from .serializers import (
    ChapterSerializer,
    ChapterWriteSerializer,
    CourseInviteSerializer,
    CourseInviteWriteSerializer,
    CourseItemSerializer,
    CourseItemWriteSerializer,
    CourseStaffSerializer,
    EnrollmentSerializer,
    InvitePreviewSerializer,
    LessonSerializer,
    LessonWriteSerializer,
    CourseSerializer,
    CourseWriteSerializer,
)

_CoursesFeatureGate = feature_gate('courses')


class CourseViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticatedOrReadOnly, _CoursesFeatureGate]

    def get_queryset(self):
        user = self.request.user
        qs = (
            Course.objects.select_related('instructor', 'instructor__profile', 'field')
            .prefetch_related('subjects', 'lessons', 'enrollments')
            .all()
        )

        if self.request.query_params.get('mine') == 'teaching':
            if not user.is_authenticated:
                return qs.none()
            # Every course this person runs, not only the ones they created — a co-teacher's own
            # "my courses" list that omitted the course they help run would be the first thing they
            # noticed missing.
            return qs.filter(staff__user=user).distinct()

        if self.request.query_params.get('mine') == 'participating':
            if not user.is_authenticated:
                return qs.none()
            # Includes pending requests deliberately: "I asked to join and am waiting" is exactly
            # the thing a person opens this list to check.
            return qs.filter(
                enrollments__participant=user,
                enrollments__status__in=BLOCKING_ENROLLMENT_STATUSES,
            ).distinct()

        # Filtering rather than permission-checking means anything you may not see is absent from
        # every listing for free, instead of being hidden by a rule each new endpoint has to
        # remember to apply.
        #
        # Only PUBLIC courses are listed. A private one is deliberately NOT added here for the sake
        # of whoever holds its link: this queryset also backs retrieve-by-id, so widening it would
        # make every private course walkable by counting integers, which is exactly the enumeration
        # its 256-bit invite token exists to prevent. The link route in is `/course-invites/<token>/`.
        # People already inside a course reach it by the two clauses below, not by its visibility.
        visible = qs.filter(visibility__in=LISTED_VISIBILITIES)
        if user.is_authenticated:
            visible = (
                visible
                | qs.filter(staff__user=user)
                | qs.filter(
                    enrollments__participant=user,
                    enrollments__status__in=ACTIVE_ENROLLMENT_STATUSES,
                )
            )
        qs = visible.distinct()

        subject = self.request.query_params.get('subject')
        if subject:
            qs = qs.filter(subjects__slug=subject)
        field = self.request.query_params.get('field')
        if field:
            qs = qs.filter(field__slug=field)
        if self.request.query_params.get('open') == 'true':
            qs = qs.filter(status='open')
        return qs.distinct()

    def get_serializer_class(self):
        if self.action in {'create', 'update', 'partial_update'}:
            return CourseWriteSerializer
        return CourseSerializer

    def perform_create(self, serializer):
        # An administrator can cap how many courses one account owns (Profile.max_courses, 0 being
        # uncapped). Checked here rather than in the serializer because it is a fact about the
        # CALLER, not about the payload — nothing the client sends can make it pass or fail.
        #
        # Deliberately not enforced against the admin or a seed command: both go through the model
        # directly, and an administrator raising somebody's ceiling should never be blocked by it.
        max_courses = getattr(getattr(self.request.user, 'profile', None), 'max_courses', 0)
        if max_courses:
            owned = Course.objects.filter(instructor=self.request.user).count()
            if owned >= max_courses:
                raise DRFValidationError(
                    {
                        'detail': [
                            'You have reached the number of courses your account may own '
                            f'({owned} of {max_courses}). Ask an administrator to raise it.'
                        ]
                    }
                )
        # The owner's `CourseStaff` row is created by `Course.save` — an invariant of the model
        # rather than of this one code path, since seed commands and the admin create courses too.
        serializer.save(instructor=self.request.user)

    def _owned(self):
        """The course, but only if the caller runs it. 404 rather than 403, matching this app's
        existing queryset-scoping convention."""
        course = self.get_object()
        if not course.can_administer(self.request.user):
            return None
        return course

    def update(self, request, *args, **kwargs):
        if not self.get_object().can_administer(request.user):
            return Response(status=status.HTTP_404_NOT_FOUND)
        response = super().update(request, *args, **kwargs)
        # Answer with the full read shape rather than the write one, so a client never has to
        # re-fetch just to refresh what it already had on screen.
        return Response(
            CourseSerializer(self.get_object(), context=self.get_serializer_context()).data,
            status=response.status_code,
        )

    def destroy(self, request, *args, **kwargs):
        # Deleting is the owner's alone — an administrator can run a course but not end it.
        if self.get_object().role_of(request.user) != 'owner':
            return Response(status=status.HTTP_404_NOT_FOUND)
        return super().destroy(request, *args, **kwargs)

    def create(self, request, *args, **kwargs):
        write = self.get_serializer(data=request.data)
        write.is_valid(raise_exception=True)
        self.perform_create(write)
        return Response(
            CourseSerializer(write.instance, context=self.get_serializer_context()).data,
            status=status.HTTP_201_CREATED,
        )

    # --- enrolment ------------------------------------------------------------------------------

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated, _CoursesFeatureGate])
    def enrol(self, request, pk=None):
        course = self.get_object()
        reason = course.enrollment_block_reason(request.user)
        if reason:
            # The reason travels to the client, because "full" and "you were removed" are the same
            # refusal to a status code and completely different to a person.
            return Response({'detail': reason}, status=status.HTTP_400_BAD_REQUEST)

        joining_status = 'pending' if course.enrollment_policy == 'approval' else 'active'
        note = (request.data.get('request_note') or '').strip()[:500]
        try:
            with transaction.atomic():
                enrollment, created = Enrollment.objects.get_or_create(
                    course=course,
                    participant=request.user,
                    defaults={'status': joining_status, 'request_note': note},
                )
                if not created:
                    # Re-joining after leaving reuses the row rather than adding another, which is
                    # what the uniqueness constraint is for.
                    enrollment.status = joining_status
                    enrollment.request_note = note
                    enrollment.decided_at = None
                    enrollment.save()
        except IntegrityError:
            return Response({'detail': 'already_enrolled'}, status=status.HTTP_400_BAD_REQUEST)

        if joining_status == 'pending':
            # Only under the approval policy is there anything for the instructor to do. Announcing
            # every open-policy join would be noise proportional to the course's popularity, which is
            # exactly the kind of notification people learn to ignore.
            notify(
                course.instructor,
                'course_enrollment_requested',
                actor=request.user,
                target_label=course.title,
                course=course,
                note=note,
            )
        return Response(EnrollmentSerializer(enrollment).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated, _CoursesFeatureGate])
    def leave(self, request, pk=None):
        course = self.get_object()
        enrollment = course.enrollments.filter(participant=request.user).first()
        if not enrollment or enrollment.status not in BLOCKING_ENROLLMENT_STATUSES:
            return Response({'detail': 'not_enrolled'}, status=status.HTTP_400_BAD_REQUEST)
        enrollment.status = 'left'
        enrollment.decided_at = timezone.now()
        enrollment.save()
        return Response(EnrollmentSerializer(enrollment).data)

    @action(detail=True, methods=['get'], permission_classes=[permissions.IsAuthenticated, _CoursesFeatureGate])
    def participants(self, request, pk=None):
        """Who is in the room.

        Visible to the instructor and to active participants, and to nobody else: a course roster is
        a list of real people, and a stranger browsing the catalogue has no business reading it. The
        instructor additionally sees pending requests, since acting on them is their job.
        """
        course = self.get_object()
        is_instructor = course.can_curate(request.user)
        mine = course.enrollments.filter(participant=request.user).first()
        if not is_instructor and (not mine or mine.status not in ACTIVE_ENROLLMENT_STATUSES):
            return Response(status=status.HTTP_403_FORBIDDEN)

        statuses = BLOCKING_ENROLLMENT_STATUSES if is_instructor else ACTIVE_ENROLLMENT_STATUSES
        rows = course.enrollments.filter(status__in=statuses).select_related(
            'participant', 'participant__profile'
        )
        return Response(EnrollmentSerializer(rows, many=True).data)

    @action(
        detail=True,
        methods=['post'],
        url_path='enrollments/(?P<enrollment_id>[^/.]+)',
        permission_classes=[permissions.IsAuthenticated, _CoursesFeatureGate],
    )
    def decide(self, request, pk=None, enrollment_id=None):
        """The instructor approving, declining or removing somebody."""
        course = self.get_object()
        if not course.can_curate(request.user):
            return Response(status=status.HTTP_404_NOT_FOUND)
        enrollment = course.enrollments.filter(pk=enrollment_id).first()
        if not enrollment:
            return Response(status=status.HTTP_404_NOT_FOUND)

        decision = request.data.get('decision')
        if decision not in {'approve', 'decline', 'remove'}:
            return Response(
                {'detail': 'decision must be approve, decline or remove.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if decision == 'approve':
            if course.is_full:
                return Response({'detail': 'full'}, status=status.HTTP_400_BAD_REQUEST)
            enrollment.status = 'active'
        elif decision == 'decline':
            enrollment.status = 'declined'
        else:
            enrollment.status = 'removed'
        enrollment.decided_at = timezone.now()
        enrollment.save()
        # Every one of these is somebody's answer to a question they asked, so all three are worth
        # telling them about — including being removed, which is the one they would otherwise
        # discover by finding the course gone.
        notify(
            enrollment.participant,
            {
                'approve': 'course_enrollment_approved',
                'decline': 'course_enrollment_declined',
                'remove': 'course_removed',
            }[decision],
            actor=request.user,
            target_label=course.title,
            course=course,
        )
        return Response(EnrollmentSerializer(enrollment).data)

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated, _CoursesFeatureGate])
    def mute(self, request, pk=None):
        """Stay in the course, stop hearing about it — `Enrollment.notify`.

        Its own endpoint rather than a field on the enrolment write path, because there is no other
        enrolment write path: a participant does not otherwise edit their own membership.
        """
        course = self.get_object()
        enrollment = course.enrollments.filter(participant=request.user).first()
        if not enrollment or enrollment.status not in ACTIVE_ENROLLMENT_STATUSES:
            return Response({'detail': 'not_enrolled'}, status=status.HTTP_400_BAD_REQUEST)
        enrollment.notify = bool(request.data.get('notify', False))
        enrollment.save(update_fields=['notify'])
        return Response(EnrollmentSerializer(enrollment).data)

    # --- discussion ---------------------------------------------------------------------------

    @action(
        detail=True,
        methods=['get', 'post'],
        permission_classes=[permissions.IsAuthenticatedOrReadOnly, _CoursesFeatureGate],
    )
    def comments(self, request, pk=None):
        """The course discussion — the same generic `Comment` (content_type/object_id) that
        Exercise, Material and Service threads already use, not a bespoke one built for this.

        Reading and posting are two different questions: `discussion_mode` decides who may READ,
        while posting is always restricted to the people actually in the course. "Anyone may read"
        is a reasonable thing for an instructor to want; "anyone may post into my course" is not.
        """
        course = self.get_object()
        content_type = ContentType.objects.get_for_model(Course)

        if request.method == 'GET':
            if not course.discussion_visible_to(request.user):
                return Response(status=status.HTTP_403_FORBIDDEN)
            qs = Comment.objects.filter(content_type=content_type, object_id=course.pk)
            return Response(CommentSerializer(qs, many=True).data)

        if not course.discussion_writable_by(request.user):
            return Response(status=status.HTTP_403_FORBIDDEN)

        serializer = CommentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        # The same cross-target check every other `comments` action here applies: a client-supplied
        # parent genuinely threads, but nothing should let it name a comment from another thread.
        parent = serializer.validated_data.get('parent')
        if parent is not None and (
            parent.content_type_id != content_type.id or parent.object_id != course.pk
        ):
            return Response(
                {'parent': ['This reply must belong to the same discussion.']},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer.save(content_type=content_type, object_id=course.pk, author=request.user)

        if course.announce_new_posts:
            notify_course_participants(
                course,
                'course_new_post',
                actor=request.user,
                note=serializer.instance.body[:200],
                # The instructor is not on the roster but is unquestionably in the conversation.
                include_instructor=True,
            )
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    # --- lessons --------------------------------------------------------------------------------

    @action(detail=True, methods=['get', 'post'], permission_classes=[permissions.IsAuthenticatedOrReadOnly, _CoursesFeatureGate])
    def lessons(self, request, pk=None):
        course = self.get_object()
        if request.method == 'GET':
            mine = (
                course.enrollments.filter(participant=request.user).first()
                if request.user.is_authenticated
                else None
            )
            is_participant = bool(
                course.is_staff_member(request.user)
                or (mine and mine.status in ACTIVE_ENROLLMENT_STATUSES)
            )
            return Response(
                LessonSerializer(
                    course.lessons.all(), many=True, context={'is_participant': is_participant}
                ).data
            )

        if not course.can_curate(request.user):
            return Response(status=status.HTTP_404_NOT_FOUND)
        write = LessonWriteSerializer(data=request.data)
        write.is_valid(raise_exception=True)
        lesson = write.save(course=course)
        if course.announce_new_lessons:
            notify_course_participants(
                course, 'course_new_lesson', actor=request.user, note=lesson.title
            )
        return Response(
            LessonSerializer(lesson, context={'is_participant': True}).data,
            status=status.HTTP_201_CREATED,
        )

    @action(
        detail=True,
        methods=['patch', 'delete'],
        url_path='lessons/(?P<lesson_id>[^/.]+)',
        permission_classes=[permissions.IsAuthenticated, _CoursesFeatureGate],
    )
    def lesson_detail(self, request, pk=None, lesson_id=None):
        course = self.get_object()
        if not course.can_curate(request.user):
            return Response(status=status.HTTP_404_NOT_FOUND)
        lesson = course.lessons.filter(pk=lesson_id).first()
        if not lesson:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if request.method == 'DELETE':
            lesson.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        write = LessonWriteSerializer(lesson, data=request.data, partial=True)
        write.is_valid(raise_exception=True)
        write.save()
        return Response(LessonSerializer(lesson, context={'is_participant': True}).data)

    # --- staff ------------------------------------------------------------------------------------

    @action(detail=True, methods=['get', 'post'], permission_classes=[permissions.IsAuthenticated, _CoursesFeatureGate])
    def staff(self, request, pk=None):
        """Who runs this course, and adding somebody to that list.

        Readable by any member of staff and by active participants — knowing who is teaching you is
        not privileged information, and a participant needs it to know who to ask.
        """
        course = self.get_object()
        if request.method == 'GET':
            if not course.is_member(request.user):
                return Response(status=status.HTTP_403_FORBIDDEN)
            rows = course.staff.select_related('user', 'user__profile')
            return Response(CourseStaffSerializer(rows, many=True).data)

        if not course.can_administer(request.user):
            return Response(status=status.HTTP_404_NOT_FOUND)

        role = request.data.get('role', 'assistant')
        if role not in {'admin', 'assistant'}:
            # Not 'owner': a course has exactly one, and handing it over is a transfer rather than an
            # addition — a separate decision that this endpoint deliberately cannot make by accident.
            return Response(
                {'detail': 'role must be admin or assistant.'}, status=status.HTTP_400_BAD_REQUEST
            )

        user_id = request.data.get('user_id')
        target = get_user_model().objects.filter(pk=user_id).first()
        if not target:
            return Response({'detail': 'no_such_user'}, status=status.HTTP_400_BAD_REQUEST)
        if course.staff.filter(user=target).exists():
            return Response({'detail': 'already_staff'}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            row = CourseStaff.objects.create(
                course=course, user=target, role=role, added_by=request.user
            )
            # Somebody running a course does not also occupy a participant seat — the same rule
            # `enrollment_block_reason` states. Promoting an existing participant therefore retires
            # their enrolment rather than leaving them counted twice against capacity.
            course.enrollments.filter(
                participant=target, status__in=ACTIVE_ENROLLMENT_STATUSES
            ).update(status='left', decided_at=timezone.now())

        notify(
            target,
            'course_staff_added',
            actor=request.user,
            target_label=course.title,
            course=course,
        )
        return Response(CourseStaffSerializer(row).data, status=status.HTTP_201_CREATED)

    @action(
        detail=True,
        methods=['patch', 'delete'],
        url_path='staff/(?P<staff_id>[^/.]+)',
        permission_classes=[permissions.IsAuthenticated, _CoursesFeatureGate],
    )
    def staff_detail(self, request, pk=None, staff_id=None):
        course = self.get_object()
        if not course.can_administer(request.user):
            return Response(status=status.HTTP_404_NOT_FOUND)
        row = course.staff.filter(pk=staff_id).first()
        if not row:
            return Response(status=status.HTTP_404_NOT_FOUND)
        # The owner is the one person who cannot be demoted or removed. Without this a course could
        # be left with nobody able to delete it or grant roles back — an unrecoverable state, and
        # exactly the one an angry co-admin would reach for.
        if row.role == 'owner':
            return Response({'detail': 'owner_immutable'}, status=status.HTTP_400_BAD_REQUEST)

        if request.method == 'DELETE':
            row.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        role = request.data.get('role')
        if role not in {'admin', 'assistant'}:
            return Response(
                {'detail': 'role must be admin or assistant.'}, status=status.HTTP_400_BAD_REQUEST
            )
        row.role = role
        row.save(update_fields=['role'])
        return Response(CourseStaffSerializer(row).data)

    # --- chapters ---------------------------------------------------------------------------------

    @action(detail=True, methods=['get', 'post'], permission_classes=[permissions.IsAuthenticatedOrReadOnly, _CoursesFeatureGate])
    def chapters(self, request, pk=None):
        course = self.get_object()
        if request.method == 'GET':
            return Response(
                ChapterSerializer(
                    course.chapters.all(), many=True, context=self.get_serializer_context()
                ).data
            )
        if not course.can_curate(request.user):
            return Response(status=status.HTTP_404_NOT_FOUND)
        write = ChapterWriteSerializer(data=request.data)
        write.is_valid(raise_exception=True)
        chapter = write.save(course=course)
        return Response(
            ChapterSerializer(chapter, context=self.get_serializer_context()).data,
            status=status.HTTP_201_CREATED,
        )

    @action(
        detail=True,
        methods=['patch', 'delete'],
        url_path='chapters/(?P<chapter_id>[^/.]+)',
        permission_classes=[permissions.IsAuthenticated, _CoursesFeatureGate],
    )
    def chapter_detail(self, request, pk=None, chapter_id=None):
        course = self.get_object()
        if not course.can_curate(request.user):
            return Response(status=status.HTTP_404_NOT_FOUND)
        chapter = course.chapters.filter(pk=chapter_id).first()
        if not chapter:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if request.method == 'DELETE':
            # Its items survive, unfiled. Deleting a chapter is a statement about the grouping, not
            # about the content somebody put in it — which is also why `CourseItem.chapter` is
            # SET_NULL rather than CASCADE.
            chapter.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        write = ChapterWriteSerializer(chapter, data=request.data, partial=True)
        write.is_valid(raise_exception=True)
        write.save()
        return Response(ChapterSerializer(chapter, context=self.get_serializer_context()).data)

    # --- content, and contributions to it ----------------------------------------------------------

    @action(detail=True, methods=['get', 'post'], permission_classes=[permissions.IsAuthenticatedOrReadOnly, _CoursesFeatureGate])
    def items(self, request, pk=None):
        """The course's materials and exercises, and offering one.

        GET is filtered per viewer by `CourseItem.is_visible_to`, so a pending submission is visible
        to staff and to whoever submitted it, and a locked chapter's contents to staff alone.
        """
        course = self.get_object()
        if request.method == 'GET':
            visible = [i for i in course.items.all() if i.is_visible_to(request.user)]
            return Response(
                CourseItemSerializer(
                    visible, many=True, context=self.get_serializer_context()
                ).data
            )

        if not course.can_contribute(request.user):
            # Two genuinely different refusals, and the person deserves to know which: the course is
            # closed to contributions at all, or it is open but only to the people in it.
            reason = (
                'contributions_closed'
                if course.contribution_policy == 'staff'
                else 'not_a_participant'
            )
            return Response({'detail': reason}, status=status.HTTP_403_FORBIDDEN)

        write = CourseItemWriteSerializer(
            data=request.data, context={**self.get_serializer_context(), 'course': course}
        )
        write.is_valid(raise_exception=True)

        # An administrator can cap the total bytes of material one course holds
        # (`Course.upload_quota_bytes`, 0 being uncapped). Checked against the file this
        # request would actually add, so a course sitting just under its quota still refuses a file
        # that would take it over rather than accepting it and going over silently.
        #
        # Exercises are never weighed: they are rows of text, not stored files, and the quota exists
        # to bound disk.
        if course.upload_quota_bytes:
            incoming = write.validated_data.get('material')
            incoming_file = getattr(incoming, 'file', None)
            incoming_size = 0
            if incoming_file:
                try:
                    incoming_size = incoming_file.size
                except (OSError, ValueError):
                    incoming_size = 0
            if incoming_size and course.uploaded_bytes + incoming_size > course.upload_quota_bytes:
                return Response(
                    {'detail': 'upload_quota_exceeded'}, status=status.HTTP_400_BAD_REQUEST
                )

        needs_approval = course.contribution_needs_approval(request.user)
        try:
            with transaction.atomic():
                item = write.save(
                    course=course,
                    submitted_by=request.user,
                    status='pending' if needs_approval else 'approved',
                )
        except IntegrityError:
            # The unique constraints per course, surfaced as a plain answer rather than a 500.
            return Response({'detail': 'already_in_course'}, status=status.HTTP_400_BAD_REQUEST)

        if needs_approval:
            # Everybody who could act on it, rather than the owner alone — a queue that only notifies
            # one person is a queue that stalls whenever that person is away.
            for row in course.staff.all():
                notify(
                    row.user,
                    'course_contribution_submitted',
                    actor=request.user,
                    target_label=course.title,
                    course=course,
                )
        return Response(
            CourseItemSerializer(item, context=self.get_serializer_context()).data,
            status=status.HTTP_201_CREATED,
        )

    @action(
        detail=True,
        methods=['patch', 'delete'],
        url_path='items/(?P<item_id>[^/.]+)',
        permission_classes=[permissions.IsAuthenticated, _CoursesFeatureGate],
    )
    def item_detail(self, request, pk=None, item_id=None):
        """Approving, rejecting, filing or removing one piece of content."""
        course = self.get_object()
        item = course.items.filter(pk=item_id).first()
        if not item:
            return Response(status=status.HTTP_404_NOT_FOUND)

        is_curator = course.can_curate(request.user)
        # Somebody may always withdraw their own submission, whatever the policy — it was theirs to
        # offer, so it stays theirs to retract. Once approved it is part of the course, and taking it
        # back out is a curator's decision.
        may_withdraw = (
            item.submitted_by_id == request.user.pk and item.status == 'pending'
        )
        if not is_curator and not may_withdraw:
            return Response(status=status.HTTP_404_NOT_FOUND)

        if request.method == 'DELETE':
            item.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        if not is_curator:
            return Response(status=status.HTTP_404_NOT_FOUND)

        decision = request.data.get('decision')
        if decision in {'approve', 'reject'}:
            item.status = 'approved' if decision == 'approve' else 'rejected'
            item.decided_by = request.user
            item.decided_at = timezone.now()
            item.decision_note = str(request.data.get('decision_note', ''))[:500]
            item.save(
                update_fields=['status', 'decided_by', 'decided_at', 'decision_note']
            )
            if item.submitted_by_id and item.submitted_by_id != request.user.pk:
                notify(
                    item.submitted_by,
                    'course_contribution_approved'
                    if decision == 'approve'
                    else 'course_contribution_rejected',
                    actor=request.user,
                    target_label=course.title,
                    course=course,
                )
            return Response(
                CourseItemSerializer(item, context=self.get_serializer_context()).data
            )

        # Anything else is a plain edit — filing it into a chapter, reordering, retitling the note.
        write = CourseItemWriteSerializer(
            item,
            data=request.data,
            partial=True,
            context={**self.get_serializer_context(), 'course': course},
        )
        write.is_valid(raise_exception=True)
        write.save()
        return Response(CourseItemSerializer(item, context=self.get_serializer_context()).data)

    # --- invite links -----------------------------------------------------------------------------

    @action(detail=True, methods=['get', 'post'], permission_classes=[permissions.IsAuthenticated, _CoursesFeatureGate])
    def invites(self, request, pk=None):
        course = self.get_object()
        if not course.can_administer(request.user):
            return Response(status=status.HTTP_404_NOT_FOUND)
        if request.method == 'GET':
            return Response(
                CourseInviteSerializer(
                    course.invites.select_related('created_by', 'created_by__profile'), many=True
                ).data
            )
        write = CourseInviteWriteSerializer(data=request.data)
        write.is_valid(raise_exception=True)
        invite = write.save(
            course=course, created_by=request.user, token=CourseInvite.new_token()
        )
        return Response(CourseInviteSerializer(invite).data, status=status.HTTP_201_CREATED)

    @action(
        detail=True,
        methods=['delete'],
        url_path='invites/(?P<invite_id>[^/.]+)',
        permission_classes=[permissions.IsAuthenticated, _CoursesFeatureGate],
    )
    def invite_detail(self, request, pk=None, invite_id=None):
        """Revoking a link. A timestamp rather than a delete, so the row keeps its use count and the
        record of who killed it."""
        course = self.get_object()
        if not course.can_administer(request.user):
            return Response(status=status.HTTP_404_NOT_FOUND)
        invite = course.invites.filter(pk=invite_id).first()
        if not invite:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if not invite.revoked_at:
            invite.revoked_at = timezone.now()
            invite.save(update_fields=['revoked_at'])
        return Response(CourseInviteSerializer(invite).data)


# --- following an invite link ---------------------------------------------------------------------
# Two plain function views rather than actions on the viewset, because somebody holding a link knows
# the token and nothing else — there is no course id to route by, which is the entire point of an
# invite. The token IS the authorisation, so these are addressed by it directly.


def _invite_or_none(token: str) -> CourseInvite | None:
    return (
        CourseInvite.objects.select_related('course', 'course__instructor')
        .filter(token=token)
        .first()
    )


@api_view(['GET'])
@permission_classes([permissions.AllowAny])
def invite_preview(request, token=None):
    """What the link says before you act on it — deliberately readable while logged out.

    Somebody sent a link to a person who may not have an account yet, and telling them to sign up
    first without saying what for is how an invite gets ignored. A dead link answers 404 rather than
    describing a course to somebody who cannot join it.
    """
    invite = _invite_or_none(token or '')
    if not invite:
        return Response(status=status.HTTP_404_NOT_FOUND)
    course = invite.course
    profile = getattr(course.instructor, 'profile', None)
    return Response(
        InvitePreviewSerializer(
            {
                'course_id': course.pk,
                'course_title': course.title,
                'instructor_name': (
                    profile.display_name
                    if profile and profile.display_name
                    else course.instructor.username
                ),
                'role': invite.role,
                'is_usable': invite.is_usable,
                'unusable_reason': invite.unusable_reason(),
            }
        ).data
    )


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def invite_accept(request, token=None):
    """Following the link, for real.

    An invite bypasses `enrollment_policy` — the person who sent it has already made that decision,
    and parking an invited guest in an approval queue would make the link pointless. It does NOT
    bypass `capacity`: a full course is full, and quietly seating somebody over the limit would break
    the promise the limit makes to everybody already in.
    """
    invite = _invite_or_none(token or '')
    if not invite:
        return Response(status=status.HTTP_404_NOT_FOUND)
    reason = invite.unusable_reason()
    if reason:
        return Response({'detail': reason}, status=status.HTTP_400_BAD_REQUEST)

    course = invite.course
    user = request.user

    # Already running it: nothing to do, and silently demoting an admin to a participant because
    # they clicked their own link would be a genuinely destructive no-op.
    if course.is_staff_member(user):
        return Response({'detail': 'already_staff', 'course_id': course.pk})

    with transaction.atomic():
        # Re-read inside the transaction and lock it, so two people following the last remaining use
        # of a link at the same time cannot both succeed.
        locked = CourseInvite.objects.select_for_update().get(pk=invite.pk)
        again = locked.unusable_reason()
        if again:
            return Response({'detail': again}, status=status.HTTP_400_BAD_REQUEST)

        if invite.role == 'participant':
            existing = course.enrollments.filter(participant=user).first()
            if existing and existing.status in ACTIVE_ENROLLMENT_STATUSES:
                return Response({'detail': 'already_enrolled', 'course_id': course.pk})
            if course.is_full:
                return Response({'detail': 'full'}, status=status.HTTP_400_BAD_REQUEST)
            if existing:
                existing.status = 'active'
                existing.decided_at = timezone.now()
                existing.save(update_fields=['status', 'decided_at'])
            else:
                Enrollment.objects.create(course=course, participant=user, status='active')
        else:
            CourseStaff.objects.create(
                course=course, user=user, role=invite.role, added_by=invite.created_by
            )
            # Same rule as promoting somebody by hand: staff do not also hold a participant seat.
            course.enrollments.filter(
                participant=user, status__in=ACTIVE_ENROLLMENT_STATUSES
            ).update(status='left', decided_at=timezone.now())

        locked.uses = locked.uses + 1
        locked.save(update_fields=['uses'])

    if invite.created_by_id:
        notify(
            invite.created_by,
            'course_invite_used',
            actor=user,
            target_label=course.title,
            course=course,
        )
    return Response({'detail': 'joined', 'course_id': course.pk, 'role': invite.role})
