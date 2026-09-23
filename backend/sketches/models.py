"""A freehand drawing — a whiteboard sketch — made with the mouse in a fullscreen canvas and kept
twice: the SOURCE the editor reopens, and the PICTURE everybody else sees.

This is `chem/` again with a different editor. The asked-for thing ("dodawanie obrazków myszką —
pisanie jak na Zoom … jako opcja dodawania treści/komentarzy") is a Zoom-style annotation board:
one button, a fullscreen XY workspace with pan and zoom, draw with the mouse, and the result lands
in the sentence being written. The editor is Excalidraw (MIT; frontend `components/sketch/`), whose
scene is a plain JSON document — that is the `source`, and `restore()` reopens it losslessly.

**The picture is a raster, not a vector, and that is deliberate.** A chem structure is a dozen
straight bonds and a few letters, so `chem/svg.py` can rebuild it from an allowlist and keep it
vector. A freehand stroke is a `<path>` with hundreds of points, and a scene of them is a large SVG
whose every byte would have to be re-derived — while the thing being drawn is line art that a
1600px WebP shows perfectly. So the editor exports PNG and the server puts it through the same
`imaging.py` re-encode every other uploaded picture here gets (house rule 7: never store the bytes
that were sent). Nothing here parses the drawing; what it validates is the *shape* (a bounded JSON
document with an `elements` array) and the picture.

Content embeds it as an ordinary `<img src="/media/sketches/…" data-sketch="ID" …>` — the same
site-media-only `<img>` the content sanitizer already allows (`config/sanitize.py`), plus one
`data-sketch` attribute so the rich editor can find the drawing behind the picture and reopen it.

Deliberately not an attachment, for the same reason a chem drawing is not: an attachment sits under
a comment; a sketch sits IN the sentence that refers to it ("the force acts here <picture>, so…"),
which is the whole point of drawing it rather than describing it.
"""

import uuid

from django.conf import settings
from django.db import models

# Bounds on the SOURCE text. An Excalidraw scene is one JSON object per element, and a stroke
# carries its own point list — a busy hand-drawn board is tens of kilobytes. 512 KB is far beyond
# anything drawn by hand in one sitting and small enough that a row can never become a storage
# lever. The same number, for the same reason, as `chem.models.MAX_SOURCE_BYTES`; the two are not
# shared because they bound two different editors' documents and either may move alone.
MAX_SOURCE_BYTES = 512 * 1024
# The label is display-only (the picture's `alt`, and what a person calls the drawing).
MAX_LABEL_LENGTH = 300


def sketch_upload_path(instance, filename: str) -> str:
    return f'sketches/{uuid.uuid4().hex}.webp'


class Sketch(models.Model):
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='sketches', on_delete=models.CASCADE
    )
    # The Excalidraw scene, verbatim, as JSON text. Never interpreted here beyond "is it a bounded
    # JSON object with an elements array" — the server has no drawing engine and does not pretend to.
    source = models.TextField()
    label = models.CharField(max_length=MAX_LABEL_LENGTH, blank=True)
    image = models.FileField(upload_to=sketch_upload_path)
    width = models.PositiveIntegerField(default=0)
    height = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name_plural = 'sketches'

    def __str__(self) -> str:
        return f'sketch #{self.pk} by {self.author}'

    def embed_html(self, src: str | None = None) -> str:
        """The exact `<img>` a client should put into content. Built here so the one attribute the
        rich editor relies on (`data-sketch`) is spelled in one place, exactly as `chem/` does.

        `src` is the picture's URL as the CLIENT will resolve it — the serializer passes an absolute
        one built from the request, because a relative `/media/…` resolves against whatever origin
        the page is on, and in development that is the Vite server, not the API (every chem drawing
        404'd in a browser run before that was taken into account).

        The intrinsic `width`/`height` and `loading="lazy"` are the same three
        `community/inline_images.py` writes, for the same reason: a reader's layout must not jump
        while pictures and KaTeX settle, and a reader who never scrolls to the drawing should never
        download it."""
        alt = (self.label or 'sketch').replace('"', '&quot;')
        return (
            f'<img src="{src or self.image.url}" alt="{alt}" data-sketch="{self.pk}" '
            f'class="sketch-drawing" width="{self.width}" height="{self.height}" loading="lazy">'
        )
