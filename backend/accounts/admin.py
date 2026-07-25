from django.contrib import admin

from .models import Profile


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    list_display = ['user', 'display_name', 'preferred_locale', 'is_verified_contributor', 'joined_at']
    list_filter = ['is_verified_contributor', 'preferred_locale']
