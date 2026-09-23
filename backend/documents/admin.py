from django.contrib import admin

from .models import DocumentAcknowledgement, EventDocument


@admin.register(EventDocument)
class EventDocumentAdmin(admin.ModelAdmin):
    list_display = ('id', 'title', 'event', 'visibility', 'version', 'requires_acknowledgement', 'removed_at')
    list_filter = ('visibility', 'kind', 'requires_acknowledgement')
    search_fields = ('title',)
    raw_id_fields = ('event', 'uploaded_by', 'removed_by', 'replaced_by')


@admin.register(DocumentAcknowledgement)
class DocumentAcknowledgementAdmin(admin.ModelAdmin):
    list_display = ('id', 'document', 'user', 'version', 'acknowledged_at')
    raw_id_fields = ('document', 'user')
