# Tiers

A tier is a label on a role or a piece of work. It keeps the roles portable: the label is in the
role file and the request file, and the model is set only where the harness allows it (Claude
Code: the role's `model:` field, or the Agent tool's per-call `model`, which wins over it).

| Tier | Model | Use for |
|---|---|---|
| light | haiku | state files, lookups, output triage, classification |
| standard | sonnet | a scoped change, a review, tests, docs, checking a result |
| deep | opus | specs, architecture, security review, unclear debugging, writing that matters |

## Choosing

- Take the tier from the role file. Override per piece when the piece is clearly lighter or
  harder than the role's usual work, and write the choice in the request's Pieces table.
- Go up a tier when a piece has no done-criteria you can check mechanically, touches security or
  money, or failed once at the lower tier. Go down when the output is a list, a lookup or a copy.
- Where the harness has no per-call model (one model for the whole session), the tier still goes
  in the brief and the request file; it just does not change the model.

## When unsure whether a cheaper tier is enough

Run both for a while on the same kind of piece, compare the results, and write what you found
below (date, kind of piece, tiers tried, which was enough). Do not move a kind of piece down a
tier on a hunch.

## Findings

None yet.
