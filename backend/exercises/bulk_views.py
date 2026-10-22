"""`POST /api/exercise-imports/` — a person's bulk upload of exercise files (`exercises/bulk.py` is
the rule; this is only the door, root CLAUDE.md boundary 2), 2026-10-22.

`?mode=preview|commit` (in the query string, so the throttle and the size check are decided before
the body is parsed), multipart body: `files` (repeated — `.md` files, at most one `batch.yaml`),
`branch` (slug), `licence` (optional; the default for files that name none, `edmat-only` when
absent), `ai_assisted` (`true`/`false`, the author's mark for every file).

A body bigger than an upload may be is refused **413 before it is read** (`Content-Length`),
so a gigabyte never reaches Django's temporary files.

- `preview` → 200 with the report, always — a refused file is the answer, not an error.
- `commit` → 201 with the report and one row per created submission when every file is clean;
  **400 with the same report** when anything is refused (the files are re-validated, never taken
  from an earlier preview).
- Behind `exercise_submissions` AND `exercise_bulk_upload` (both `feature_gate`, staff bypass), and
  signed in. Two throttles of their own (`UserRateThrottle` with a scope — not `ScopedRateThrottle`,
  which counts nothing on a view without `throttle_scope`; `activity/views.py: TagCreateThrottle`
  says why): previews are cheap and many, commits are the write.
"""

from __future__ import annotations

from rest_framework import permissions, status
from rest_framework.exceptions import APIException
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView

from moderation.permissions import feature_gate

from .bulk import MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_BYTES, commit_upload, validate_upload

#: Multipart framing, the form fields and a batch.yaml on top of the files' own bytes.
_BODY_SLACK = 256 * 1024


class _BodyTooLarge(APIException):
    status_code = status.HTTP_413_REQUEST_ENTITY_TOO_LARGE
    default_detail = 'total_too_large'
    default_code = 'total_too_large'


class BulkPreviewThrottle(UserRateThrottle):
    scope = 'exercise_bulk_preview'


class BulkCommitThrottle(UserRateThrottle):
    scope = 'exercise_bulk_commit'


def _truthy(value) -> bool:
    return str(value or '').strip().lower() in ('1', 'true', 'yes', 'on')


class ExerciseImportView(APIView):
    permission_classes = [
        permissions.IsAuthenticated,
        feature_gate('exercise_submissions'),
        feature_gate('exercise_bulk_upload'),
    ]
    parser_classes = [MultiPartParser, FormParser]

    def get_throttles(self):
        mode = self.request.query_params.get('mode')
        return [BulkCommitThrottle()] if mode == 'commit' else [BulkPreviewThrottle()]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        try:
            length = int(request.META.get('CONTENT_LENGTH') or 0)
        except ValueError:
            length = 0
        if length > MAX_TOTAL_BYTES + _BODY_SLACK:
            raise _BodyTooLarge()

    def post(self, request):
        mode = request.query_params.get('mode') or 'preview'
        if mode not in ('preview', 'commit'):
            return Response({'mode': ["Must be 'preview' or 'commit'."]}, status=status.HTTP_400_BAD_REQUEST)
        uploads = request.FILES.getlist('files')
        # Read each file at most one byte past the per-file cap: the report needs to know a file is
        # too big, not to hold all of it.
        files = []
        for upload in uploads[: MAX_FILES + 2]:
            files.append((upload.name, upload.read(MAX_FILE_BYTES + 1)))
        if len(uploads) > MAX_FILES + 2:
            files.extend((u.name, b'') for u in uploads[MAX_FILES + 2:])

        report = validate_upload(
            request.user,
            str(request.data.get('branch') or ''),
            files,
            licence=str(request.data.get('licence') or ''),
            ai_assisted=_truthy(request.data.get('ai_assisted')),
        )
        body = report.as_dict()
        if mode == 'preview':
            return Response(body)
        if not report.ok:
            return Response(body, status=status.HTTP_400_BAD_REQUEST)
        body['created'] = commit_upload(request.user, report)
        body['batch'] = report.batch_id
        return Response(body, status=status.HTTP_201_CREATED)
