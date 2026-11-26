# Design Document

## Overview

Haunted Terminal is a single-page, frontend-only browser game built with React and Vite. The player interacts with a full-screen retro terminal to solve five horror-themed puzzles, each of which requires a specific Linux command. All command execution runs against an in-memory Virtual File System (VFS); no real shell commands are ever called and `eval` is never used.

The architecture splits into three directories: `engine/` (pure functions, zero React imports), `levels/` (static data modules), and `ui/` (React components). This boundary makes the core logic independently testable with Vitest and fast-check without mounting any components.

```
haunted-terminal/
├── src/
│   ├── engine/          # VFS, parser, command handlers, path resolver, tab completion (pure functions only)
│   ├── levels/          # Level data modules
│   ├── services/        # localStorage persistence, Web Audio API synthesis (side effects)
│   ├── ui/              # React components
│   └── main.jsx         # Vite entry point
├── public/              # Static assets (font, favicon)
├── tests/               # Vitest + fast-check test suite
├── vite.config.js
├── index.html
├── package.json
└── .github/workflows/   # GitHub Pages CI/CD
```

---

## Architecture

### Layers and data flow

```mermaid
flowchart TD
    Player -->|keystroke| InputLine
    InputLine -->|raw string| useTerminal
    useTerminal -->|parse| Parser
    Parser -->|ParseResult| useTerminal
    useTerminal -->|dispatch| CommandDispatcher
    CommandDispatcher -->|reads/writes| VFS
    CommandDispatcher -->|reads| LevelData
    CommandDispatcher -->|emits| OutputLine[]
    useTerminal -->|win check| WinEvaluator
    WinEvaluator -->|advance level| GameState
    GameState -->|persist| LocalStorage
    GameState -->|render| TerminalPane
    GameState -->|render| SidePanel
    GameState -->|render| GhostOverlay
```

### Key design decisions

**Pure engine boundary.** `engine/` exports only plain functions that take values and return values. No side effects, no globals. This makes every engine function trivially unit-testable and property-testable.

**Side effects in services/.** `localStorage` and Web Audio API calls live in `services/`, not `engine/`. This keeps `engine/` as a pure-function module with no I/O, making every engine function testable without mocks.

**Dispatch table over switch.** The command dispatcher uses a `Map<string, HandlerFn>` keyed by command name. Adding a new command means adding one entry to the table, with no changes to dispatch logic.

**Immutable VFS snapshots.** Each level stores its initial VFS as a plain JS object literal (deep-clonable with `structuredClone`). On level start or `reset`, the engine clones this snapshot — no mutation of the master data.

**React state lives in one hook.** A single `useGameState` hook owns the full game state tree. Child components receive only the slices they render, passed via props. No global store or context is required at this scale.

---

## Components and Interfaces

### Engine public API (`engine/index.js`)

```js
// VFS operations
createVFS(snapshot)         → VFSState
resolvePath(vfs, cwd, raw)  → { ok: true, path: string } | { ok: false, error: string }
getNode(vfs, absPath)       → VFSNode | null
setNode(vfs, absPath, node) → VFSState   // returns new VFS (structural share)

// Parser
parseInput(rawString)       → ParseResult

// Command execution
executeCommand(state, parsed, levelDef) → ExecutionResult

// Win condition evaluation
checkWin(levelDef, state, execResult) → boolean

// Tab completion
tabComplete(vfs, cwd, partial) → string[]
```

**Types:**

```js
// ParseResult
{ ok: true,  cmd: string, args: string[], flags: string[] }
{ ok: false, error: string, raw: string }

// ExecutionResult
{
  ok: boolean,                             // false if the command produced an error
  output: string[],
  newVFS: VFSState,
  newCwd: string,
  action: null | 'clear' | 'reset' | 'hint'  // non-null for side-effectful commands
}

// Progress
{ currentLevel: number, completedLevels: number[] }
```

### Services API

```js
// services/storage.js
saveProgress(progress)  → void
loadProgress()          → Progress | null   // returns null if missing, unreadable, or invalid shape

// services/audio.js
createAudioEngine()     → { playLevelAdvance: (levelIndex: number) => void }
```

### React components (`ui/`)

| Component | Props | Responsibility |
|---|---|---|
| `App` | — | Mounts `useGameState`, passes slices to children |
| `TerminalPane` | `lines, cwd` | Scrollable output log + `InputLine` |
| `InputLine` | `cwd, onSubmit, history` | Text input, up/down history, Tab completion |
| `SidePanel` | `level, hintsUsed, onHint` | Objective, hint button, level progress dots |
| `GhostOverlay` | `level` | SVG/CSS ghost whose opacity is derived from `level` |
| `VictoryScreen` | `onPlayAgain` | End-game screen, commands-learned list, restart button |
| `AudioToggle` | `enabled, onToggle` | Sound on/off button, Web Audio synthesis |
| `CRTWrapper` | `children` | CSS-only CRT glow/flicker wrapper |

### `useGameState` hook interface

```js
const {
  terminalLines,   // string[]
  cwd,             // string
  currentLevel,    // 0-indexed number
  hintsUsed,       // number
  gameOver,        // boolean
  audioEnabled,    // boolean
  submitCommand,   // (raw: string) => void
  toggleAudio,     // () => void
  handleHint,      // () => void
  handlePlayAgain, // () => void
} = useGameState();
```

---

## Data Models

### VFS node

Every node in the virtual file system is one of two shapes:

```js
// Directory node
{
  type: 'dir',
  children: { [name: string]: VFSNode }   // names never contain '/'
}

// File node
{
  type: 'file',
  content: string,
  executable: boolean     // default false; set by chmod +x
}
```

The entire VFS is represented as a single root directory node, accessed by walking the `children` tree with a resolved absolute path.

### VFS state

```js
{
  root: VFSNode,      // root directory (type: 'dir')
  home: '/home/player'
}
```

### Path resolution algorithm

```
resolvePath(vfs, cwd, raw):
  1. Tilde expansion: if raw equals '~' exactly, or starts with '~/', replace '~' with vfs.home.
     A '~' that appears elsewhere in the string (e.g. 'foo~bar') is treated as a literal character.
  2. If raw starts with '/', set workingPath = []  (absolute from root)
     Else, start from segments of cwd split by '/'
  3. Split remaining raw by '/' and process each segment:
       '.'  → no-op
       '..' → pop last segment from workingPath
               IF workingPath is empty, stay empty (clamp at root)
       ''   → no-op (artefact of leading/trailing '/')
       name → push name onto workingPath
  4. Reconstruct absolute path: '/' + workingPath.join('/')
     (root is just '/')
  5. Verify the path exists in the VFS tree
     If not found, return { ok: false, error: `No such file or directory: ${raw}` }
     If found, return { ok: true, path: absolutePath }
```

The clamp-at-root rule (step 3, `..`) satisfies Requirement 1.3 without special-casing any command.

### Parser output types

```js
// Success
{ ok: true, cmd: 'ls', args: [], flags: ['-a', '-l'] }   // ls -la
{ ok: true, cmd: './', args: ['exorcise.sh'], flags: [] } // ./exorcise.sh
{ ok: true, cmd: 'cat', args: ['/home/player/diary.txt'], flags: [] }
{ ok: true, cmd: 'grep', args: ['Eleanor', 'haunt.log'], flags: [] }

// Error
{ ok: false, error: 'Empty input', raw: '' }
{ ok: false, error: "Unclosed quote in: cat \"file", raw: 'cat "file' }
```

**Tokeniser rules:**
1. Trim leading/trailing whitespace.
2. If empty, return `{ ok: false, error: 'Empty input' }`.
3. Split by runs of whitespace, respecting single- and double-quoted spans. Quoted tokens (delimited by `"` or `'`) are always treated as `args`, even if they begin with `-`.
4. The first non-quoted token becomes `cmd` exactly as typed — it is NOT lowercased. If the first token starts with `./`, then `cmd` is `"./"` and the remainder of that token (the path after `./`) becomes the first element of `args`.
5. Combined shorthand flags like `-la` or `-al` are split into individual flags: `-la` → `['-l', '-a']`. Each individual character after the leading `-` becomes a separate flag entry.
6. Remaining unquoted tokens that start with `-` → `flags` (after splitting combined flags); all other unquoted tokens → `args`.
7. If a quote is opened but never closed, return a structured error (never throw).

### Level data schema

```js
{
  id: number,                   // 1–5
  title: string,                // e.g. "The Awakening"
  story: string,                // narrative shown on level start
  objective: string,            // shown in SidePanel
  commandsTaught: string[],     // listed on VictoryScreen
  hints: [string, string, string],  // exactly 3; shown one at a time
  vfsSnapshot: VFSNode,         // deep-cloned on level start
  winCondition: WinCondition
}
```

### Win condition schema

```js
// Level 1: ls in starting directory
{ type: 'ls_in_dir', dir: '/home/player' }

// Level 2: cat on the diary file (any valid resolved path)
{ type: 'cat_file', targetAbsPath: '/home/player/attic/diary.txt' }

// Level 3: cat on hidden file in cellar
{ type: 'cat_file', targetAbsPath: '/home/player/cellar/.bones.txt' }

// Level 4: grep with specific word on specific file, output non-empty
{ type: 'grep_match', word: 'Eleanor', file: '/home/player/haunt.log', caseSensitive: true }

// Level 5: chmod then execute
{ type: 'exec_script', script: '/home/player/exorcise.sh' }
```

**Win evaluator logic per type:**

- `ls_in_dir`: parsed cmd is `ls` (any flags), resolved directory matches `dir`, execution succeeded.
- `cat_file`: parsed cmd is `cat`, resolved argument path equals `targetAbsPath`.
- `grep_match`: parsed cmd is `grep`, first arg equals `word`, resolved file path equals `file`, `ExecutionResult.output` is non-empty.
- `exec_script`: the VFS file at `script` has `executable: true` **and** parsed cmd is `./` with the script path.

> **Note:** All win condition checks additionally require `execResult.ok === true`. A command that produced an error cannot satisfy a win condition even if the parsed command matches.

For Level 2 specifically, the win evaluator resolves the player's argument through `resolvePath` before comparing to `targetAbsPath`. This handles any relative path the player types (from `/home/player`, from `/home/player/attic`, or as an absolute path).

### Game state shape

```js
{
  currentLevel: number,        // 0-indexed (0 = Level 1)
  completedLevels: number[],   // indices of completed levels
  hintsUsed: number,           // hints used in current level (0–3)
  terminalLines: string[],     // all output lines this session
  vfs: VFSState,               // current mutable VFS
  cwd: string,                 // current working directory
  // gameOver is derived: completedLevels.includes(0,1,2,3,4) — not stored in localStorage
  gameOver: boolean,
  audioEnabled: boolean        // defaults to false
}
```

`gameOver` is not persisted. On reload, it is re-derived from `completedLevels`. If `completedLevels` contains all 5 indices (0–4), the VictoryScreen is shown immediately — the player does not have to replay Level 5.

### LocalStorage persistence

Key: `haunted-terminal-progress`

Value (JSON):
```json
{ "currentLevel": 2, "completedLevels": [0, 1] }
```

Only `currentLevel` and `completedLevels` are persisted; VFS and terminal output are always rebuilt from level data on load. All `localStorage` calls are wrapped in a try/catch; on any error the game proceeds with default state (Requirement 6.3–6.4). These functions live in `services/storage.js`.

### Command history model

A session-only array in React state (not persisted):

```js
history: string[],   // commands in order of submission
historyIdx: number   // current up/down cursor (-1 = not browsing)
```

- Up arrow: decrement `historyIdx` (clamp at 0); display `history[historyIdx]`.
- Down arrow: increment `historyIdx`; if past end, clear input and set `historyIdx = -1`.
- On submit: append to `history`, reset `historyIdx = -1`.

### Tab completion algorithm

```
tabComplete(vfs, cwd, partial):
  1. Split partial on the last '/'
       prefix = everything up to and including last '/'  (may be '')
       stem   = everything after last '/'
  2. If partial starts with './', treat './' as prefix, rest as stem
  3. Resolve directory for prefix:
       '' or no slash → list cwd
       otherwise      → resolvePath(vfs, cwd, prefix)
  4. List children of that directory node
  5. Filter children whose names start with stem (case-sensitive)
  5a. Hidden-file filter: if stem does NOT start with '.', exclude entries whose names start with '.'.
      If stem starts with '.', include all matching entries (hidden and non-hidden).
  6. Return matches as [ prefix + name ] strings
     For directories, append '/' to each match
  7. If exactly one match, return it (caller replaces current token)
     If multiple, return all (caller displays them, does not replace)
```

### Ghost opacity arc

| Level | Ghost opacity |
|---|---|
| Start (Level 1) | 0.08 |
| Level 2 | 0.22 |
| Level 3 | 0.42 |
| Level 4 | 0.65 |
| Level 5 (before win) | 0.85 |
| Victory | 0 (fade-out transition) |

The `GhostOverlay` component derives opacity from `currentLevel` with a lookup table. On victory it transitions to 0 with a 1.5 s CSS transition.

### CRT effect

Implemented purely in CSS (no JS animation frames):

```css
/* Scanline overlay */
.crt::before {
  content: '';
  position: fixed; inset: 0;
  background: repeating-linear-gradient(
    to bottom,
    transparent 0px, transparent 2px,
    rgba(0,0,0,0.08) 2px, rgba(0,0,0,0.08) 4px
  );
  pointer-events: none; z-index: 10;
}

/* Flicker animation */
@keyframes flicker {
  0%, 97%, 100% { opacity: 1; }
  98%           { opacity: 0.94; }
  99%           { opacity: 0.98; }
}
.crt { animation: flicker 8s infinite; }

/* Respect reduced motion */
@media (prefers-reduced-motion: reduce) {
  .crt { animation: none; }
  .crt::before { display: none; }
}
```

The glow effect uses a CSS `text-shadow` on terminal text (`0 0 8px currentColor`) plus a `box-shadow` on the terminal container.

### Web Audio API sound generation (`services/audio.js`)

All audio is synthesized at runtime — no external files are loaded (Requirement 8.4).

```js
// services/audio.js
function createAudioEngine() {
  let ctx = null;

  function ensureContext() {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') ctx.resume();
  }

  function playLevelAdvance(levelIndex) {
    ensureContext();
    // Descending minor arpeggio, 3 notes, 80 ms each
    const freqs = [[220, 261, 311], [196, 233, 277], [174, 207, 246],
                   [164, 196, 233], [146, 174, 207]];
    const notes = freqs[levelIndex] ?? freqs[0];
    notes.forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sawtooth'; osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.09;
      gain.gain.setValueAtTime(0.15, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      osc.start(t); osc.stop(t + 0.26);
    });
  }

  return { playLevelAdvance };
}
```

The `AudioContext` is created lazily on the first user interaction to comply with browser autoplay policies.

### GitHub Pages deployment

**`vite.config.js`:**

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/haunted-terminal/',   // must match GitHub repo name
  build: { outDir: 'dist' }
});
```

**`.github/workflows/deploy.yml`:**

```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'npm'
      - run: npm ci
      - run: npm run test:run
      - run: npm run build
      - uses: peaceiris/actions-gh-pages@v4
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./dist
```

`package-lock.json` must be committed to the repository so that `npm ci` can reproduce the exact dependency tree in CI.

The workflow triggers on every push to `main`, builds the Vite project, and pushes `dist/` to the `gh-pages` branch.

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Path resolution stays inside VFS root

*For any* VFS state, any current working directory, and any raw path string (including strings composed entirely of `../` segments, strings starting with `/`, strings starting with `~`, and empty strings), when `resolvePath` returns `{ ok: true }`, the resulting absolute path MUST start with `/` and every segment of that path MUST correspond to a node that exists within the VFS tree rooted at `/`.

**Validates: Requirements 1.2, 1.3, 1.4, 1.5, 9.5**

---

### Property 2: `cd` into a directory followed by `cd ..` returns to the previous directory

*For any* VFS state and any current working directory `cwd`, if `cd <childDir>` succeeds (changing cwd to `newCwd`), then executing `cd ..` from `newCwd` MUST return the working directory to `cwd`.

**Validates: Requirements 1.3, 3.6, 9.5**

---

### Property 3: `ls -a` output is a superset of `ls` output

*For any* VFS directory, the set of entry names returned by `ls -a` MUST contain every entry name returned by `ls` (without flags) on the same directory.

**Validates: Requirements 3.3, 3.4, 3.5, 9.5**

---

### Property 4: Parser never throws

*For any* input string (including the empty string, strings with unmatched quotes, strings with only whitespace, very long strings, and strings containing non-ASCII characters), calling `parseInput` MUST return a value of type `ParseResult` and MUST NOT throw an exception.

**Validates: Requirements 2.1, 2.2, 9.5**

---

### Property 5: Quoted token round-trip

*For any* array of non-empty argument strings (including strings that contain spaces, tabs, single quotes, or double quotes that do not interfere with the outer quoting), formatting them as `cmd "arg1" "arg2" ...` and then calling `parseInput` MUST return a `ParseResult` with `ok: true` whose `args` array matches the original array element-by-element.

**Validates: Requirements 2.3**

---

### Property 6: VFS reset round-trip

*For any* level definition, calling `createVFS(level.vfsSnapshot)` twice MUST produce two VFS states that are structurally identical (deep equality on all node types, content, and executable flags), regardless of any mutations applied to the first instance.

**Validates: Requirements 1.6**

---

### Property 7: Progress persistence round-trip

*For any* `Progress` object (with `currentLevel` in [0, 4] and `completedLevels` a subset of [0, 4]), calling `saveProgress(p)` followed immediately by `loadProgress()` MUST return an object deeply equal to `p`.

**Validates: Requirements 6.1, 6.2**

---

## Error Handling

### Parser errors

The parser returns a structured `{ ok: false, error: string, raw: string }` value for all invalid input. It never throws. Callers must always check `result.ok` before accessing `result.cmd`.

### Command execution errors

Each command handler returns an `ExecutionResult` whose `output` array may contain error lines. The dispatcher never throws; instead it returns an error output for unknown commands or bad arguments. Error messages follow the pattern:

```
bash: <cmd>: command not found
# followed by an in-story tip line, e.g.:
# "The ghost whispers: maybe try 'help' first?"
```

Specific error patterns per command:

| Situation | Message pattern |
|---|---|
| Unknown command | `bash: <cmd>: command not found` + tip |
| Path does not exist | `<cmd>: <path>: No such file or directory` + tip |
| cd target is not a dir | `cd: not a directory: <path>` + tip |
| cat/grep target is not a file | `<cmd>: <path>: Is a directory` + tip |
| chmod unsupported variant | `chmod: invalid mode — only chmod +x is supported` + tip |
| `./` on non-executable | `bash: ./<file>: Permission denied` + tip |
| grep: file missing | `grep: <file>: No such file or directory` + tip |

### LocalStorage errors

All reads and writes to `localStorage` are wrapped in try/catch blocks:

```js
function saveProgress(progress) {
  try {
    localStorage.setItem('haunted-terminal-progress', JSON.stringify(progress));
  } catch (_) { /* silent — game continues without persistence */ }
}

function loadProgress() {
  try {
    const raw = localStorage.getItem('haunted-terminal-progress');
    if (!raw) return null;
    const data = JSON.parse(raw);
    // Validate shape: currentLevel must be integer 0–4,
    // completedLevels must be an array of integers in [0–4]
    if (
      typeof data.currentLevel !== 'number' ||
      !Number.isInteger(data.currentLevel) ||
      data.currentLevel < 0 || data.currentLevel > 4 ||
      !Array.isArray(data.completedLevels) ||
      !data.completedLevels.every(v => Number.isInteger(v) && v >= 0 && v <= 4)
    ) return null;
    return data;
  } catch (_) { return null; }
}
```

On any error, the game starts at Level 1 with no saved progress and displays no error to the player (Requirement 6.3).

### AudioContext errors

The `AudioContext` is created lazily. If the browser blocks it or throws, the error is caught and audio is silently disabled. The toggle button remains functional but plays nothing.

---

## Testing Strategy

### Tooling

- **Vitest** — test runner for all unit and property tests
- **fast-check** — property-based testing library for JavaScript
- Run tests with: `npm test` (watch) or `npm run test:run` (single-pass for CI)

### Unit tests (`tests/unit/`)

Unit tests cover specific examples, edge cases, and integration between engine components. They should NOT duplicate what property tests already verify universally.

Targeted areas:

| File | What it tests |
|---|---|
| `parser.test.js` | Specific parse outputs: `ls -a`, `grep word file`, `chmod +x f`, quoted args, empty string |
| `pathResolver.test.js` | Specific path strings: absolute, `~`, `.`, `..` at root, multi-segment relative |
| `commands.test.js` | Each command handler with a minimal VFS fixture: correct output, error messages, executable flag |
| `winCondition.test.js` | Each of the 5 win conditions: positive and negative examples |
| `tabComplete.test.js` | Partial match, no match, single match, multiple matches, `./` prefix, hidden files |
| `localStorage.test.js` | Save/load cycle, missing key returns null, exception returns null, invalid shape returns null — run with jsdom environment or localStorage mock |
| `levelData.test.js` | Each level has required fields: title, story, objective, 3 hints, vfsSnapshot |

### Property-based tests (`tests/property/`)

Each property test runs a minimum of 100 iterations (fast-check default is 100; set explicitly via `{ numRuns: 100 }` or higher where warranted).

Each test is tagged with a comment in the format:
`// Feature: haunted-terminal, Property N: <property text>`

**Property 1 — Path confinement** (`pathConfinement.property.js`):

```js
// Feature: haunted-terminal, Property 1: path resolution stays inside VFS root
const pathSegmentArb = fc.oneof(
  fc.constant('..'),
  fc.constant('.'),
  fc.constant('~'),
  fc.stringMatching(/^[a-z0-9_.-]{1,12}$/)   // realistic filename characters
);
const rawPathArb = fc.array(pathSegmentArb, { minLength: 0, maxLength: 8 })
  .map(segs => segs.join('/'));

fc.assert(fc.property(
  arbitraryVFS(),
  rawPathArb,
  (vfs, raw) => {
    const result = resolvePath(vfs, '/home/player', raw);
    if (!result.ok) return true;  // rejected paths are fine
    return result.path.startsWith('/') && getNode(vfs, result.path) !== null;
  }
), { numRuns: 500 });
```

**Property 2 — `cd`/`cd ..` round-trip** (`cdRoundTrip.property.js`):

```js
// Feature: haunted-terminal, Property 2: cd into a directory then cd .. returns to previous cwd
fc.assert(fc.property(
  arbitraryVFSWithDir(),   // VFS guaranteed to have at least one subdirectory
  (vfs, cwd, childDir) => {
    const after = executeCommand(state, parse(`cd ${childDir}`));
    const back  = executeCommand({...state, cwd: after.newCwd}, parse('cd ..'));
    return back.newCwd === cwd;
  }
), { numRuns: 200 });
```

**Property 3 — `ls -a` superset** (`lsSuperset.property.js`):

```js
// Feature: haunted-terminal, Property 3: ls -a output is a superset of ls output
fc.assert(fc.property(
  arbitraryVFS(),
  arbitraryExistingDirPath(),   // path guaranteed to exist in the generated VFS
  (vfs, dir) => {
    const state = { vfs, cwd: '/home/player' };
    const plain = executeCommand(state, parseInput(`ls ${dir}`), mockLevel);
    const all   = executeCommand(state, parseInput(`ls -a ${dir}`), mockLevel);
    if (!plain.ok || !all.ok) return true;
    // Compare entry names (strip formatting from ls -l output if needed)
    const plainNames = plain.output.map(extractName);
    const allNames   = all.output.map(extractName);
    return plainNames.every(name => allNames.includes(name));
  }
), { numRuns: 200 });
```

**Property 4 — Parser no-throw** (`parserNoThrow.property.js`):

```js
// Feature: haunted-terminal, Property 4: parser never throws for any input string
fc.assert(fc.property(
  fc.string(),
  (input) => {
    let result;
    try { result = parseInput(input); } catch { return false; }
    return result !== undefined &&
           (result.ok === true || result.ok === false);
  }
), { numRuns: 1000 });
```

**Property 5 — Quoted token round-trip** (`quotedTokens.property.js`):

```js
// Feature: haunted-terminal, Property 5: quoted token round-trip
fc.assert(fc.property(
  fc.array(
    fc.string({ minLength: 1 }).filter(s => !s.includes('"') && !s.includes("'")),
    { minLength: 1, maxLength: 5 }
  ),
  (args) => {
    const raw = 'cmd ' + args.map(a => `"${a}"`).join(' ');
    const result = parseInput(raw);
    return result.ok && result.args.length === args.length &&
           result.args.every((a, i) => a === args[i]);
  }
), { numRuns: 200 });
```

**Property 6 — VFS reset round-trip** (`vfsReset.property.js`):

```js
// Feature: haunted-terminal, Property 6: VFS reset produces identical structure
fc.assert(fc.property(
  arbitraryLevelIndex(),
  (levelIdx) => {
    const level = levels[levelIdx];
    const vfs1 = createVFS(level.vfsSnapshot);
    const vfs2 = createVFS(level.vfsSnapshot);
    return deepEqual(vfs1, vfs2);
  }
), { numRuns: 50 });
```

**Property 7 — Progress persistence round-trip** (`progressPersistence.property.js`):

```js
// Requires jsdom environment (set in vitest.config.js) or a localStorage mock
// so that localStorage calls do not throw in the Node test environment.
fc.assert(fc.property(
  fc.record({
    currentLevel:    fc.integer({ min: 0, max: 4 }),
    completedLevels: fc.array(fc.integer({ min: 0, max: 4 }), { maxLength: 5 })
  }),
  (progress) => {
    saveProgress(progress);
    const loaded = loadProgress();
    return loaded !== null &&
           loaded.currentLevel === progress.currentLevel &&
           loaded.completedLevels.length === progress.completedLevels.length &&
           loaded.completedLevels.every((v, i) => v === progress.completedLevels[i]);
  }
), { numRuns: 200 });
```

### Accessibility and visual checks

- Text contrast is validated manually using browser DevTools against the 4.5:1 WCAG AA threshold (Requirement 7.7).
- `prefers-reduced-motion` behaviour is manually verified in a browser with the media feature emulated.
- No automated visual regression suite is included in the initial build; snapshot tests for components are out of scope for MVP.

### CI test command

```yaml
- run: npm run test:run
```

`package.json` script: `"test:run": "vitest run"` — single-pass, no watch mode, exits with non-zero code on failure.
