# Core-crew sources

These files are the inputs for `scripts/build_core_crew.py`. Do not hand-edit the generated host trees; change the sources and regenerate.

## Skills

Canonical L1 role text for Probot, Fred, and Data, copied read-only from the archived `lucidIT-LLC/o-matic-agency` pack at **1.12.6** (commit `81a128f0`, 2026-11-27), including each skill's `reference/` companions that the skill files link to.

The skill headers still name the Agency package and the persona version they were exported from. Those signatures are newer than the September 2026 server gold snapshot below. The skill files are the shipped role text.

## Gold metadata

`gold.public.json` is a public-safe extract of `lucidIT-LLC/o-matic-server` `tools/roster_gold.json` (exported 2026-09-28). It keeps identity, published persona version, archetypes, voice, character bible, and lane boundaries for Probot, Fred, and Data only.

It omits catalog embeddings, tool inventories, evaluation criteria, provenance, assets, and runtime-contract deployment evidence. Re-extract with:

```
python3 -B scripts/build_core_crew.py --extract-gold /path/to/roster_gold.json
```

## Not included

Specialist add-ons, the server operating guide (not present in the Agency 1.12.6 skill tree), and Grok-host skills stay out of this cut.
