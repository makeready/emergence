# Sleep

This is a deterministic housekeeping step. No AI call is needed.

## Actions

1. Archive the current `mindset.md` content into `short_term_memory.md` (prepend it)
2. Truncate `short_term_memory.md` if it exceeds the configured max lines (remove oldest content)
3. Clear `raw_notes.md` to a blank template
4. Reset `mindset.md` to a blank template
