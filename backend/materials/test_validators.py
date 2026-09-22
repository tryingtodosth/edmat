"""`materials/validators.py` — the content-type sniff, the size cap and the honest scan outcome.

Moved here unchanged from `moderation/tests.py`'s `MaterialSubmissionValidatorTests` when
`MaterialSubmission` was folded into `coauthoring` and deleted: not one of these tests ever needed
that model, or any model at all. They call the validator directly, they are about `materials`, and
they belong beside the module they cover rather than in whichever app happened to own the first
endpoint that called it.

"exams, tests, etc. should be accepted... but also scanned and kept safe" — each real-content-type
case here was verified directly against `python-magic` before being trusted (see that module's own
doc comment), not assumed from the library's docs; these are the permanent regression form of that
same check.
"""

from django.test import SimpleTestCase


class MaterialFileValidatorTests(SimpleTestCase):
    """`SimpleTestCase` because nothing here touches the database — the validator reads bytes."""

    def test_a_real_pdf_is_accepted(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        from materials.validators import validate_material_submission_file

        f = SimpleUploadedFile('exam.pdf', b'%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF')
        validate_material_submission_file(f)  # must not raise

    def test_a_real_png_is_accepted(self):
        import base64

        from django.core.files.uploadedfile import SimpleUploadedFile

        from materials.validators import validate_material_submission_file

        png = base64.b64decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY'
            '42YAAAAASUVORK5CYII='
        )
        f = SimpleUploadedFile('scan.png', png)
        validate_material_submission_file(f)  # must not raise

    def test_a_real_tex_file_is_accepted(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        from materials.validators import validate_material_submission_file

        f = SimpleUploadedFile('notes.tex', rb'\documentclass{article}\begin{document}Hi\end{document}')
        validate_material_submission_file(f)  # must not raise

    def test_an_executable_disguised_as_a_pdf_is_rejected(self):
        from django.core.exceptions import ValidationError
        from django.core.files.uploadedfile import SimpleUploadedFile

        from materials.validators import validate_material_submission_file

        # A real Windows PE header ('MZ...'), padded well past the point python-magic needs to
        # positively identify it as an executable rather than falling back to a generic guess.
        f = SimpleUploadedFile(
            'totally_a_pdf.pdf',
            b'MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00' + b'A' * 200,
        )
        with self.assertRaises(ValidationError):
            validate_material_submission_file(f)

    def test_an_oversized_file_is_rejected(self):
        from django.core.exceptions import ValidationError
        from django.core.files.uploadedfile import SimpleUploadedFile

        from materials.validators import MAX_MATERIAL_SUBMISSION_SIZE_BYTES, validate_material_submission_file

        f = SimpleUploadedFile('huge.pdf', b'%PDF-1.4' + b'0' * (MAX_MATERIAL_SUBMISSION_SIZE_BYTES + 1))
        with self.assertRaises(ValidationError):
            validate_material_submission_file(f)

    def test_a_disallowed_extension_is_rejected(self):
        from django.core.exceptions import ValidationError
        from django.core.files.uploadedfile import SimpleUploadedFile

        from materials.validators import validate_material_submission_file

        f = SimpleUploadedFile('script.sh', b'#!/bin/bash\necho hi')
        with self.assertRaises(ValidationError):
            validate_material_submission_file(f)

    def test_scan_for_malware_gracefully_degrades_with_no_daemon_reachable(self):
        """This project's own sandboxed dev environment has no ClamAV daemon at all (confirmed: no
        clamscan/clamdscan/freshclam binary anywhere, no root access to install one) — the honest,
        common outcome here is `scanned=False`, never silently upgraded to "clean" without also
        checking that flag, which is exactly why `scan_for_malware` returns a real dataclass instead
        of a bare bool."""
        from django.core.files.uploadedfile import SimpleUploadedFile

        from materials.validators import scan_for_malware

        f = SimpleUploadedFile('exam.pdf', b'%PDF-1.4 some content')
        outcome = scan_for_malware(f)
        self.assertFalse(outcome.scanned)
        self.assertTrue(outcome.clean)  # "couldn't check" defaults to not-blocking, see MATERIAL_SCAN_REQUIRED
        self.assertTrue(outcome.detail)
