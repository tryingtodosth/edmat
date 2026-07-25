from django.contrib import admin

from .models import ExerciseSet, ExerciseSetItem


class ExerciseSetItemInline(admin.TabularInline):
    model = ExerciseSetItem
    extra = 0


@admin.register(ExerciseSet)
class ExerciseSetAdmin(admin.ModelAdmin):
    list_display = ['name', 'owner', 'created_at']
    inlines = [ExerciseSetItemInline]
