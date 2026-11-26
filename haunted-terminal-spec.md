# Haunted Terminal: initial spec

## Goal
A browser game that helps beginners overcome their fear of the Linux terminal. The player is trapped in a haunted shell and banishes a ghost by using real command syntax.

Hackathon category: Costume Contest (polished, haunting UI).

## Tech constraints
- React + Vite, JavaScript
- Frontend only: no backend, no accounts
- All commands are simulated against an in-memory virtual file system. Never execute real shell commands or use eval.
- Progress saved in localStorage; the game still works if storage is unavailable
- Tests: Vitest, plus fast-check for property-based tests
- Only original or properly licensed visuals and sounds

## Commands
`help`, `hint`, `clear`, `reset`, `pwd`, `ls` (`-a`, `-l`), `cd` (relative, absolute, `..`, `~`), `cat`, `grep <word> <file>`, `chmod +x <file>`, `./<script>`

Command history with the up and down arrows. Tab completion for file names. Unknown commands and wrong paths return a realistic error plus a short in-story tip.

## Levels
Each level has a story message, one objective, a win condition, and up to 3 progressive hints.

1. **The Awakening** (`pwd`, `ls`): list the room and report what is there. Win: run `ls` in the starting folder.
2. **The Diary** (`cd`, `cat`): enter the attic and read the diary.
3. **Hidden Bones** (`ls -a`): find and read a hidden file in the cellar.
4. **The Whisper** (`grep`): search a long log for the line containing the ghost's name.
5. **The Exorcism** (`chmod +x`, `./`): make `exorcise.sh` executable and run it. Running it before `chmod` shows "Permission denied".

After level 5, show a victory screen listing the commands learned.

## Interface
- Full-screen retro terminal with a subtle CRT glow and flicker
- The ghost grows more visible as levels progress, then disappears at the end
- Side panel with the current objective, hint button, and level progress
- Sound off by default, with a toggle
- Respect `prefers-reduced-motion`; keep text contrast readable; no rapid flashing

## Architecture
- `engine/`: pure functions for parsing, path resolution, and commands (no React)
- `levels/`: level definitions as data
- `ui/`: React components

## Properties to test
- Any path resolution stays inside the virtual root
- `cd` into a directory followed by `cd ..` returns to the previous directory
- `ls -a` output always includes everything shown by `ls`
- No input string makes the parser throw
- Every level is solvable with its documented commands

## Repository requirements
- Public GitHub repo with an MIT LICENSE file
- Keep `.kiro/` at the root and out of `.gitignore`
- README in English with install, run, and test instructions
