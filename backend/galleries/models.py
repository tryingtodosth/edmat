"""Pictures somebody adds to a piece of content, ordered by whoever looks after it.

**Why this is not a comment attachment.** An attachment (community/models.py, §17AR) belongs to one
person's remark: it sits under the sentence they wrote and reads as part of it. A gallery belongs to
the CONTENT — the three photographed pages of a scanned exam, the four diagrams a proof needs, the
pictures from a workshop — and it is the same set no matter who happens to be reading. The two are
genuinely different objects and giving them one model would mean every listing of either having to
explain which kind it was looking at.

**One gallery per piece of content, many contributors.** Not one gallery per person per piece of
content, which is the other obvious shape and is worse here: five people who each photographed a
different page of the same handout would produce five one-page galleries, and the reader — who wants
the handout — would have to open all five and work out the order themselves. So an image carries its
own uploader and the ORDER belongs to the gallery, which is what makes curating it a real job rather
than a preference.

**That job is the reason `GovernorApplication` exists beside this** (moderation/models.py). Anybody
signed in may add a picture; putting them in the right order, writing the captions and taking down
the blurry one are things somebody has to be trusted with, and applying to look after a material is
how a reader becomes that person. The two features were asked for together and this is why they fit
together.

**The picture is never the bytes that were uploaded.** Every image goes through the shared `imaging`
re-encode — decoded, EXIF dropped, bounded, written out as a fresh WebP — which is what discards an
appended payload, and here also what stops a photograph of a lecture hall publishing the GPS
coordinates of the room somebody took it in.
"""

import uuid

from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.db import models

# What a gallery may hang off, in the same (app_label, model) -> short-name vocabulary
# `community/targets.py` already established for comment targets — deliberately a SEPARATE, much
# shorter table rather than a reuse of that one. A thread makes sense on a coverage claim or a
# review; a photo album does not, and inheriting a longer list would mean every new comment target
# silently becoming a place pictures could be uploaded to.
GALLERY_TARGETS = {
    ('materials', 'material'): 'material',
    ('exercises', 'exercise'): 'exercise',
    ('activity', 'post'): 'post',
}
GALLERY_TARGET_MODELS = {name: key for key, name in GALLERY_TARGETS.items()}

# Per image. A photographed A4 page off a modern phone is 2–6 MB; 10 leaves room for the one that
# is not, without making the upload endpoint a storage lever.
MAX_GALLERY_IMAGE_BYTES = 10 * 1024 * 1024
# Per gallery. A scanned handout is a dozen pages; past this it is a file, not a gallery, and
# `/submit-material` is the thing that takes files.
MAX_IMAGES_PER_GALLERY = 40
MAX_CAPTION_LENGTH = 300
# The longest edge of the stored picture. Big enough to read the handwriting on a photographed
# exercise sheet, small enough that a page of thumbnails is not tens of megabytes.
GALLERY_IMAGE_MAX_EDGE = 2000


def gallery_image_upload_path(instance, filename: str) -> str:
    """A random name, discarding whatever the uploader called it — the same reasoning as every other
    upload path here: a filename is untrusted input (path separators, a double extension, a
    collision), and the original is kept in a column where it is data rather than a path."""
    return f'galleries/{uuid.uuid4().hex}.webp'


class Gallery(models.Model):
    """The album itself: a target, and an order over the pictures in it.

    Thin on purpose. It exists because the ORDER has to belong to something — an image cannot own
    its own position relative to its neighbours — and because it gives the API one id to curate
    rather than a target type and id repeated on every call.
    """

    content_type = models.ForeignKey(ContentType, on_delete=models.CASCADE)
    object_id = models.PositiveIntegerField()
    target = GenericForeignKey('content_type', 'object_id')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        # One per piece of content — see the module docstring for why this is not per person.
        constraints = [
            models.UniqueConstraint(
                fields=['content_type', 'object_id'], name='one_gallery_per_target'
            )
        ]
        verbose_name_plural = 'galleries'

    def __str__(self) -> str:
        return f'gallery #{self.pk} on {self.content_type.model} #{self.object_id}'

    @property
    def target_type(self) -> str:
        ct = ContentType.objects.get_for_id(self.content_type_id)
        return GALLERY_TARGETS.get((ct.app_label, ct.model), '')


class GalleryImage(models.Model):
    gallery = models.ForeignKey(Gallery, related_name='images', on_delete=models.CASCADE)
    image = models.ImageField(upload_to=gallery_image_upload_path)
    caption = models.CharField(max_length=MAX_CAPTION_LENGTH, blank=True)
    # Curated position. Not `created_at`, which is the order they happened to arrive in and is
    # exactly what somebody looking after a scanned handout needs to be able to override.
    order = models.PositiveIntegerField(default=0)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name='gallery_images',
        null=True,
        on_delete=models.SET_NULL,
    )
    original_name = models.CharField(max_length=255, blank=True)
    width = models.PositiveIntegerField(default=0)
    height = models.PositiveIntegerField(default=0)
    size_bytes = models.PositiveIntegerField(default=0)
    # The two columns the report/auto-hide machinery writes (moderation/services.py). Present with
    # the names that machinery already expects, so a picture here is reportable through the same
    # path as every other piece of user content rather than through one of its own.
    auto_hidden_at = models.DateTimeField(null=True, blank=True)
    is_removed = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['order', 'id']

    def __str__(self) -> str:
        return f'gallery image #{self.pk}'

    @property
    def is_visible(self) -> bool:
        return not self.is_removed and self.auto_hidden_at is None
