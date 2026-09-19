"""Who may see a gallery, and who may put it in order.

**A gallery is exactly as visible as the thing it hangs off.** That is the whole rule, and it is
written as one predicate per target model rather than a generic `published` check, because the
three targets genuinely answer it differently and a generic check would silently pass a model that
happens not to have the field. An unpublished exercise with a readable gallery would leak the
exercise; getting this wrong is the most expensive mistake available in this app.
"""

from __future__ import annotations

from moderation.services import is_governor_of_course


def target_is_readable(target, user) -> bool:
    """Can this person see the thing the gallery hangs off?"""
    if target is None:
        return False
    app_label = target._meta.app_label
    model = target._meta.model_name

    if (app_label, model) in (('materials', 'material'), ('exercises', 'exercise')):
        if getattr(target, 'published', False):
            return True
        # An unpublished one is still readable by the people who can act on it — the same split
        # every draft in this app uses, so a curator can fix a gallery before the content goes live.
        return bool(user and user.is_authenticated) and can_curate(target, user)

    if (app_label, model) == ('activity', 'post'):
        # `is_visible` is the model's own word for "not tombstoned, not auto-hidden".
        if target.is_visible:
            return True
        return bool(user and user.is_authenticated) and (
            user.is_staff or target.author_id == user.pk
        )

    # A target type nobody has taught this function about is not readable, rather than readable by
    # default. `GALLERY_TARGETS` and this file have to be changed together and the failure of
    # forgetting should be "no gallery" rather than "an unguarded one".
    return False


def can_curate(target, user) -> bool:
    """Ordering, captioning somebody else's picture, and taking one down.

    Adding is open to anybody signed in; this is the narrower right, and it is the one
    `moderation.GovernorApplication` exists to let somebody ask for.
    """
    if not (user and user.is_authenticated):
        return False
    if user.is_staff:
        return True

    app_label = target._meta.app_label
    model = target._meta.model_name

    if (app_label, model) == ('activity', 'post'):
        # A post is one person's own writing, so its pictures are theirs to arrange. There is no
        # governance over an individual post and it would be odd if there were.
        return target.author_id == user.pk

    if (app_label, model) == ('materials', 'material'):
        # Deferred import: `moderation.services` imports `materials`, so a module-level import here
        # would close a loop through this module the moment materials grows a gallery reference.
        from moderation.services import is_governor_of_material

        return is_governor_of_material(user, target)

    if (app_label, model) == ('exercises', 'exercise'):
        return is_governor_of_course(user, target.branch)

    return False
