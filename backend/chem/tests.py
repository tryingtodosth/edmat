"""Chemistry drawings (root CLAUDE.md §17AV): a Ketcher SVG is sanitized and kept as vector, a
PNG is re-encoded to WebP and bounded, a script inside an SVG does not survive, the source must
be the shape its format claims, only the author replaces a drawing, reads are public,
the kill switch closes the API, the sanitizer keeps `data-chem` on an embedded picture, and a
drawing inside a minor-band comment is held for a moderator."""

import base64
import io
import shutil
import tempfile

from django.test import override_settings
from django.urls import reverse
from PIL import Image
from rest_framework.test import APIClient, APITestCase

from accounts.minors import HOLD_REASON
from chem.models import ChemDrawing
from chem.svg import sanitize_svg
from community.models import Comment
from config.sanitize import sanitize_content
from moderation.models import FeatureFlag, Report
from telemetry.routers import all_log_shards
from testing.factories import make_branch, make_exercise, make_user

SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
    'width="200" height="100" viewBox="0 0 200 100">'
    '<defs><linearGradient id="g"><stop offset="0" stop-color="#000"/></linearGradient></defs>'
    '<g transform="translate(1,1)"><path d="M0 0L10 10" stroke="#000" fill="url(#g)"/>'
    '<text x="5" y="5" font-family="Arial" font-size="12">OH</text>'
    '<script>alert(1)</script>'
    '<a xlink:href="https://evil.example"><circle cx="1" cy="1" r="1" onclick="alert(1)"/></a>'
    '<image href="https://evil.example/pixel.png"/>'
    '<foreignObject><body xmlns="http://www.w3.org/1999/xhtml">x</body></foreignObject>'
    '<rect x="0" y="0" width="2" height="2" style="fill:red;background:url(https://evil.example)"/>'
    '</g></svg>'
)
KET = '{"root": {"nodes": [{"$ref": "mol0"}]}, "mol0": {"type": "molecule", "atoms": [{"label": "C", "location": [0, 0, 0]}], "bonds": []}}'
MOL = '\n  Ketcher\n\n  1  0  0  0  0  0  0  0  0  0999 V2000\n    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0\nM  END\n'
# A reaction in KET: two molecules and an arrow node between them — what Ketcher writes for
# `CCO>>C=C`, reduced to the shape the server checks.
KET_REACTION = (
    '{"root": {"nodes": [{"$ref": "mol0"}, {"$ref": "mol1"}, {"type": "arrow", "data": {"mode": "open-angle",'
    ' "pos": [{"x": 3, "y": 0, "z": 0}, {"x": 5, "y": 0, "z": 0}]}}]},'
    ' "mol0": {"type": "molecule", "atoms": [{"label": "C", "location": [0, 0, 0]}], "bonds": []},'
    ' "mol1": {"type": "molecule", "atoms": [{"label": "C", "location": [7, 0, 0]}], "bonds": []}}'
)
RXN = '$RXN\n\n  Ketcher\n\n  1  1\n$MOL\n' + MOL + '$MOL\n' + MOL


def png_data_url(w=2400, h=1200):
    buf = io.BytesIO()
    Image.new('RGB', (w, h), (255, 255, 255)).save(buf, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()


def as_(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


class ChemCase(APITestCase):
    """Its own temporary MEDIA_ROOT per class — the arrangement `events/tests.py` and
    `accounts/test_avatar.py` use — so a test run never leaves pictures under `media/chem/`
    (the first run of this suite left 74 of them in the dev checkout's media directory)."""

    databases = set(all_log_shards()) | {'default'}

    @classmethod
    def setUpClass(cls):
        cls._media_root = tempfile.mkdtemp(prefix='edmat-chem-test-')
        cls._override = override_settings(MEDIA_ROOT=cls._media_root)
        cls._override.enable()
        super().setUpClass()

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        cls._override.disable()
        shutil.rmtree(cls._media_root, ignore_errors=True)

    def setUp(self):
        self.author = make_user('chem-author')
        self.other = make_user('chem-other')
        self.url = reverse('chem-drawing-list')

    def post(self, client, **over):
        payload = {'source_format': 'ket', 'source': KET, 'label': 'methane', 'image': SVG}
        payload.update(over)
        return client.post(self.url, payload, format='json')


class SvgSanitizerTests(ChemCase):
    def test_geometry_survives_and_scripts_links_images_do_not(self):
        clean = sanitize_svg(SVG)
        self.assertIn('<path', clean)
        self.assertIn('OH', clean)
        self.assertIn('linearGradient', clean)
        self.assertIn('fill="url(#g)"', clean)
        for bad in ('<script', 'alert', 'evil.example', '<a', '<image', 'foreignObject', 'onclick', 'background:url'):
            self.assertNotIn(bad, clean, bad)
        # The circle inside the dropped <a> goes with it — nothing is hoisted out of a refused
        # element, so the rebuilt tree is only what was explicitly copied.
        self.assertNotIn('<circle', clean)

    def test_a_doctype_or_entity_is_refused(self):
        with self.assertRaises(Exception):
            sanitize_svg('<!DOCTYPE svg [<!ENTITY a "aaaa">]><svg xmlns="http://www.w3.org/2000/svg">&a;</svg>')

    def test_not_an_svg_is_refused(self):
        with self.assertRaises(Exception):
            sanitize_svg('<html><body>hi</body></html>')


class CreateTests(ChemCase):
    def test_a_ketcher_svg_is_stored_sanitized_as_vector(self):
        r = self.post(as_(self.author))
        self.assertEqual(r.status_code, 201, r.content)
        body = r.json()
        self.assertEqual(body['image_kind'], 'svg')
        self.assertEqual((body['width'], body['height']), (200, 100))
        self.assertIn('data-chem="%d"' % body['id'], body['embed_html'])
        self.assertIn('alt="methane"', body['embed_html'])
        row = ChemDrawing.objects.get(pk=body['id'])
        self.assertTrue(row.image.name.endswith('.svg'))
        stored = row.image.read().decode()
        self.assertNotIn('<script', stored)
        self.assertIn('<path', stored)

    def test_a_png_is_re_encoded_and_bounded(self):
        r = self.post(as_(self.author), image=png_data_url())
        self.assertEqual(r.status_code, 201, r.content)
        body = r.json()
        self.assertEqual(body['image_kind'], 'raster')
        row = ChemDrawing.objects.get(pk=body['id'])
        self.assertTrue(row.image.name.endswith('.webp'))
        self.assertEqual(Image.open(row.image.path).size, (1600, 800))
        self.assertEqual((body['width'], body['height']), (1600, 800))

    def test_reactions_round_trip_in_every_format(self):
        # A reaction is a drawing like any other: KET with an arrow node and a reaction SMILES
        # caption, or an RXN file under the Molfile format — neither is a special case the server
        # has to know about beyond accepting the RXN header.
        r = self.post(as_(self.author), source=KET_REACTION, label='CCO>>C=C')
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(ChemDrawing.objects.get(pk=r.json()['id']).label, 'CCO>>C=C')
        self.assertIn('alt="CCO&gt;&gt;C=C"', r.json()['embed_html'].replace('>>', '&gt;&gt;'))
        r = self.post(as_(self.author), source_format='mol', source=RXN)
        self.assertEqual(r.status_code, 201, r.content)

    def test_a_molfile_is_accepted_for_ketcher(self):
        r = self.post(as_(self.author), source_format='mol', source=MOL)
        self.assertEqual(r.status_code, 201, r.content)

    def test_the_source_must_parse_as_its_format(self):
        self.assertEqual(self.post(as_(self.author), source_format='cdjson').status_code, 400)
        self.assertEqual(self.post(as_(self.author), source='not json').status_code, 400)
        self.assertEqual(self.post(as_(self.author), source='{"nope": 1}').status_code, 400)
        self.assertEqual(self.post(as_(self.author), source_format='mol', source='hello').status_code, 400)

    def test_a_picture_that_is_neither_svg_nor_data_url_is_refused(self):
        self.assertEqual(self.post(as_(self.author), image='https://x.example/a.png').status_code, 400)
        self.assertEqual(self.post(as_(self.author), image='data:image/png;base64,!!!').status_code, 400)
        self.assertEqual(self.post(as_(self.author), image='data:image/png;base64,' + base64.b64encode(b'MZ\x90\x00garbage').decode()).status_code, 400)

    def test_anonymous_cannot_create_but_anyone_can_read(self):
        self.assertEqual(self.post(APIClient()).status_code, 401)
        pk = self.post(as_(self.author)).json()['id']
        r = APIClient().get(reverse('chem-drawing-detail', args=[pk]))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['source_format'], 'ket')
        self.assertNotIn('tool', r.json())

    def test_my_drawings_lists_only_mine(self):
        self.post(as_(self.author))
        self.post(as_(self.other))
        r = as_(self.author).get(self.url)
        self.assertEqual(len(r.json()), 1)
        self.assertEqual(APIClient().get(self.url).status_code, 401)


class ReplaceTests(ChemCase):
    def test_only_the_author_replaces_and_the_old_file_goes(self):
        pk = self.post(as_(self.author)).json()['id']
        row = ChemDrawing.objects.get(pk=pk)
        old_path = row.image.path
        payload = {'source_format': 'mol', 'source': MOL, 'image': SVG.replace('OH', 'NH2')}
        self.assertEqual(as_(self.other).put(reverse('chem-drawing-detail', args=[pk]), payload, format='json').status_code, 403)
        r = as_(self.author).put(reverse('chem-drawing-detail', args=[pk]), payload, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        row.refresh_from_db()
        self.assertEqual(row.source_format, 'mol')
        self.assertNotEqual(row.image.path, old_path)
        import os

        self.assertFalse(os.path.exists(old_path))
        self.assertIn('NH2', row.image.read().decode())

    def test_there_is_no_delete(self):
        pk = self.post(as_(self.author)).json()['id']
        self.assertEqual(as_(self.author).delete(reverse('chem-drawing-detail', args=[pk])).status_code, 405)


class KillSwitchTests(ChemCase):
    def test_off_closes_the_api_for_everybody_but_staff(self):
        FeatureFlag.objects.update_or_create(key='chemistry', defaults={'is_enabled': False})
        self.assertEqual(self.post(as_(self.author)).status_code, 403)
        staff = make_user('chem-staff', is_staff=True)
        self.assertEqual(self.post(as_(staff)).status_code, 201)


class EmbeddingTests(ChemCase):
    def test_the_content_sanitizer_keeps_data_chem_on_a_site_media_picture(self):
        html = '<p>see <img src="/media/chem/abc.svg" alt="methane" data-chem="7" class="chem-drawing" onerror="x()"></p>'
        clean = sanitize_content(html)
        self.assertIn('data-chem="7"', clean)
        self.assertIn('class="chem-drawing"', clean)
        self.assertIn('src="/media/chem/abc.svg"', clean)
        self.assertNotIn('onerror', clean)
        # A hot-linked picture still loses its src, data-chem or not.
        self.assertNotIn('evil', sanitize_content('<img src="https://evil.example/a.svg" data-chem="7">'))

    def test_a_drawing_inside_a_minor_band_comment_is_held(self):
        branch = make_branch(slug='chem-branch')
        exercise = make_exercise(branch, 1)
        exercise.audience = 'primary'
        exercise.save()
        body = 'water is <img src="/media/chem/a.webp" data-chem="1">'
        r = as_(self.author).post(reverse('exercise-comments', args=[exercise.pk]), {'body': body}, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        comment = Comment.objects.get(pk=r.json()['id'])
        self.assertIsNotNone(comment.auto_hidden_at)
        self.assertTrue(Report.objects.filter(object_id=comment.pk, reason=HOLD_REASON).exists())
        # The same comment on a university thread is not.
        exercise.audience = 'university'
        exercise.save()
        r = as_(self.author).post(reverse('exercise-comments', args=[exercise.pk]), {'body': body}, format='json')
        self.assertIsNone(Comment.objects.get(pk=r.json()['id']).auto_hidden_at)
