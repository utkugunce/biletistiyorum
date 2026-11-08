"""Shared directory rules for ticket inventory and person/request folders."""

import re
import unicodedata


def _normalize(name: str) -> str:
    name = str(name).casefold().replace("ı", "i")
    name = "".join(c for c in unicodedata.normalize("NFKD", name)
                   if not unicodedata.combining(c))
    return re.sub(r"[\s_-]+", " ", name).strip()


def is_inventory_directory(name: str) -> bool:
    """Recognize whole directory names, never substrings of a person name."""
    name = _normalize(name)
    if re.fullmatch(r"(?:\d{3}(?: blok)?|blok(?: \d{3})?)", name):
        return True
    return name in {
        "saha", "saha ici", "saha ici a", "saha ici b",
        "biletler", "biletinial", "unassigned", "genel", "havuz",
    }


def assignment_directory_parts(parts):
    """Strip inventory wrappers only before the first person directory.

    Havuz/Person/ZS-1 and 121 BLOK/Person/Genel retain their owner.
    A subgroup named Genel is not an inventory wrapper.
    """
    parts = list(parts)
    while parts and is_inventory_directory(parts[0]):
        parts.pop(0)
    return parts


def classify_ticket_directory(parts):
    parts = assignment_directory_parts(parts)
    if not parts:
        return '', '', 'unassigned'
    group = parts[0]
    subgroup = '/'.join(parts[1:])
    status = 'diger' if _normalize(group) == 'diger' else 'assigned'
    return group, subgroup, status
