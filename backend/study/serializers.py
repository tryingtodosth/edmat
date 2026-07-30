from rest_framework import serializers

from exercises.models import Exercise

from .models import ExerciseSet, ExerciseSetItem


class ExerciseSetItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExerciseSetItem
        fields = ['id', 'exercise', 'order', 'include_hint', 'include_answer', 'include_solution']


class ExerciseSetItemOptionSerializer(serializers.Serializer):
    """Write-only input for `ExerciseSetSerializer.item_options` below — a real, plain
    `serializers.Serializer` (not a ModelSerializer) since this never reads/writes an
    `ExerciseSetItem` directly itself; `create`/`update` above resolve each entry against whichever
    item row already exists for that exercise. Deliberately a SEPARATE input from `exercise_ids`
    rather than folding these three flags into that field's own shape — `exercise_ids` is "which
    exercises, in what order" (unchanged since this feature didn't exist), this is "what to include
    for each," an orthogonal, optional concern a caller can send with, or without, ever touching the
    other."""

    exercise = serializers.PrimaryKeyRelatedField(queryset=Exercise.objects.all())
    include_hint = serializers.BooleanField(default=False)
    include_answer = serializers.BooleanField(default=False)
    include_solution = serializers.BooleanField(default=False)


class ExerciseSetSerializer(serializers.ModelSerializer):
    items = ExerciseSetItemSerializer(source='exercisesetitem_set', many=True, read_only=True)
    exercise_ids = serializers.PrimaryKeyRelatedField(
        source='exercises', many=True, write_only=True, queryset=ExerciseSetItem._meta.get_field('exercise').related_model.objects.all()
    )
    item_options = ExerciseSetItemOptionSerializer(many=True, write_only=True, required=False)
    # Same `getattr(obj.author.profile, 'display_name', '') or obj.author.username` pattern
    # community/serializers.py's ReviewSerializer/CommentSerializer already establish — a shared
    # set (retrieve is now public, see ExerciseSetViewSet's own doc comment) is meaningfully more
    # readable as "Kasia's set" than a bare numeric owner id, which is all a plain FK field would
    # otherwise serialize to.
    owner_display_name = serializers.SerializerMethodField()

    class Meta:
        model = ExerciseSet
        fields = [
            'id',
            'slug',
            'owner',
            'owner_display_name',
            'name',
            'items',
            'exercise_ids',
            'item_options',
            'is_public',
            'created_at',
        ]
        # `slug` is also `editable=False` on the model itself (auto-generated, never user-chosen),
        # which already makes DRF treat it as read-only automatically — listed here too so that's
        # explicit rather than relying on a model-field detail a future reader might not notice.
        read_only_fields = ['owner', 'slug']

    def get_owner_display_name(self, obj):
        return getattr(obj.owner.profile, 'display_name', '') or obj.owner.username

    def _apply_item_options(self, exercise_set, item_options):
        """Applies each `{exercise, include_hint, include_answer, include_solution}` entry onto
        whichever `ExerciseSetItem` row already exists for that exercise in this set — a no-op for
        an exercise id not actually in the set (nothing to apply it to), rather than an error, since
        the caller's own `exercise_ids` is what decides set MEMBERSHIP; this only ever adjusts
        per-item flags for items that already exist."""
        by_exercise = {item.exercise_id: item for item in exercise_set.exercisesetitem_set.all()}
        for option in item_options:
            item = by_exercise.get(option['exercise'].pk)
            if item is None:
                continue
            # `.get(..., False)` rather than direct indexing — a real bug, not a defensive
            # guess: `BooleanField(default=False)` did NOT populate a key for an omitted field in
            # a plain (non-Model) nested `Serializer`'s validated_data the way a ModelSerializer
            # field does, caught by a real KeyError the first time a test sent a partial option
            # dict (only `include_hint`) rather than all three flags explicitly.
            item.include_hint = option.get('include_hint', False)
            item.include_answer = option.get('include_answer', False)
            item.include_solution = option.get('include_solution', False)
            item.save(update_fields=['include_hint', 'include_answer', 'include_solution'])

    def create(self, validated_data):
        exercises = validated_data.pop('exercises', [])
        item_options = validated_data.pop('item_options', None)
        exercise_set = ExerciseSet.objects.create(**validated_data)
        for order, exercise in enumerate(exercises):
            ExerciseSetItem.objects.create(exercise_set=exercise_set, exercise=exercise, order=order)
        if item_options:
            self._apply_item_options(exercise_set, item_options)
        return exercise_set

    def update(self, instance, validated_data):
        # Written explicitly rather than relying on DRF's default M2M handling — `exercises` goes
        # through a `through` model carrying its own `order` field, which a plain `.set()` would
        # silently leave at its own default (0) for every item, losing whatever order the caller
        # sent. PATCH /api/exercise-sets/:id/ (lib/services/exerciseSets.ts's updateSet) is the one
        # real caller today, sending only `exercise_ids` or `is_public` — `name` support comes
        # along for free.
        exercises = validated_data.pop('exercises', None)
        item_options = validated_data.pop('item_options', None)
        instance.name = validated_data.get('name', instance.name)
        instance.is_public = validated_data.get('is_public', instance.is_public)
        instance.save()
        if exercises is not None:
            instance.exercisesetitem_set.all().delete()
            for order, exercise in enumerate(exercises):
                ExerciseSetItem.objects.create(exercise_set=instance, exercise=exercise, order=order)
        if item_options:
            self._apply_item_options(instance, item_options)
        return instance
