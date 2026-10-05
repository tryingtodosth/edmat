# <Step letter>. <Title> — brief for one agent

<!-- Header block: the integrator fills these in at launch. -->

| | |
|---|---|
| **Model** | Opus (every step of this cycle runs on Opus, owner decision 2026-10-05) |
| **Branch** | `learn/<letter>-<app>` |
| **Worktree** | `/Projects/edmat/.claude/worktrees/learn-<letter>-<app>/` |
| **Ports** | API `813x`, Vite `523x` |
| **Prep commit** | `<hash>` |
| **Boards** | `/Projects/edmat-boards/` — your `doing.md` entry is already written |
| **Node 24** | `export PATH=/home/bob/.cache/edmat-tools/node24/bin:$PATH` |

## Read first
`prompts/README.md` §4 (the always-list, in order) and §5 (the rules), then `prompts/00-DESIGN.md`.

## The task
<What to build, in the words a reader of the finished thing would use.>

## What "finished" means
<A checklist another agent could verify without you.>

## Context — what you need and where it is
| Need | Where | Why |
|---|---|---|
| | | |

## Shapes fixed in advance
<API paths, model names, hook module names other steps build against. Do not rename.>

## Left open, by design
<What you are explicitly not building. Name it on the board.>

## Verify
<The exact commands and scripts, with your ports. Numbers in the board entry.>
