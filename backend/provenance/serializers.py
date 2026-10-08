"""Input validation only. The OUTPUT shape is `rules.summaries_for`'s dict and is deliberately not
a ModelSerializer of anything: what a client reads is a derived reading over three tables, not a
row, and a serializer per table would invite a second copy of the formula.
"""

from rest_framework import serializers


class VoteSerializer(serializers.Serializer):
    """How sure you are, in percent. The whole opinion in one field — see `models.AssistanceVote`
    for why there is no second yes/no beside it."""

    confidence = serializers.IntegerField(min_value=0, max_value=100)


class AuthorMarkSerializer(serializers.Serializer):
    assisted = serializers.BooleanField()
    note = serializers.CharField(required=False, allow_blank=True, max_length=2000)


class ScoreLockSerializer(serializers.Serializer):
    value = serializers.IntegerField(min_value=0, max_value=100)
    #: Not blank-able — house rule 6, a refusal carries its reason, and a lock is a refusal to let
    #: the number move.
    reason = serializers.CharField(max_length=2000)
