from django.contrib import admin

from .models import Gallery, GalleryImage


class GalleryImageInline(admin.TabularInline):
    model = GalleryImage
    extra = 0
    fields = ['image', 'caption', 'order', 'uploaded_by', 'auto_hidden_at', 'is_removed']
    readonly_fields = ['uploaded_by']


@admin.register(Gallery)
class GalleryAdmin(admin.ModelAdmin):
    list_display = ['__str__', 'created_at']
    inlines = [GalleryImageInline]


@admin.register(GalleryImage)
class GalleryImageAdmin(admin.ModelAdmin):
    list_display = ['__str__', 'gallery', 'uploaded_by', 'order', 'is_removed', 'auto_hidden_at']
    list_filter = ['is_removed']
