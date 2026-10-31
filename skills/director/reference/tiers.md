# Tiers

A tier is a label on a role or a piece of work. It keeps the roles portable: the label is in the
role file and the request file, and the model is set only where the harness allows it (Claude
Code: the role's `model:` field, or the Agent tool's per-call `model`, which wins over it).

| Tier | Model | Default effort | Use for |
|---|---|---|---|
| light | haiku | low | state files, wide and shallow lookups, output triage, classification |
| standard | sonnet | medium | a scoped change with its tests, deep research, a review, docs, checking a result |
| deep | opus | medium; high to verify | plans, integration and verification, architecture, security review, unclear debugging |

## Effort

Effort sets how much a model reads, tests and verifies, and also how much it adds on its own:
high effort on an open brief invents features nobody asked for. The scope rule in every
building brief (see the director's SKILL.md) keeps high effort going into verification instead.

- Planning: medium. Research of a large unfamiliar area: high (it reads more files).
- Implementing: medium. Integration and verification: high, because it has to cover every area.
- Pass the effort with the Agent tool's `effort` where it exists; the director's skill asks for
  it explicitly, which is what that parameter needs.

## Choosing

- Take the tier from the role file. Override per piece when the piece is clearly lighter or
  harder than the role's usual work, and write the choice in the request's Pieces table.
- Go up a tier when a piece has no done-criteria you can check mechanically, touches security or
  money, or failed once at the lower tier. Go down when the output is a list, a lookup or a copy.
- Research: light only for wide, shallow reads. When the answer depends on noticing a subtle
  detail (bug hunting, unfamiliar code), use standard or deep: haiku's gap is judgment about
  what matters, and the director only sees its summary.
- Where the harness has no per-call model (one model for the whole session), the tier still goes
  in the brief and the request file; it just does not change the model.

## When unsure whether a cheaper tier is enough

Run both for a while on the same kind of piece, compare the results, and write what you found
below (date, kind of piece, tiers tried, which was enough). Do not move a kind of piece down a
tier on a hunch.

## Pipeline against a plain session

Every so often, run the same task through the full pipeline and through one plain Sonnet
session, then compare cost (tokens or plan usage) and rework (how many fixes the user had to ask
for afterwards). Record each run under Findings. Change the triage threshold in the director's
SKILL.md only on findings, not on impressions.

## Findings

Format: `- YYYY-MM-DD | kind of task | what was compared | cost | rework | which was enough`

None yet.
