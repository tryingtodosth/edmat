"""Pictures on a piece of content (root CLAUDE.md §17AY).

Weighted at the refusals, because those are the ones that fail silently. In particular: a gallery is
exactly as visible as its target, and the way to get that wrong is to leak an unpublished exercise
through the pictures somebody attached to it — so that case is tested for its own sake rather than
as a side effect of a happy path.
"""

import io
import shutil
import tempfile

from django.contrib.contenttypes.models import ContentType
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.urls import reverse
from PIL import Image
from rest_framework import status
from rest_framework.test import APITestCase

from galleries.models import Gallery, GalleryImage
from moderation.models import FeatureFlag, NodeGovernor
from testing.factories import make_branch, make_exercise, make_material, make_user


def png_bytes(width=900, height=600, *, with_exif=False) -> bytes:
    image = Image.new('RGB', (width, height), (40, 120, 90))
    buffer = io.BytesIO()
    if with_exif:
        exif = Image.Exif()
        exif[0x010F] = 'EdMat Test Camera'
        image.save(buffer, format='JPEG', exif=exif)
    else:
        image.save(buffer, format='PNG')
    return buffer.getvalue()


def upload(name='page.png', data=None, content_type='image/png') -> SimpleUploadedFile:
    return SimpleUploadedFile(name, data if data is not None else png_bytes(), content_type)


class GalleryBase(APITestCase):
    """Every gallery test writes real files, so every one of them writes into a temporary
    `MEDIA_ROOT` — applied per class so the directory survives the whole class and is removed once.

    Not optional tidiness: the first version of this file lacked it and left 85 stray WebPs in the
    developer's own `media/galleries/`, which is both litter and a way for one run to make the next
    one's "is it really gone?" check pass for the wrong reason. `accounts/test_avatar.py` and
    `events/tests.py` already do exactly this, for exactly this.
    """

    @classmethod
    def setUpClass(cls):
        cls._media_root = tempfile.mkdtemp(prefix='edmat-gallery-test-')
        cls._override = override_settings(MEDIA_ROOT=cls._media_root)
        cls._override.enable()
        super().setUpClass()

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        cls._override.disable()
        shutil.rmtree(cls._media_root, ignore_errors=True)

    def setUp(self):
        self.branch = make_branch()
        self.material = make_material(self.branch)
        self.material.published = True
        self.material.save(update_fields=['published'])
        self.uploader = make_user('gal-uploader')
        self.stranger = make_user('gal-stranger')
        self.staff = make_user('gal-staff', is_staff=True)

    def add_image(self, as_user=None, target=None, **extra):
        self.client.force_authenticate(as_user or self.uploader)
        target = target or self.material
        payload = {
            'target_type': 'material' if target is self.material else 'exercise',
            'target_id': target.pk,
            'image': upload(),
            **extra,
        }
        return self.client.post(reverse('gallery-image-list'), payload, format='multipart')

    def read(self, target=None, target_type='material'):
        target = target or self.material
        return self.client.get(
            reverse('gallery-for-target'), {'target_type': target_type, 'target_id': target.pk}
        )


class ReadingTests(GalleryBase):
    def test_an_empty_gallery_reads_as_empty_not_as_missing(self):
        self.client.force_authenticate(None)
        response = self.read()

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsNone(response.data['id'])
        self.assertEqual(response.data['images'], [])
        self.assertFalse(response.data['can_add'])

    def test_anybody_can_see_pictures_on_published_content(self):
        self.add_image()
        self.client.force_authenticate(None)
        response = self.read()

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['images']), 1)

    def test_an_unpublished_exercises_gallery_is_not_readable(self):
        """The leak this whole visibility module exists to prevent."""
        exercise = make_exercise(self.branch, 901)
        exercise.published = False
        exercise.save(update_fields=['published'])
        self.add_image(as_user=self.staff, target=exercise)

        self.client.force_authenticate(self.stranger)
        response = self.read(target=exercise, target_type='exercise')
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

        self.client.force_authenticate(self.staff)
        self.assertEqual(self.read(target=exercise, target_type='exercise').status_code, status.HTTP_200_OK)

    def test_an_unknown_target_type_is_not_found(self):
        self.client.force_authenticate(None)
        response = self.client.get(
            reverse('gallery-for-target'), {'target_type': 'branch', 'target_id': self.branch.pk}
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class AddingTests(GalleryBase):
    def test_adding_needs_an_account(self):
        self.client.force_authenticate(None)
        response = self.client.post(
            reverse('gallery-image-list'),
            {'target_type': 'material', 'target_id': self.material.pk, 'image': upload()},
            format='multipart',
        )
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_the_stored_picture_is_not_the_bytes_that_were_sent(self):
        response = self.add_image()
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        row = GalleryImage.objects.get(pk=response.data['id'])
        self.assertTrue(row.image.name.endswith('.webp'))
        row.image.open()
        stored = Image.open(io.BytesIO(row.image.read()))
        self.assertEqual(stored.format, 'WEBP')
        self.assertEqual((stored.width, stored.height), (900, 600))

    def test_a_large_picture_is_bounded_but_keeps_its_shape(self):
        response = self.add_image(image=upload(data=png_bytes(4000, 2000)))
        row = GalleryImage.objects.get(pk=response.data['id'])

        self.assertEqual((row.width, row.height), (2000, 1000))

    def test_a_small_picture_is_not_blown_up(self):
        response = self.add_image(image=upload(data=png_bytes(320, 200)))
        row = GalleryImage.objects.get(pk=response.data['id'])

        self.assertEqual((row.width, row.height), (320, 200))

    def test_the_camera_tag_does_not_survive(self):
        response = self.add_image(
            image=upload('photo.jpg', png_bytes(with_exif=True), 'image/jpeg')
        )
        row = GalleryImage.objects.get(pk=response.data['id'])
        row.image.open()
        stored = Image.open(io.BytesIO(row.image.read()))

        self.assertFalse(dict(stored.getexif()))

    def test_something_that_is_not_a_picture_is_refused(self):
        response = self.add_image(
            image=upload('page.png', b'MZ\x90\x00\x03' + b'\x00' * 200, 'image/png')
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(GalleryImage.objects.count(), 0)

    def test_the_gallery_has_a_ceiling(self):
        gallery = Gallery.objects.create(
            content_type=ContentType.objects.get_for_model(type(self.material)),
            object_id=self.material.pk,
        )
        for index in range(40):
            GalleryImage.objects.create(gallery=gallery, image=f'galleries/x{index}.webp')

        response = self.add_image()
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['detail'], 'too_many')

    def test_the_upload_allowance_is_shared_with_every_other_upload(self):
        profile = self.uploader.profile
        profile.material_upload_quota_bytes = 1
        profile.save(update_fields=['material_upload_quota_bytes'])

        response = self.add_image()
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['detail'], 'quota')

    def test_pictures_arrive_in_the_order_they_were_added(self):
        first = self.add_image().data['id']
        second = self.add_image().data['id']

        images = self.read().data['images']
        self.assertEqual([image['id'] for image in images], [first, second])


class CuratingTests(GalleryBase):
    def setUp(self):
        super().setUp()
        self.first = self.add_image().data['id']
        self.second = self.add_image().data['id']
        self.gallery = Gallery.objects.get()

    def _reorder(self, user, ids):
        self.client.force_authenticate(user)
        return self.client.put(
            reverse('gallery-order', args=[self.gallery.pk]), {'image_ids': ids}, format='json'
        )

    def test_a_curator_puts_them_in_order(self):
        response = self._reorder(self.staff, [self.second, self.first])

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([image['id'] for image in response.data['images']], [self.second, self.first])

    def test_somebody_who_merely_uploaded_one_cannot_reorder_the_gallery(self):
        """Adding is open to anybody; the ORDER is the job somebody has to be trusted with, which is
        what makes applying to look after a material worth doing."""
        response = self._reorder(self.uploader, [self.second, self.first])
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_a_governor_of_the_material_itself_can_curate(self):
        curator = make_user('gal-curator')
        NodeGovernor.objects.create(
            user=curator,
            content_type=ContentType.objects.get_for_model(type(self.material)),
            object_id=self.material.pk,
        )

        response = self._reorder(curator, [self.second, self.first])
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_a_governor_of_the_branch_above_it_can_curate_too(self):
        curator = make_user('gal-branch-curator')
        NodeGovernor.objects.create(
            user=curator,
            content_type=ContentType.objects.get_for_model(type(self.branch)),
            object_id=self.branch.pk,
        )

        self.assertEqual(self._reorder(curator, [self.second, self.first]).status_code, status.HTTP_200_OK)

    def test_a_partial_order_is_refused_rather_than_guessed_at(self):
        response = self._reorder(self.staff, [self.second])

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            [image.pk for image in self.gallery.images.all()], [self.first, self.second]
        )

    def test_the_uploader_captions_their_own_picture(self):
        self.client.force_authenticate(self.uploader)
        response = self.client.patch(
            reverse('gallery-image-detail', args=[self.first]),
            {'caption': 'Page 1 of the handout'},
            format='multipart',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(GalleryImage.objects.get(pk=self.first).caption, 'Page 1 of the handout')

    def test_a_stranger_captions_nothing(self):
        self.client.force_authenticate(self.stranger)
        response = self.client.patch(
            reverse('gallery-image-detail', args=[self.first]), {'caption': 'mine now'}, format='multipart'
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_the_uploader_can_take_their_own_picture_down(self):
        self.client.force_authenticate(self.uploader)
        response = self.client.delete(reverse('gallery-image-detail', args=[self.first]))

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(GalleryImage.objects.filter(pk=self.first).exists())

    def test_a_curator_can_take_somebody_elses_down(self):
        self.client.force_authenticate(self.staff)
        self.assertEqual(
            self.client.delete(reverse('gallery-image-detail', args=[self.first])).status_code,
            status.HTTP_204_NO_CONTENT,
        )

    def test_a_stranger_cannot(self):
        self.client.force_authenticate(self.stranger)
        self.assertEqual(
            self.client.delete(reverse('gallery-image-detail', args=[self.first])).status_code,
            status.HTTP_403_FORBIDDEN,
        )


class HeldPictureTests(GalleryBase):
    def test_a_picture_from_a_child_waits_for_a_moderator(self):
        child = make_user('gal-child')
        child.profile.is_minor = True
        child.profile.save(update_fields=['is_minor'])

        response = self.add_image(as_user=child)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        row = GalleryImage.objects.get(pk=response.data['id'])
        self.assertIsNotNone(row.auto_hidden_at)

        self.client.force_authenticate(None)
        self.assertEqual(self.read().data['images'], [])

    def test_a_picture_on_content_made_for_children_waits_too(self):
        self.material.audience = 'primary'
        self.material.save(update_fields=['audience'])

        response = self.add_image()
        row = GalleryImage.objects.get(pk=response.data['id'])
        self.assertIsNotNone(row.auto_hidden_at)


class KillSwitchTests(GalleryBase):
    def test_turning_galleries_off_closes_the_whole_surface(self):
        FeatureFlag.objects.filter(key='galleries').update(is_enabled=False)

        self.client.force_authenticate(self.stranger)
        self.assertEqual(self.read().status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(self.add_image().status_code, status.HTTP_403_FORBIDDEN)

    def test_a_moderator_still_gets_through(self):
        FeatureFlag.objects.filter(key='galleries').update(is_enabled=False)
        self.client.force_authenticate(self.staff)
        self.assertEqual(self.read().status_code, status.HTTP_200_OK)


class ReportingTests(GalleryBase):
    def test_a_picture_can_be_reported_and_a_moderator_takes_it_down(self):
        image_id = self.add_image().data['id']

        self.client.force_authenticate(self.stranger)
        report = self.client.post(
            reverse('report-list'),
            {'kind': 'gallery_image', 'object_id': image_id, 'reason': 'inappropriate'},
            format='json',
        )
        self.assertEqual(report.status_code, status.HTTP_201_CREATED)

        self.client.force_authenticate(self.staff)
        action = self.client.post(
            reverse('moderation-report-action', args=['gallery_image', image_id, 'remove']),
            {},
            format='json',
        )
        self.assertEqual(action.status_code, status.HTTP_200_OK)
        self.assertTrue(GalleryImage.objects.get(pk=image_id).is_removed)

        self.client.force_authenticate(None)
        self.assertEqual(self.read().data['images'], [])
