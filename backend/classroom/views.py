"""Courses run by users — public discovery, instructor-owned writes, and enrolment.

The permission split is the one this app already uses everywhere else (`ServiceViewSet`,
`ExerciseSetViewSet`): anyone may read what is published, only the owner may change it, and scoping
is done in the queryset rather than by after-the-fact checks — so somebody poking at another
instructor's draft gets a 404, which is also the honest answer, since for them it does not exist.
"""

from django.contrib.contenttypes.models import ContentType
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from community.models import Comment
from community.serializers import CommentSerializer
from moderation.permissions import feature_gate
from notifications.services import notify, notify_course_participants

from .models import (
    ACTIVE_ENROLLMENT_STATUSES,
    BLOCKING_ENROLLMENT_STATUSES,
    PUBLIC_STATUSES,
    Enrollment,
    Lesson,
    TaughtCourse,
)
from .serializers import (
    EnrollmentSerializer,
    LessonSerializer,
    LessonWriteSerializer,
    TaughtCourseSerializer,
    TaughtCourseWriteSerializer,
)

_ClassroomFeatureGate = feature_gate('classroom')


class TaughtCourseViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticatedOrReadOnly, _ClassroomFeatureGate]

    def get_queryset(self):
        user = self.request.user
        qs = (
            TaughtCourse.objects.select_related('instructor', 'instructor__profile', 'field')
            .prefetch_related('subjects', 'lessons', 'enrollments')
            .all()
        )

        if self.request.query_params.get('mine') == 'teaching':
            if not user.is_authenticated:
                return qs.none()
            return qs.filter(instructor=user)

        if self.request.query_params.get('mine') == 'participating':
            if not user.is_authenticated:
                return qs.none()
            # Includes pending requests deliberately: "I asked to join and am waiting" is exactly
            # the thing a person opens this list to check.
            return qs.filter(
                enrollments__participant=user,
                enrollments__status__in=BLOCKING_ENROLLMENT_STATUSES,
            ).distinct()

        # A draft belongs to its instructor alone. Filtering rather than permission-checking means
        # it is absent from every listing for free, not hidden by a rule each new endpoint would
        # have to remember.
        public = qs.filter(status__in=PUBLIC_STATUSES)
        if user.is_authenticated:
            public = public | qs.filter(instructor=user)
        qs = public.distinct()

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
            return TaughtCourseWriteSerializer
        return TaughtCourseSerializer

    def perform_create(self, serializer):
        serializer.save(instructor=self.request.user)

    def _owned(self):
        """The course, but only if the caller runs it. 404 rather than 403, matching this app's
        existing queryset-scoping convention."""
        course = self.get_object()
        if course.instructor_id != self.request.user.pk:
            return None
        return course

    def update(self, request, *args, **kwargs):
        if self.get_object().instructor_id != request.user.pk:
            return Response(status=status.HTTP_404_NOT_FOUND)
        response = super().update(request, *args, **kwargs)
        # Answer with the full read shape rather than the write one, so a client never has to
        # re-fetch just to refresh what it already had on screen.
        return Response(
            TaughtCourseSerializer(self.get_object(), context=self.get_serializer_context()).data,
            status=response.status_code,
        )

    def destroy(self, request, *args, **kwargs):
        if self.get_object().instructor_id != request.user.pk:
            return Response(status=status.HTTP_404_NOT_FOUND)
        return super().destroy(request, *args, **kwargs)

    def create(self, request, *args, **kwargs):
        write = self.get_serializer(data=request.data)
        write.is_valid(raise_exception=True)
        self.perform_create(write)
        return Response(
            TaughtCourseSerializer(write.instance, context=self.get_serializer_context()).data,
            status=status.HTTP_201_CREATED,
        )

    # --- enrolment ------------------------------------------------------------------------------

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated, _ClassroomFeatureGate])
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
                taught_course=course,
                note=note,
            )
        return Response(EnrollmentSerializer(enrollment).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated, _ClassroomFeatureGate])
    def leave(self, request, pk=None):
        course = self.get_object()
        enrollment = course.enrollments.filter(participant=request.user).first()
        if not enrollment or enrollment.status not in BLOCKING_ENROLLMENT_STATUSES:
            return Response({'detail': 'not_enrolled'}, status=status.HTTP_400_BAD_REQUEST)
        enrollment.status = 'left'
        enrollment.decided_at = timezone.now()
        enrollment.save()
        return Response(EnrollmentSerializer(enrollment).data)

    @action(detail=True, methods=['get'], permission_classes=[permissions.IsAuthenticated, _ClassroomFeatureGate])
    def participants(self, request, pk=None):
        """Who is in the room.

        Visible to the instructor and to active participants, and to nobody else: a course roster is
        a list of real people, and a stranger browsing the catalogue has no business reading it. The
        instructor additionally sees pending requests, since acting on them is their job.
        """
        course = self.get_object()
        is_instructor = course.instructor_id == request.user.pk
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
        permission_classes=[permissions.IsAuthenticated, _ClassroomFeatureGate],
    )
    def decide(self, request, pk=None, enrollment_id=None):
        """The instructor approving, declining or removing somebody."""
        course = self.get_object()
        if course.instructor_id != request.user.pk:
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
            taught_course=course,
        )
        return Response(EnrollmentSerializer(enrollment).data)

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated, _ClassroomFeatureGate])
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
        permission_classes=[permissions.IsAuthenticatedOrReadOnly, _ClassroomFeatureGate],
    )
    def comments(self, request, pk=None):
        """The course discussion — the same generic `Comment` (content_type/object_id) that
        Exercise, Material and Service threads already use, not a bespoke one built for this.

        Reading and posting are two different questions: `discussion_mode` decides who may READ,
        while posting is always restricted to the people actually in the course. "Anyone may read"
        is a reasonable thing for an instructor to want; "anyone may post into my course" is not.
        """
        course = self.get_object()
        content_type = ContentType.objects.get_for_model(TaughtCourse)

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

    @action(detail=True, methods=['get', 'post'], permission_classes=[permissions.IsAuthenticatedOrReadOnly, _ClassroomFeatureGate])
    def lessons(self, request, pk=None):
        course = self.get_object()
        if request.method == 'GET':
            mine = (
                course.enrollments.filter(participant=request.user).first()
                if request.user.is_authenticated
                else None
            )
            is_participant = bool(
                course.instructor_id == getattr(request.user, 'pk', None)
                or (mine and mine.status in ACTIVE_ENROLLMENT_STATUSES)
            )
            return Response(
                LessonSerializer(
                    course.lessons.all(), many=True, context={'is_participant': is_participant}
                ).data
            )

        if course.instructor_id != request.user.pk:
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
        permission_classes=[permissions.IsAuthenticated, _ClassroomFeatureGate],
    )
    def lesson_detail(self, request, pk=None, lesson_id=None):
        course = self.get_object()
        if course.instructor_id != request.user.pk:
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
