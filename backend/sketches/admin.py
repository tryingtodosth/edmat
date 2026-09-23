from django.contrib import admin

from .models import Sketch


@admin.register(Sketch)
class SketchAdmin(admin.ModelAdmin):
    list_display = ('id', 'label', 'author', 'width', 'height', 'created_at')
    search_fields = ('label',)
    raw_id_fields = ('author',)
