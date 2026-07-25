from rest_framework import serializers

from config.i18n_utils import request_locale, resolve_translation

from .models import Material


class MaterialSerializer(serializers.ModelSerializer):
    title = serializers.SerializerMethodField()
    description = serializers.SerializerMethodField()
    topics = serializers.PrimaryKeyRelatedField(many=True, read_only=True)
    course_slug = serializers.SlugRelatedField(source='course', slug_field='slug', read_only=True)

    class Meta:
        model = Material
        fields = [
            'id',
            'course',
            'course_slug',
            'slug',
            'type',
            'topics',
            'file',
            'author',
            'published',
            'featured',
            'order',
            'title',
            'description',
        ]

    def get_title(self, obj):
        t = resolve_translation(obj.translations, request_locale(self.context))
        return t.title if t else obj.slug

    def get_description(self, obj):
        t = resolve_translation(obj.translations, request_locale(self.context))
        return t.description if t else ''
