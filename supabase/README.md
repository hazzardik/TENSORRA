# TENSORRA database

The live Supabase project already contains the v0.3 schema.

Core tables:
- profiles
- chats
- messages
- memories
- documents
- document_chunks
- usage_events
- subscriptions
- message_feedback

All public user-data tables have Row Level Security enabled. Training consent is stored as `profiles.allow_training` and defaults to `false`.
