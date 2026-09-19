"""Firestore client factory.

TODO: implement with `google.cloud.firestore.Client`, using settings from src/config.py.
"""

from functools import lru_cache


@lru_cache
def get_firestore_client():
    raise NotImplementedError
