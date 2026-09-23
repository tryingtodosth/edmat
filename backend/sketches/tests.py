"""Freehand whiteboard sketches: the scene JSON must be the shape its editor writes and must stay
under the cap, the picture is never the bytes that arrived (a PE named `.png` is refused and a real
PNG comes back as WebP at the declared size), only the author replaces a sketch, reads are public,
the kill switch closes the API for everybody but staff, and the content sanitizer keeps
`data-sketch` on an embedded picture while dropping a data attribute nobody allowed."""

import base64
import io
import os
import shutil
import tempfile

from django.test import override_settings
from django.urls import reverse
from PIL import Image
from rest_framework.test import APIClient, APITestCase

from config.sanitize import sanitize_content
from moderation.models import FeatureFlag
from sketches.models import MAX_SOURCE_BYTES, Sketch
from telemetry.routers import all_log_shards
from testing.factories import make_user

# The smallest thing Excalidraw's own `serializeAsJSON` writes that the server will accept: a scene
# with one freehand stroke in it. Everything else in a real scene (appState, files, versions) is
# carried through untouched and deliberately not inspected here.
SCENE = (
    '{"type": "excalidraw", "version": 2, "source": "edmat",'
    ' "elements": [{"type": "freedraw", "id": "a1", "x": 10, "y": 10,'
    ' "points": [[0, 0], [12, 30], [40, 5]], "strokeColor": "#1e1e1e"}],'
    ' "appState": {"viewBackgroundColor": "#ffffff"}, "files": {}}'
)


def png_data_url(w=2400, h=1200):
    buf = io.BytesIO()
    Image.new('RGB', (w, h), (255, 255, 255)).save(buf, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()


def as_(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


class SketchCase(APITestCase):
    """Its own temporary MEDIA_ROOT per class — the arrangement `chem/tests.py` and
    `events/tests.py` use — so a test run never leaves pictures under `media/sketches/`."""

    databases = set(all_log_shards()) | {'default'}

    @classmethod
    def setUpClass(cls):
        cls._media_root = tempfile.mkdtemp(prefix='edmat-sketch-test-')
        cls._override = override_settings(MEDIA_ROOT=cls._media_root)
        cls._override.enable()
        super().setUpClass()

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        cls._override.disable()
        shutil.rmtree(cls._media_root, ignore_errors=True)

    def setUp(self):
        self.author = make_user('sketch-author')
        self.other = make_user('sketch-other')
        self.url = reverse('sketch-list')

    def post(self, client, **over):
        payload = {'source': SCENE, 'label': 'free body diagram', 'image': png_data_url()}
        payload.update(over)
        return client.post(self.url, payload, format='json')


class CreateTests(SketchCase):
    def test_the_stored_picture_is_webp_at_the_declared_dimensions(self):
        r = self.post(as_(self.author))
        self.assertEqual(r.status_code, 201, r.content)
        body = r.json()
        row = Sketch.objects.get(pk=body['id'])
        self.assertTrue(row.image.name.endswith('.webp'))
        self.assertEqual(Image.open(row.image.path).format, 'WEBP')
        # Bounded to the 1600px longest edge, and what the row SAYS its size is matches the file —
        # the embed carries those numbers as `width`/`height`, so a lie there makes the page jump.
        self.assertEqual(Image.open(row.image.path).size, (1600, 800))
        self.assertEqual((body['width'], body['height']), (1600, 800))

    def test_the_embed_html_names_the_sketch_and_loads_lazily(self):
        body = self.post(as_(self.author)).json()
        html = body['embed_html']
        self.assertIn('data-sketch="%d"' % body['id'], html)
        self.assertIn('class="sketch-drawing"', html)
        self.assertIn('alt="free body diagram"', html)
        self.assertIn('loading="lazy"', html)
        self.assertIn('width="1600"', html)
        self.assertIn('/media/sketches/', html)

    def test_a_pe_executable_named_png_is_refused(self):
        # A Windows PE with a `.png` name and a `data:image/png` label: the client's own claim about
        # the type is never believed — the bytes are sniffed, and then discarded by the re-encode.
        pe = b'MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00' + b'PE\x00\x00' + b'\x00' * 200
        r = self.post(as_(self.author), image='data:image/png;base64,' + base64.b64encode(pe).decode())
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(Sketch.objects.count(), 0)

    def test_a_picture_that_is_not_a_data_url_is_refused(self):
        self.assertEqual(self.post(as_(self.author), image='https://x.example/a.png').status_code, 400)
        self.assertEqual(self.post(as_(self.author), image='data:image/png;base64,!!!').status_code, 400)
        self.assertEqual(self.post(as_(self.author), image='<svg xmlns="http://www.w3.org/2000/svg"/>').status_code, 400)

    def test_the_source_must_be_an_excalidraw_scene(self):
        self.assertEqual(self.post(as_(self.author), source='not json').status_code, 400)
        self.assertEqual(self.post(as_(self.author), source='[]').status_code, 400)
        self.assertEqual(self.post(as_(self.author), source='{"nope": 1}').status_code, 400)
        self.assertEqual(self.post(as_(self.author), source='{"elements": "x"}').status_code, 400)

    def test_a_scene_over_the_source_cap_is_refused(self):
        # A bounded text, so a row can never become a storage lever. Built as a real scene so the
        # only thing the refusal can be about is its size.
        padding = 'x' * (MAX_SOURCE_BYTES + 1)
        huge = '{"type": "excalidraw", "elements": [{"type": "text", "text": "%s"}]}' % padding
        self.assertGreater(len(huge.encode('utf-8')), MAX_SOURCE_BYTES)
        r = self.post(as_(self.author), source=huge)
        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(Sketch.objects.count(), 0)

    def test_anonymous_cannot_create_but_anyone_can_read(self):
        self.assertEqual(self.post(APIClient()).status_code, 401)
        pk = self.post(as_(self.author)).json()['id']
        r = APIClient().get(reverse('sketch-detail', args=[pk]))
        self.assertEqual(r.status_code, 200)
        self.assertIn('"elements"', r.json()['source'])

    def test_my_sketches_lists_only_mine(self):
        self.post(as_(self.author))
        self.post(as_(self.other))
        self.assertEqual(len(as_(self.author).get(self.url).json()), 1)
        self.assertEqual(APIClient().get(self.url).status_code, 401)


class ReplaceTests(SketchCase):
    def test_a_stranger_cannot_update_my_sketch(self):
        pk = self.post(as_(self.author)).json()['id']
        detail = reverse('sketch-detail', args=[pk])
        payload = {'source': SCENE.replace('free', 'free'), 'label': 'hijacked', 'image': png_data_url(40, 20)}
        # A 403 rather than a 404: the sketch is public, so pretending it does not exist would be a
        # lie the stranger can disprove with the GET right above.
        self.assertEqual(as_(self.other).put(detail, payload, format='json').status_code, 403)
        self.assertEqual(as_(self.other).patch(detail, payload, format='json').status_code, 403)
        self.assertEqual(Sketch.objects.get(pk=pk).label, 'free body diagram')

    def test_the_author_replaces_it_and_the_old_file_goes(self):
        pk = self.post(as_(self.author)).json()['id']
        row = Sketch.objects.get(pk=pk)
        old_path = row.image.path
        r = as_(self.author).put(
            reverse('sketch-detail', args=[pk]),
            {'source': SCENE, 'label': 'redrawn', 'image': png_data_url(40, 20)},
            format='json',
        )
        self.assertEqual(r.status_code, 200, r.content)
        row.refresh_from_db()
        self.assertEqual(row.label, 'redrawn')
        self.assertEqual((row.width, row.height), (40, 20))
        self.assertNotEqual(row.image.path, old_path)
        self.assertFalse(os.path.exists(old_path))

    def test_there_is_no_delete(self):
        pk = self.post(as_(self.author)).json()['id']
        self.assertEqual(as_(self.author).delete(reverse('sketch-detail', args=[pk])).status_code, 405)


class KillSwitchTests(SketchCase):
    def test_off_closes_it_for_a_plain_user_and_not_for_staff(self):
        FeatureFlag.objects.update_or_create(key='sketches', defaults={'is_enabled': False})
        self.assertEqual(self.post(as_(self.author)).status_code, 403)
        # Reads close too, not just writes — `feature_gate` blocks every action, which is what
        # "the feature genuinely vanishes for a non-staff caller" has to mean.
        pk = Sketch.objects.create(author=self.author, source=SCENE).pk
        self.assertEqual(as_(self.author).get(reverse('sketch-detail', args=[pk])).status_code, 403)
        # An anonymous caller is refused the same read, as a 401: DRF turns a permission refusal
        # into "authenticate first" when nobody is signed in. The honest note is that this is the
        # gate answering, not a scoping rule.
        self.assertEqual(APIClient().get(reverse('sketch-detail', args=[pk])).status_code, 401)
        staff = make_user('sketch-staff', is_staff=True)
        self.assertEqual(self.post(as_(staff)).status_code, 201)


class EmbeddingTests(SketchCase):
    def test_the_sanitizer_keeps_data_sketch_and_drops_data_other(self):
        html = (
            '<p>see <img src="/media/sketches/abc.webp" alt="a sketch" data-sketch="7" '
            'class="sketch-drawing" width="800" height="600" loading="lazy" '
            'data-other="x" onerror="boom()"></p>'
        )
        clean = sanitize_content(html)
        self.assertIn('data-sketch="7"', clean)
        self.assertIn('class="sketch-drawing"', clean)
        self.assertIn('src="/media/sketches/abc.webp"', clean)
        self.assertIn('loading="lazy"', clean)
        self.assertNotIn('data-other', clean)
        self.assertNotIn('onerror', clean)

    def test_a_hot_linked_sketch_still_loses_its_src(self):
        # `data-sketch` is not a pass through the site-media rule: a picture from somewhere else is
        # a tracking pixel by another name, whatever attributes it carries.
        self.assertNotIn('evil', sanitize_content('<img src="https://evil.example/a.webp" data-sketch="7">'))
