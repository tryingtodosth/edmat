from rest_framework import serializers

from .models import ExerciseSet, ExerciseSetItem


class ExerciseSetItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExerciseSetItem
        fields = ['id', 'exercise', 'order']


class ExerciseSetSerializer(serializers.ModelSerializer):
    items = ExerciseSetItemSerializer(source='exercisesetitem_set', many=True, read_only=True)
    exercise_ids = serializers.PrimaryKeyRelatedField(
        source='exercises', many=True, write_only=True, queryset=ExerciseSetItem._meta.get_field('exercise').related_model.objects.all()
    )
    # Same `getattr(obj.author.profile, 'display_name', '') or obj.author.username` pattern
    # community/serializers.py's ReviewSerializer/CommentSerializer already establish — a shared
    # set (retrieve is now public, see ExerciseSetViewSet's own doc comment) is meaningfully more
    # readable as "Kasia's set" than a bare numeric owner id, which is all a plain FK field would
    # otherwise serialize to.
    owner_display_name = serializers.SerializerMethodField()

    class Meta:
        model = ExerciseSet
        fields = ['id', 'owner', 'owner_display_name', 'name', 'items', 'exercise_ids', 'created_at']
        read_only_fields = ['owner']

    def get_owner_display_name(self, obj):
        return getattr(obj.owner.profile, 'display_name', '') or obj.owner.username

    def create(self, validated_data):
        exercises = validated_data.pop('exercises', [])
        exercise_set = ExerciseSet.objects.create(**validated_data)
        for order, exercise in enumerate(exercises):
            ExerciseSetItem.objects.create(exercise_set=exercise_set, exercise=exercise, order=order)
        return exercise_set

    def update(self, instance, validated_data):
        # Written explicitly rather than relying on DRF's default M2M handling — `exercises` goes
        # through a `through` model carrying its own `order` field, which a plain `.set()` would
        # silently leave at its own default (0) for every item, losing whatever order the caller
        # sent. PATCH /api/exercise-sets/:id/ (lib/services/exerciseSets.ts's updateSet) is the one
        # real caller today, sending only `exercise_ids` — `name` support comes along for free.
        exercises = validated_data.pop('exercises', None)
        instance.name = validated_data.get('name', instance.name)
        instance.save()
        if exercises is not None:
            instance.exercisesetitem_set.all().delete()
            for order, exercise in enumerate(exercises):
                ExerciseSetItem.objects.create(exercise_set=instance, exercise=exercise, order=order)
        return instance
