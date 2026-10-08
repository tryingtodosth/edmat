"""Input validation for the one write endpoint, and the two read blocks the four management apps
embed in their own serializers.

`TranslatedTextMixin` is why none of those four apps had to learn anything about this one: a
serializer adds the mixin, names its two fields, and its `title`/`description` start answering in
the reader's language with a staleness reading beside them.

The reading is called **`language`** and not `text`, which it was for about ten minutes: a
`PollOption`'s own field is literally named `text`, so a method field of that name would have
shadowed the option's words with the metadata about them.
"""

from rest_framework import serializers

from . import resolve
from config.i18n_utils import request_locale


class VersionTextSerializer(serializers.Serializer):
    heading = serializers.CharField(required=False, allow_blank=True, max_length=4000)
    body = serializers.CharField(required=False, allow_blank=True, max_length=20000)


class WriteVersionsSerializer(serializers.Serializer):
    """`{"original_locale": "pl", "versions": {"pl": {...}, "en": {...}}}` — every language in one
    submission, which is the shape that keeps them from drifting apart."""

    original_locale = serializers.CharField(max_length=8)
    versions = serializers.DictField(child=VersionTextSerializer())

    def validate_versions(self, value):
        if not value:
            raise serializers.ValidationError('no_versions')
        for locale in value:
            if not locale or len(locale) > 8:
                raise serializers.ValidationError('bad_locale')
        return value


class TranslatedTextMixin:
    """Adds `language` and `text_versions` to a ModelSerializer, and makes the model's own two
    text fields answer in the reader's language.

    A subclass sets `translated_heading_field` / `translated_body_field` to its OWN field names —
    `title`/`description` for three of the four, `question`/`description` for a poll, a bare `text`
    for a poll option — and adds `'language'` and `'text_versions'` to `Meta.fields`. The heading and body fields themselves stay
    declared as they were, so nothing else about the serializer changes.

    The locale comes from `?lang=`, through the same `config.i18n_utils.request_locale` every other
    translatable surface on this platform reads, with the same documented 'pl' backstop.
    """

    translated_heading_field = 'title'
    translated_body_field = 'description'

    def _reading(self, obj):
        # Cached per object per request: `title`, `description`, `text` and `text_versions` would
        # otherwise each resolve the same list of versions again.
        cache = self.context.setdefault('_translation_readings', {})
        key = (type(obj).__name__, obj.pk)
        if key not in cache:
            cache[key] = resolve.resolve(obj, request_locale(self.context))
        return cache[key]

    def get_language(self, obj):
        reading = self._reading(obj)
        return {
            'locale': reading['locale'],
            'requested_locale': reading['requested_locale'],
            'is_fallback': reading['is_fallback'],
            'available': reading['available'],
            'original_locale': reading['original_locale'],
            'newer_elsewhere': reading['newer_elsewhere'],
        }

    def get_text_versions(self, obj):
        return resolve.versions_payload(obj)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        reading = self._reading(instance)
        # Only when something has actually been written here. With no versions at all the reading
        # already returns the row's own columns, so this is a no-op for every pre-existing row —
        # the whole change stays additive.
        if reading['locale']:
            if self.translated_heading_field in data:
                data[self.translated_heading_field] = reading['heading']
            if self.translated_body_field and self.translated_body_field in data:
                data[self.translated_body_field] = reading['body']
        return data
