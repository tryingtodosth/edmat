from rest_framework import serializers

from .models import CourseGrade, Diploma, EducationProfile, School


class SchoolSerializer(serializers.ModelSerializer):
    runs_usos = serializers.BooleanField(read_only=True)

    class Meta:
        model = School
        fields = ['slug', 'name', 'short_name', 'country', 'city', 'grade_scale', 'runs_usos']


class DiplomaSerializer(serializers.ModelSerializer):
    class Meta:
        model = Diploma
        fields = ['id', 'title', 'level', 'programme', 'issued_on', 'final_grade']


class CourseGradeSerializer(serializers.ModelSerializer):
    branch_slug = serializers.SlugField(source='matched_course.slug', read_only=True, default=None)

    class Meta:
        model = CourseGrade
        fields = ['id', 'code', 'name', 'term', 'ects', 'value', 'scale', 'branch_slug']


class EducationProfileSerializer(serializers.ModelSerializer):
    """The owner's own view. Everything imported is visible here regardless of consent — consent
    governs what OTHER people see (`standing.public_view`), never what you can see about yourself."""

    school = serializers.SlugRelatedField(slug_field='slug', read_only=True)
    school_label = serializers.CharField(read_only=True)
    usos_connected = serializers.BooleanField(read_only=True)
    diplomas = DiplomaSerializer(many=True, read_only=True)
    grades = CourseGradeSerializer(many=True, read_only=True)

    class Meta:
        model = EducationProfile
        fields = [
            'school',
            'school_label',
            'other_school_name',
            'verification',
            'status',
            'verified_at',
            'programme',
            'study_year',
            'usos_connected',
            'usos_student_number',
            'usos_connected_at',
            'usos_last_synced_at',
            'usos_scopes',
            'share_school',
            'share_diploma',
            'share_grades',
            'diplomas',
            'grades',
        ]
        read_only_fields = [
            'verification',
            'status',
            'verified_at',
            'usos_student_number',
            'usos_connected_at',
            'usos_last_synced_at',
            'usos_scopes',
        ]
