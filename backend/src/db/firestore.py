"""Firestore document access helpers.

Keep query/document logic here rather than in services/ or routers/,
so persistence details stay swappable without touching business logic.
TODO: add collection accessors as the data model in docs/DESIGN.md is defined.
"""
