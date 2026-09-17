from django.contrib import admin

from .models import ChemDrawing


@admin.register(ChemDrawing)
class ChemDrawingAdmin(admin.ModelAdmin):
    list_display = ('id', 'source_format', 'image_kind', 'author', 'created_at')
    list_filter = ('source_format', 'image_kind')
    search_fields = ('label',)
    raw_id_fields = ('author',)
