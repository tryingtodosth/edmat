"""Small-number suppression for counts that describe PEOPLE.

"3 people signed up in the week of 6 October" on a site this size can be one class, and next to a
date it can be somebody. Below `K_ANONYMITY` (10) such a count leaves the API as `null`, which the
dashboard draws as "<10". Zero is not suppressed — "nobody" identifies nobody.

What is suppressed: active users, registrations, guardian-created accounts, the contribution
funnel, retention cohorts, referrer hosts and client families. What is not: counts about content
(views of a public exercise, comments posted, rows in a queue), because those describe the corpus,
not a person. The stored rollups keep the true value; suppression happens on the way out, so a
change of threshold needs no recount.
"""

# 10, per ANALYTICS-LAW.md §3 ("no cell under k = 10") — stricter than the 5 first sketched, because
# a signup week or a niche branch on a university site is often a single class.
K_ANONYMITY = 10


def k(value: int | None) -> int | None:
    """`value` if it is 0 or at least K, else None (drawn as "<10")."""
    if value is None:
        return None
    return value if value == 0 or value >= K_ANONYMITY else None


def k_rate(numerator: int, denominator: int) -> float | None:
    """A share of people, offered only when both counts it is made of would themselves be shown —
    a rate over a suppressed group would hand back what the suppression took away."""
    if numerator is None or denominator is None or denominator == 0:
        return None
    if k(numerator) is None or k(denominator) is None:
        return None
    return round(numerator / denominator, 4)
