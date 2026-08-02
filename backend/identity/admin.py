from django.contrib import admin

from .models import CourseGrade, Diploma, EducationProfile, School


@admin.register(School)
class SchoolAdmin(admin.ModelAdmin):
    list_display = ['short_name', 'name', 'country', 'city', 'runs_usos', 'is_active']
    list_filter = ['country', 'is_active']
    search_fields = ['name', 'short_name', 'slug']


@admin.register(EducationProfile)
class EducationProfileAdmin(admin.ModelAdmin):
    list_display = ['user', 'school', 'verification', 'status', 'share_school']
    list_filter = ['verification', 'status', 'share_school', 'share_diploma', 'share_grades']
    search_fields = ['user__username', 'user__email']
    # Read-only on purpose: a verification is a claim an institution made, and an admin quietly
    # flipping one to 'usos' by hand would make the badge mean nothing. Revoking is a different
    # matter and is done by deleting the row or disconnecting through the API.
    readonly_fields = ['verification', 'status', 'usos_user_id', 'usos_student_number']


@admin.register(Diploma)
class DiplomaAdmin(admin.ModelAdmin):
    list_display = ['title', 'profile', 'issued_on']


@admin.register(CourseGrade)
class CourseGradeAdmin(admin.ModelAdmin):
    list_display = ['name', 'profile', 'term', 'value', 'matched_course']
    list_filter = ['scale', 'term']
