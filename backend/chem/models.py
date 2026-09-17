"""A chemical structure — or a reaction — drawn in the browser, kept twice: the SOURCE the editor
can reopen, and the PICTURE everybody else sees.

The editor is Ketcher (Apache 2.0, EPAM), mounted in the app (frontend KetcherHost.svelte). It
was to be one of two: ChemDoodle Web Components was wired in alongside it and then dropped the
same day, because it is GPLv3 and this repository is MIT — the owner's call, and the reason
nothing here carries a `tool` column. A drawing is stored in one of Ketcher's own formats
(KET JSON, or an MDL Molfile / RXN file), so a later edit reopens losslessly. Nothing here parses
chemistry: the server has no cheminformatics library and does not pretend to. What it validates
is the *shape* (a bounded text, a JSON that parses, a Molfile with a counts line) and the picture.

The picture is what content embeds. A drawing lands in a comment, a post or a solution as an
ordinary `<img src="/media/chem/…" data-chem="ID">` — the same site-media-only `<img>` the
content sanitizer already allows (config/sanitize.py), plus one `data-chem` attribute so the
rich editor can find the drawing behind the picture and reopen it. Ketcher renders vector SVG,
kept after `svg.py` has been through it so a script or an external reference cannot ride in; a
raster (Ketcher can also export PNG) goes through the same `imaging` re-encode every uploaded
picture here gets, so it is never the bytes the browser sent.

Deliberately not an attachment: an attachment sits under a comment; a drawing sits IN the
sentence that refers to it ("the intermediate is <picture>, which then…"), which is the whole
point of drawing it instead of uploading a photo.
"""

import uuid

from django.conf import settings
from django.db import models

FORMAT_CHOICES = [
    ('ket', 'KET (Ketcher JSON)'),
    ('mol', 'MDL Molfile / RXN'),
]

IMAGE_KIND_CHOICES = [
    ('svg', 'SVG'),
    ('raster', 'WebP'),
]

# Bounds on the SOURCE text. A hand-drawn structure is a few kilobytes; a whole reaction scheme
# with a dozen molecules is tens. 512 KB is far beyond anything drawn by hand and small enough
# that a row can never become a storage lever.
MAX_SOURCE_BYTES = 512 * 1024
# The SMILES/summary line is display-only (an `alt` text and a label under the picture).
MAX_LABEL_LENGTH = 300


def drawing_upload_path(instance, filename: str) -> str:
    ext = '.svg' if instance.image_kind == 'svg' else '.webp'
    return f'chem/{uuid.uuid4().hex}{ext}'


class ChemDrawing(models.Model):
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name='chem_drawings', on_delete=models.CASCADE
    )
    source_format = models.CharField(max_length=8, choices=FORMAT_CHOICES)
    source = models.TextField()
    # A SMILES string when the editor could produce one, else whatever short label the client
    # sent. Never trusted as chemistry; it is the picture's `alt` and nothing more.
    label = models.CharField(max_length=MAX_LABEL_LENGTH, blank=True)
    image = models.FileField(upload_to=drawing_upload_path)
    image_kind = models.CharField(max_length=6, choices=IMAGE_KIND_CHOICES)
    width = models.PositiveIntegerField(default=0)
    height = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self) -> str:
        return f'chem drawing #{self.pk} ({self.source_format}) by {self.author}'

    def embed_html(self, src: str | None = None) -> str:
        """The exact `<img>` a client should put into content. Built here so the one attribute the
        rich editor relies on (`data-chem`) is spelled in one place. `src` is the picture's URL
        as the CLIENT will resolve it — the serializer passes an absolute one built from the
        request, because a relative `/media/…` resolves against whatever origin the page is on,
        and in development that is the Vite server, not the API (every drawing 404'd in a
        browser run before this took the request into account; the same absolute form the comment
        attachments already use). The content sanitizer allows it on this deployment's own hosts."""
        alt = (self.label or 'chemical structure').replace('"', '&quot;')
        return f'<img src="{src or self.image.url}" alt="{alt}" data-chem="{self.pk}" class="chem-drawing">'
