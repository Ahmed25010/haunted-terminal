# Implementation Plan: Haunted Terminal

## Overview

Implement a browser-based educational game that teaches Linux terminal commands through a horror narrative. The implementation progresses bottom-up: pure engine functions first, then level data, then services, then React UI, and finally CI/CD wiring. Each layer is independently testable before the next is built on top of it.

## Tasks

- [x] 1. Scaffold project structure
  - The workspace root already contains `LICENSE`, `README.md`, and `.kiro/`. Scaffold Vite in-place: run `npm create vite@latest . -- --template react` (the `.` targets the existing directory)
  . If asked about the non-empty directory, choose "Ignore files and continue". Never remove existing files. Do not start the dev server.
  - Install runtime dependencies: `npm install react react-dom`; install dev dependencies: `npm install -D vitest @vitest/coverage-v8 fast-check jsdom @vitejs/plugin-react`
  - Create the directory tree: `src/engine/`, `src/levels/`, `src/services/`, `src/ui/`, `tests/unit/`, `tests/property/`
  - Add `vite.config.js` with `base: '/haunted-terminal/'`, React plugin, and Vitest config block pointing `testEnvironment` to `jsdom` for localStorage and progress-persistence tests; all other tests run in Node environment
  - Add `package.json` scripts: `"dev": "vite"`, `"build": "vite build"`, `"test": "vitest"`, `"test:run": "vitest run"`
  - Create a `.gitignore` that includes `node_modules`, `dist`, and `coverage`; it must NOT include `.kiro`
  - Create `index.html` with a single `<div id="root">` mount point and import of `src/main.jsx`
  - Create `src/main.jsx` that renders `<App />` into `#root`
  - _Requirements: 9.6, 10.3, 11.1_

- [ ] 2. Implement VFS core (`src/engine/vfs.js`)
  - Implement `createVFS(snapshot)` using `structuredClone` to deep-clone the snapshot into `{ root, home: '/home/player' }`
  - Implement `getNode(vfs, absPath)` by walking `children` segments; return `null` if any segment is missing
  - Implement `setNode(vfs, absPath, node)` returning a new VFS with structural sharing (shallow-clone ancestor `children` objects, insert the node at the final segment)
  - Export all three functions from `src/engine/vfs.js`
  - _Requirements: 1.1, 1.6, 1.7, 9.1_

- [ ] 3. Implement path resolver (`src/engine/pathResolver.js`)
  - Implement `resolvePath(vfs, cwd, raw)` following the seven-step algorithm in the design: tilde expansion (only when `raw === '~'` or `raw.startsWith('~/')`), absolute vs. relative base selection, segment processing (`.` no-op, `..` clamped at root, empty no-op, name push), path reconstruction, VFS existence check
  - Return `{ ok: true, path }` or `{ ok: false, error }` — never throw
  - Export `resolvePath` from `src/engine/pathResolver.js`
  - _Requirements: 1.2, 1.3, 1.4, 1.5_

  - [ ] 3.1 Write property test for path confinement (Property 1)
    - **Property 1: Path resolution stays inside VFS root**
    - **Validates: Requirements 1.2, 1.3, 1.4, 1.5, 9.5**
    - File: `tests/property/pathConfinement.property.test.js`
    - Use segment-based `rawPathArb` (segments drawn from `['..', '.', '~', <realistic filename>]`, joined with `/`), `arbitraryVFS()` helper; assert `result.path.startsWith('/')` and `getNode(vfs, result.path) !== null` for every `ok: true` result; `numRuns: 500`

  - [ ] 3.2 Write property test: cd then cd .. round-trip (Property 2)
    - **Property 2: `cd` into a directory followed by `cd ..` returns to the previous directory**
    - **Validates: Requirements 1.3, 3.6, 9.5**
    - File: `tests/property/cdRoundTrip.property.test.js`
    - Use `arbitraryVFSWithDir()` helper (a VFS with at least one immediate child directory); for each generated `(vfs, childDirName)`, execute `cd <childDirName>` from `/home/player`, then `cd ..` from the resulting cwd; assert final cwd equals `/home/player`; `numRuns: 200`

- [ ] 4. Implement command parser (`src/engine/parser.js`)
  - Implement `parseInput(rawString)`:
    - Trim, return `{ ok: false, error: 'Empty input', raw: '' }` for blank input
    - Tokenise by runs of whitespace, respecting single- and double-quoted spans (quoted tokens always go to `args`, never `flags`); return `{ ok: false, error, raw }` for unclosed quotes (never throw)
    - First non-quoted token becomes `cmd` as typed (no lowercasing); if it starts with `./`, set `cmd: './'` and push the remainder as first `args` element
    - Combined shorthand flags (e.g. `-la`) are split into individual flags (`['-l', '-a']`)
    - Remaining unquoted tokens starting with `-` → `flags`; all others → `args`
  - Export `parseInput` from `src/engine/parser.js`
  - _Requirements: 2.1, 2.2, 2.3_

  - [ ] 4.1 Write property test: parser never throws (Property 4)
    - **Property 4: Parser never throws for any input string**
    - **Validates: Requirements 2.1, 2.2, 9.5**
    - File: `tests/property/parserNoThrow.property.test.js`
    - Use `fc.string()`, call `parseInput` inside try/catch, assert no exception and result has boolean `ok`; `numRuns: 1000`

  - [ ]* 4.2 Write property test: quoted token round-trip (Property 5)
    - **Property 5: Quoted token round-trip**
    - **Validates: Requirements 2.3**
    - File: `tests/property/quotedTokens.property.test.js`
    - Arbitrary: `fc.array(fc.string({ minLength: 1 }).filter(s => !s.includes('"') && !s.includes("'")), { minLength: 1, maxLength: 5 })`; format as `cmd "arg1" "arg2" ...`; assert `result.ok`, `result.args.length === args.length`, element-wise equality; `numRuns: 200`

  - [ ]* 4.3 Write unit tests for parser
    - File: `tests/unit/parser.test.js`
    - Cover: `ls -a`, `ls -la`, `ls -al`, `grep word file`, `chmod +x f`, `./exorcise.sh`, quoted arg with spaces, empty string, unclosed quote, unknown command passthrough

- [ ] 5. Implement command handlers (`src/engine/commands.js`)
  - Implement each handler as a pure function `(state, args, flags, levelDef) → ExecutionResult` where `state = { vfs, cwd }`; `ExecutionResult = { ok, output: string[], newVFS, newCwd, action }`
  - `pwd`: output `[cwd]`, no VFS change
  - `ls` / `ls -a` / `ls -l` / `ls -la` / `ls -al`: list directory; `-a` includes dotfiles; `-l` shows executable bit; non-existent path → error + in-story tip
  - `cd`: resolve path, verify target is a directory, update `newCwd`; not a directory → error + tip; path missing → error + tip
  - `cat`: resolve path, verify target is a file, output `content.split('\n')`; path missing or is directory → error + tip
  - `grep <word> <file>`: resolve file, filter lines containing `word` (case-sensitive), output matching lines; path missing or is directory → error + tip
  - `chmod +x <file>`: resolve path, set `executable: true` via `setNode`, return new VFS; unsupported variant → error + tip; path missing → error + tip
  - `./` : resolve script path, check `executable === true`, run script's defined action; not executable → `"bash: ./<file>: Permission denied"` + tip; path missing or not a file → error + tip
    - For `./exorcise.sh` specifically, the script's defined action reads `levelDef.exorcismMessage` and returns it as the output line
  - `help`: output list of all supported commands with brief descriptions
  - `hint`: return `{ ok: true, output: [], action: 'hint', newVFS: state.vfs, newCwd: state.cwd }` (hint text resolved by caller)
  - `clear`: return `{ ok: true, output: [], action: 'clear', newVFS: state.vfs, newCwd: state.cwd }`
  - `reset`: return `{ ok: true, output: [], action: 'reset', newVFS: state.vfs, newCwd: state.cwd }`
  - Unknown command: `"bash: <cmd>: command not found"` + in-story tip, `ok: false`
  - _Requirements: 3.1–3.26_

  - [ ]* 5.1 Write unit tests for command handlers
    - File: `tests/unit/commands.test.js`
    - Use a minimal VFS fixture; cover each command's happy path, each error branch, executable bit visibility in `ls -l`, `chmod +x` only restriction, `./` permission denied

  - [ ] 5.2 Write property test: `ls -a` superset (Property 3)
    - **Property 3: `ls -a` output is a superset of `ls` output**
    - **Validates: Requirements 3.3, 3.4, 3.5, 9.5**
    - File: `tests/property/lsSuperset.property.test.js`
    - Use `arbitraryVFS()` and `arbitraryExistingDirPath()` (path guaranteed present in generated VFS); execute both `ls` and `ls -a`; extract entry names from output; assert every plain-`ls` name appears in `ls -a` output; `numRuns: 200`

- [ ] 6. Implement win condition evaluator (`src/engine/winCondition.js`)
  - Implement `checkWin(levelDef, state, execResult, parsed)` returning `boolean`
  - Guard: `execResult.ok === true` required for all win types
  - `ls_in_dir`: `parsed.cmd === 'ls'`, resolved directory path equals `winCondition.dir`, `execResult.ok`
  - `cat_file`: `parsed.cmd === 'cat'`, `resolvePath` of first arg equals `winCondition.targetAbsPath`
  - `grep_match`: `parsed.cmd === 'grep'`, first arg equals `winCondition.word`, resolved file equals `winCondition.file`, `execResult.output.length > 0`
  - `exec_script`: `parsed.cmd === './'`, `getNode(vfs, scriptPath).executable === true`, resolved script path equals `winCondition.script`
  - Export `checkWin` from `src/engine/winCondition.js`
  - _Requirements: 5.3, 5.6, 5.7, 5.8, 5.9, 5.10_

  - [ ]* 6.1 Write unit tests for win conditions
    - File: `tests/unit/winCondition.test.js`
    - Positive and negative examples for all five win types; verify that `ok: false` execution never satisfies a condition

- [ ] 8. Implement tab completion (`src/engine/tabComplete.js`)
  - Implement `tabComplete(vfs, cwd, partial)` following the design algorithm: split on last `/`, handle `./` prefix, resolve directory for the prefix, list children, filter by stem (case-sensitive), exclude dotfiles when stem doesn't start with `.`, append `/` to directory matches
  - Return array of full completion strings; single match means caller replaces token; multiple means caller displays list
  - Export `tabComplete` from `src/engine/tabComplete.js`
  - _Requirements: 4.3, 4.4_

  - [ ]* 8.1 Write unit tests for tab completion
    - File: `tests/unit/tabComplete.test.js`
    - Cover: partial match, no match, single match, multiple matches, `./` prefix, hidden file exclusion when stem lacks `.`, hidden file inclusion when stem starts with `.`, partial path segment (e.g. `attic/di`)

- [ ] 7. Implement command dispatcher (`src/engine/index.js`)
  - Build a `Map<string, HandlerFn>` keyed by command name mapping to handlers from `commands.js`
  - Implement `executeCommand(state, parsed, levelDef)`: if `parsed.ok === false`, return error `ExecutionResult`; otherwise look up `parsed.cmd` in the dispatch table and delegate; unknown command falls through to the unknown-command handler
  - Re-export `createVFS`, `resolvePath`, `getNode`, `setNode`, `parseInput`, `executeCommand`, `checkWin`, `tabComplete` from `src/engine/index.js` as the single public API
  - _Requirements: 1.1, 3.1, 9.1_

- [ ] 9. Implement level data (`src/levels/`)
  - Create `src/levels/index.js` that exports `levels` as a 5-element array; each element conforms to the level schema in the design
  - **Level 1 — The Awakening**: `vfsSnapshot` contains `/home/player/` with a few files; `winCondition: { type: 'ls_in_dir', dir: '/home/player' }`; teaches `ls`; 3 hints
  - **Level 2 — The Diary**: `vfsSnapshot` contains `/home/player/attic/diary.txt`; `winCondition: { type: 'cat_file', targetAbsPath: '/home/player/attic/diary.txt' }`; teaches `cd`, `cat`; 3 hints
  - **Level 3 — Hidden Bones**: `vfsSnapshot` contains `/home/player/cellar/.bones.txt` (hidden file); `winCondition: { type: 'cat_file', targetAbsPath: '/home/player/cellar/.bones.txt' }`; teaches `ls -a`, hidden files; 3 hints
  - **Level 4 — The Whisper**: `vfsSnapshot` contains `/home/player/haunt.log` with at least one line containing `Eleanor`; `winCondition: { type: 'grep_match', word: 'Eleanor', file: '/home/player/haunt.log', caseSensitive: true }`; teaches `grep`; 3 hints
  - **Level 5 — The Exorcism**: `vfsSnapshot` contains `/home/player/exorcise.sh` (not executable initially); `winCondition: { type: 'exec_script', script: '/home/player/exorcise.sh' }`; teaches `chmod +x`, `./`; 3 hints
    - Level 5's `vfsSnapshot` includes a field `exorcismMessage: string` on the level data object (not inside the VFS itself); when `./exorcise.sh` executes successfully, the engine outputs this message as the script's result. Store the exorcism message on the level definition and pass it through to the script action so the command handler can retrieve and output it.
  - Each level has `commandsTaught: string[]` listing only the commands that level introduces
  - _Requirements: 5.1, 5.2, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11_

  - [ ]* 9.1 Write unit tests for level data
    - File: `tests/unit/levelData.test.js`
    - Assert each level has: `id`, `title`, `story`, `objective`, `commandsTaught`, exactly 3 `hints`, valid `vfsSnapshot`, valid `winCondition` with correct `type`

  - [ ]* 9.2 Write property test: VFS reset round-trip (Property 6)
    - **Property 6: VFS reset produces identical structure**
    - **Validates: Requirements 1.6**
    - File: `tests/property/vfsReset.property.test.js`
    - Use `fc.integer({ min: 0, max: 4 })` to pick a level, call `createVFS(level.vfsSnapshot)` twice, deep-equal the two results; `numRuns: 50`

  - [ ] 9.3 Write level solvability integration test
    - **Validates: Requirements 5.1, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11**
    - File: `tests/unit/levelSolvability.test.js`
    - For each of the five levels: initialise engine state from level data, replay the documented win sequence of commands through `executeCommand` + `checkWin`, assert that `checkWin` returns `true` on the final command
    - Win sequences to replay:
      - Level 1: `ls`
      - Level 2: `cd attic` then `cat diary.txt`
      - Level 3: `cd cellar` then `ls -a` then `cat .bones.txt`
      - Level 4: `grep Eleanor haunt.log`
      - Level 5: `chmod +x exorcise.sh` then `./exorcise.sh`

- [ ] 10. Checkpoint — engine complete
  - Ensure all tests pass: `npm run test:run`
  - Ask the user if any questions arise before proceeding to services and UI.

- [ ] 11. Implement localStorage service (`src/services/storage.js`)
  - Implement `saveProgress(progress)`: `localStorage.setItem('haunted-terminal-progress', JSON.stringify(progress))` wrapped in try/catch (silent on error)
  - Implement `loadProgress()`: get item, parse JSON, validate shape (`currentLevel` integer 0–4, `completedLevels` array of integers 0–4), return null on any failure or invalid shape
  - `gameOver` is NOT persisted — it is derived from `completedLevels` at runtime
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [ ]* 11.1 Write unit tests for localStorage service
    - File: `tests/unit/localStorage.test.js`
    - Requires jsdom environment; cover: save/load round-trip, missing key returns null, exception returns null, invalid `currentLevel` type returns null, out-of-range value returns null, invalid `completedLevels` element returns null

  - [ ]* 11.2 Write property test: progress persistence round-trip (Property 7)
    - **Property 7: Progress persistence round-trip**
    - **Validates: Requirements 6.1, 6.2**
    - File: `tests/property/progressPersistence.property.test.js`
    - Requires jsdom environment; arbitrary: `fc.record({ currentLevel: fc.integer({min:0,max:4}), completedLevels: fc.array(fc.integer({min:0,max:4}), {maxLength:5}) })`; assert `loadProgress()` returns object deeply equal to saved value; `numRuns: 200`

- [ ] 12. Implement Web Audio service (`src/services/audio.js`)
  - Implement `createAudioEngine()` returning `{ playLevelAdvance(levelIndex) }`
  - Lazy `AudioContext` creation on first call to `playLevelAdvance` (browser autoplay policy compliance); if creation or resume throws, catch silently and return without playing
  - `playLevelAdvance(levelIndex)`: schedule a 3-note descending minor arpeggio using `OscillatorNode` + `GainNode` per note; sawtooth wave, 80 ms per note, exponential gain ramp to silence; use the frequency table from the design
  - Zero external audio files — all sound synthesized via Web Audio API
  - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [ ] 13. Implement `useGameState` hook (`src/ui/useGameState.js`)
  - Own the full game state: `{ currentLevel, completedLevels, hintsUsed, terminalLines, vfs, cwd, gameOver, audioEnabled, history, historyIdx }`
  - On mount: call `loadProgress()`, restore `currentLevel` and `completedLevels`, call `createVFS(levels[currentLevel].vfsSnapshot)`, set `cwd: '/home/player'`; derive `gameOver` from `completedLevels.length === 5`
  - On level start (initial mount and each level advance), append the new level's `story` text to `terminalLines` so the player sees the narrative when the level loads
  - `submitCommand(raw)`: parse → execute → check win → update state; on `action: 'clear'` clear `terminalLines`; on `action: 'reset'` reinitialise VFS and clear lines; on `action: 'hint'` resolve and append next unused hint (or repeat last if all used); on win advance level, call `saveProgress`, play level-advance sound if `audioEnabled`
  - On a win condition being met: reset `vfs` to a fresh clone of the next level's `vfsSnapshot`, reset `cwd` to `/home/player`, and reset `hintsUsed` to `0` before appending the next level's story
  - After Level 5 is completed: set `currentLevel` to `4` (keep it at the last level index, do not increment to 5), add `4` to `completedLevels` if not already present, so `completedLevels` holds exactly the indices 0–4 without duplicates; derive `gameOver` as `completedLevels` containing all five indices 0–4
  - `handleHint()`: dispatch `hint` command on behalf of player
  - `toggleAudio()`: flip `audioEnabled`
  - `handlePlayAgain()`: clear localStorage (`localStorage.removeItem('haunted-terminal-progress')`), reset state to Level 1
  - Command history: append to `history` on each submit, reset `historyIdx = -1`; expose `historyUp()` and `historyDown()` for `InputLine`
  - _Requirements: 3.22, 3.23, 3.24, 3.25, 5.3, 5.4, 6.1, 6.2, 8.2_

- [ ] 14. Implement React UI components (`src/ui/`)
  - [ ] 14.1 `CRTWrapper` (`src/ui/CRTWrapper.jsx`)
    - CSS-only CRT effect: scanline `::before` overlay, `flicker` keyframe animation, `text-shadow` glow on terminal text, `box-shadow` on container
    - `@media (prefers-reduced-motion: reduce)` disables animation and hides scanline overlay
    - _Requirements: 7.1, 7.6_

  - [ ] 14.2 `GhostOverlay` (`src/ui/GhostOverlay.jsx`)
    - SVG or CSS ghost figure; opacity derived from `currentLevel` via lookup table: 0.08, 0.22, 0.42, 0.65, 0.85, then 0 on victory with a 1.5 s CSS transition
    - _Requirements: 7.4, 7.5_

  - [ ] 14.3 `SidePanel` (`src/ui/SidePanel.jsx`)
    - Display current level `objective`, a "Hint" button that calls `onHint`, and level-progress dots (5 dots, completed ones highlighted)
    - _Requirements: 7.2, 7.3_

  - [ ] 14.4 `InputLine` (`src/ui/InputLine.jsx`)
    - Controlled text input; on Enter call `onSubmit(value)` and clear input
    - Up arrow: call `onHistoryUp()`, set input to returned value
    - Down arrow: call `onHistoryDown()`, set input to returned value (or clear if `-1`)
    - Tab: call `tabComplete(vfs, cwd, currentToken)`, if single match replace token, if multiple display below input; prevent default Tab behaviour
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [ ] 14.5 `TerminalPane` (`src/ui/TerminalPane.jsx`)
    - Scrollable output log rendering `terminalLines` as monospace text; auto-scrolls to bottom on new output
    - Renders `InputLine` at the bottom with `cwd` prompt
    - Ensure text contrast ratio ≥ 4.5:1 against terminal background; no rapidly flashing content
    - _Requirements: 7.1, 7.7, 7.8_

  - [ ] 14.6 `AudioToggle` (`src/ui/AudioToggle.jsx`)
    - Button showing muted/unmuted state; calls `onToggle`; default state is muted
    - _Requirements: 8.1, 8.2_

  - [ ] 14.7 `VictoryScreen` (`src/ui/VictoryScreen.jsx`)
    - Full-screen overlay shown when `gameOver === true`
    - Lists `commandsTaught` from each of the 5 levels (not all commands typed)
    - "Play again" button calls `onPlayAgain`
    - _Requirements: 5.4, 5.5_

  - [ ] 14.8 `App` (`src/ui/App.jsx`)
    - Mount `useGameState`; conditionally render `VictoryScreen` when `gameOver`; otherwise render `CRTWrapper > TerminalPane + SidePanel + GhostOverlay + AudioToggle`
    - Pass only required state slices as props to each child
    - _Requirements: 7.1, 7.2_

- [ ] 15. Checkpoint — full application wired
  - Ensure all tests pass: `npm run test:run`
  - Verify development server starts: `npm run dev`
  - Ask the user if any questions arise before proceeding to CI/CD.

- [ ] 16. Add GitHub Actions workflow and README
  - [ ] 16.1 Create `.github/workflows/deploy.yml`
    - Trigger: `push` to `main`
    - Steps: `actions/checkout@v4`, `actions/setup-node@v4` (Node 24, `cache: 'npm'`), `npm ci`, `npm run test:run`, `npm run build`, `peaceiris/actions-gh-pages@v4` publishing `./dist`
    - Permissions: `contents: write`
    - Commit `package-lock.json` to repository so `npm ci` can reproduce the dependency tree
    - _Requirements: 11.2_

  - [ ] 16.2 Update `README.md`
    - Sections: project description, installation (`npm install`), running dev server (`npm run dev`), running tests (`npm run test:run`), live GitHub Pages URL
    - Written in English
    - _Requirements: 10.2, 11.3_

- [ ] 17. Final checkpoint — full pipeline verified
  - Ensure all tests pass: `npm run test:run`
  - Verify `npm run build` completes without errors
  - Ask the user if any questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP.
- Each task references specific requirements for traceability.
- All `engine/` code must remain free of React imports; side effects (localStorage, Web Audio) live in `services/` only.
- Checkpoints at tasks 10, 15, and 17 ensure each major layer is verified before the next is built.
- Property tests require `arbitraryVFS()`, `arbitraryVFSWithDir()`, and `arbitraryExistingDirPath()` helpers — define these in `tests/property/helpers.js` and import them across property test files.
- The `jsdom` test environment is required only for `localStorage.test.js` and `progressPersistence.property.test.js`; configure this via Vitest's per-file `@vitest-environment jsdom` comment or a separate `vitest.config.jsdom.js`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2", "4.1", "4.2", "4.3"] },
    { "id": 2, "tasks": ["3.1", "3.2", "5.1", "5.2"] },
    { "id": 3, "tasks": ["6.1", "7", "8.1"] },
    { "id": 4, "tasks": ["9.1", "9.2", "9.3"] },
    { "id": 5, "tasks": ["10"] },
    { "id": 6, "tasks": ["11.1", "11.2", "12"] },
    { "id": 7, "tasks": ["13"] },
    { "id": 8, "tasks": ["14.1", "14.2", "14.3", "14.4"] },
    { "id": 9, "tasks": ["14.5", "14.6", "14.7"] },
    { "id": 10, "tasks": ["14.8"] },
    { "id": 11, "tasks": ["15"] },
    { "id": 12, "tasks": ["16.1", "16.2"] },
    { "id": 13, "tasks": ["17"] }
  ]
}
```
