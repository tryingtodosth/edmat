"""The sanitizer widening for the rich editor (AUDIENCE-BRIEF.md §7): what a Tiptap document
contains survives, and every widening has the refusal that goes with it."""

from django.test import SimpleTestCase, override_settings

from config.sanitize import sanitize_content


@override_settings(ALLOWED_HOSTS=['edmat.net'], MEDIA_URL='media/')
class SanitizerWideningTests(SimpleTestCase):
    def test_a_rich_editor_document_survives(self):
        html = '<h2>Title</h2><p><strong>bold</strong> <em>it</em> <code>x</code></p><ul><li><p>one</p></li></ul><blockquote><p>q</p></blockquote><hr><pre><code>a=1</code></pre>'
        self.assertEqual(sanitize_content(html), html)

    def test_figure_with_an_own_media_picture_survives(self):
        html = '<figure><img src="/media/comment-attachments/abc.webp" alt="sketch"><figcaption>the sketch</figcaption></figure>'
        self.assertEqual(sanitize_content(html), html)
        absolute = '<img src="https://edmat.net/media/x.webp" alt="a">'
        self.assertEqual(sanitize_content(absolute), absolute)

    def test_a_hot_linked_picture_loses_its_source(self):
        out = sanitize_content('<p>see</p><img src="https://evil.example/pixel.gif" alt="t">')
        self.assertNotIn('evil.example', out)
        self.assertNotIn('src=', out)
        out = sanitize_content('<img src="data:image/png;base64,AAAA" alt="t">')
        self.assertNotIn('data:', out)
        out = sanitize_content('<img src="https://edmat.net/not-media/x.png">')
        self.assertNotIn('not-media', out)

    def test_style_iframe_and_handlers_are_still_refused(self):
        out = sanitize_content('<p style="color:red" onclick="x()">t</p><iframe src="https://x"></iframe><figure style="a"><figcaption>c</figcaption></figure>')
        self.assertNotIn('style=', out)
        self.assertNotIn('onclick', out)
        self.assertNotIn('iframe', out)
        self.assertIn('<figcaption>c</figcaption>', out)

    def test_math_is_left_alone_inside_rich_markup(self):
        html = '<p>Let \\(x^{2}\\) and</p>\\[\\int_0^1 f\\]'
        self.assertEqual(sanitize_content(html), html)


from rest_framework.test import APITestCase

from telemetry.routers import all_log_shards
from testing.factories import make_branch, make_exercise, make_user


class CommentSanitizedOnWriteTests(APITestCase):
    databases = set(all_log_shards()) | {'default'}

    def test_a_comment_body_is_cleaned_on_the_way_in(self):
        from django.urls import reverse

        branch = make_branch(slug='san-branch')
        ex = make_exercise(branch, 1)
        self.client.force_authenticate(make_user('san-user'))
        r = self.client.post(reverse('exercise-comments', args=[ex.pk]), {'body': '<p onclick="x()">hi <strong>there</strong></p><script>alert(1)</script> \\(x^2\\)'}, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        body = r.json()['body']
        self.assertIn('<strong>there</strong>', body)
        self.assertNotIn('onclick', body)
        self.assertNotIn('<script', body)
        self.assertIn('\\(x^2\\)', body)
