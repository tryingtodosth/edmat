from django.contrib import admin

from .models import Material, MaterialTranslation


class MaterialTranslationInline(admin.TabularInline):
    model = MaterialTranslation
    extra = 0


@admin.register(Material)
class MaterialAdmin(admin.ModelAdmin):
    list_display = ['slug', 'course', 'type', 'author', 'published', 'featured']
    list_filter = ['course', 'type', 'published', 'featured']
    filter_horizontal = ['topics']
    inlines = [MaterialTranslationInline]
