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


class PlainTextWriteMixin:
    """Makes a plain edit form's write of `title`/`description` actually visible.

    Add it to a write serializer of any kind in `targets.TRANSLATABLE_KIND_MODELS` — it is the
    other half of `TranslatedTextMixin`: that one makes the READ answer in the reader's language,
    this one makes the WRITE land where that read looks. Without it a PATCH changes the row's own
    column, which `resolve` stops consulting the moment anybody has translated the row, so the edit
    vanishes (see `services.write_original_text` for the probe that proved it).

    It does not replace `PUT /api/text-versions/<kind>/<pk>/`. That endpoint writes every language
    in one submission and is how a translation is made; this is the single-language edit somebody
    makes in the row's own form, and it touches the original language only.

    The column write stays exactly where it was — `super().update()` does it, and
    `write_original_text` then mirrors the version back over it with the identical text — so a row
    nobody has translated behaves precisely as it did before, which is what keeps this additive.
    """

    def update(self, instance, validated_data):
        from . import targets
        from .services import TranslationWriteError, write_original_text

        heading_field, body_field = targets.fields_of(instance)
        # Read BEFORE `super().update()`, because what we want to know is what the request asked
        # for: a field absent from a PATCH must stay `None` ("leave that half alone") rather than
        # become the value the save has just written.
        heading = validated_data.get(heading_field) if heading_field else None
        body = validated_data.get(body_field) if body_field else None
        instance = super().update(instance, validated_data)
        if heading is None and body is None:
            return instance
        try:
            if write_original_text(
                instance, heading=heading, body=body, user=self._writing_user()
            ):
                # The view fetched this row through a queryset that prefetched `text_versions`
                # (every management view does, so that `resolve` answers in memory for a board of
                # fifty rows). That cache was filled BEFORE the write, so the response this
                # serializer is about to render would resolve the text from the versions as they
                # were a moment ago — a 200 carrying the OLD title back from a save that worked.
                # Found in the browser (house rule 2): the page showed the previous title until a
                # reload. DRF's own `UpdateModelMixin` drops this cache for exactly this reason.
                cache = getattr(instance, '_prefetched_objects_cache', None)
                if cache:
                    cache.pop('text_versions', None)
        except TranslationWriteError as exc:
            # A blank original heading is the only way in, and every serializer here already
            # refuses one — but a 400 with the reason is the house answer (house rule 6) and a
            # 500 is not.
            raise serializers.ValidationError({'detail': str(exc)}) from exc
        return instance

    def _writing_user(self):
        request = self.context.get('request')
        user = getattr(request, 'user', None) if request is not None else None
        return user if (user is not None and getattr(user, 'is_authenticated', False)) else None
