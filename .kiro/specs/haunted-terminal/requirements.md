# Requirements Document

## Introduction

Haunted Terminal is a browser-based educational game that teaches Linux terminal commands through a horror/ghost story narrative. The player is trapped in a haunted shell and must banish a ghost by using real Linux command syntax across five progressive levels. The game runs entirely in the browser with no backend, simulating all commands against an in-memory virtual file system.

## Glossary

- **Game**: The Haunted Terminal browser application.
- **Player**: The end user interacting with the Game.
- **Terminal**: The on-screen component that accepts Player input and displays output.
- **Command**: A text string the Player enters into the Terminal (e.g., `ls`, `cd`, `cat`).
- **Virtual_File_System (VFS)**: The in-memory tree structure that simulates a Linux file system; no real OS commands are ever executed.
- **Parser**: The pure function that tokenises and validates a raw input string into a structured command representation.
- **Engine**: The collection of pure functions (no React) in `engine/` responsible for parsing, path resolution, and command execution against the VFS.
- **Path_Resolver**: The Engine sub-component that resolves relative, absolute, `..`, and `~` paths within the VFS.
- **Level**: A self-contained game stage with a story message, one objective, a win condition, and up to three progressive hints.
- **Win_Condition**: The specific command execution that completes a Level.
- **Ghost**: The visual entity whose opacity increases with each Level and disappears on victory.
- **Side_Panel**: The UI panel displaying the current objective, hint button, and level-progress indicator.
- **Victory_Screen**: The end-game screen shown after Level 5 is completed.
- **LocalStorage**: The browser's `localStorage` API used to persist progress.
- **CRT_Effect**: The CSS animation that simulates a retro cathode-ray tube monitor (glow, flicker).

---

## Requirements

### Requirement 1: Virtual File System

**User Story:** As a Player, I want all commands to run against a safe simulated file system, so that I can learn Linux commands without risk of harming my real computer.

#### Acceptance Criteria

1. THE Engine SHALL execute all commands exclusively against the Virtual_File_System and SHALL never invoke real shell commands or use `eval`.
2. THE Path_Resolver SHALL confine all resolved paths to within the VFS root; any path that would escape the root SHALL be rejected with an error message.
3. WHEN the Player uses `..` at the VFS root, THE Path_Resolver SHALL keep the current directory at the root rather than returning an error, matching standard Linux behaviour.
4. WHEN the Player provides an absolute path beginning with `/`, THE Path_Resolver SHALL resolve it relative to the VFS root.
5. WHEN the Player uses `~` in a path, THE Path_Resolver SHALL resolve `~` to the VFS home directory.
6. THE VFS SHALL be initialised fresh from level data on each Level start and on `reset`.
7. THE VFS home directory SHALL be `/home/player`, and each Level SHALL start with the Player's current working directory set to `/home/player`.

---

### Requirement 2: Command Parser

**User Story:** As a Player, I want the game to understand the commands I type, so that I receive accurate feedback even when I make mistakes.

#### Acceptance Criteria

1. THE Parser SHALL accept any non-empty input string and SHALL return either a structured command representation or a descriptive error; THE Parser SHALL never throw an unhandled exception.
2. WHEN the Player enters a command with unrecognised syntax, THE Parser SHALL return a structured error value rather than throwing.
3. THE Parser SHALL tokenise input by splitting on whitespace and SHALL support quoted strings as single tokens.

---

### Requirement 3: Supported Commands

**User Story:** As a Player, I want a defined set of Linux commands to work correctly, so that I build real terminal skills.

#### Acceptance Criteria

1. THE Engine SHALL support the following commands: `help`, `hint`, `clear`, `reset`, `pwd`, `ls`, `ls -a`, `ls -l`, `ls -la`, `ls -al`, `cd`, `cat`, `grep`, `chmod`, and `./`.
2. WHEN the Player runs `pwd`, THE Engine SHALL output the current working directory path within the VFS.
3. WHEN the Player runs `ls` in a directory, THE Engine SHALL list all non-hidden entries in that directory.
4. WHEN the Player runs `ls -a` in a directory, THE Engine SHALL list all entries including hidden files (those whose names begin with `.`).
5. WHEN the Player runs `ls -a`, THE Engine SHALL include every entry that `ls` without flags would return.
6. WHEN the Player runs `cd <path>`, THE Engine SHALL change the current working directory to the resolved path if it exists and is a directory.
7. IF the Player runs `cd` with a path that does not exist, THEN THE Engine SHALL output a realistic error message and a short in-story tip.
8. WHEN the Player runs `cat <file>`, THE Engine SHALL output the full text content of the specified file.
9. IF the Player runs `cat` on a path that does not exist or is not a file, THEN THE Engine SHALL output a realistic error message and a short in-story tip.
10. WHEN the Player runs `grep <word> <file>`, THE Engine SHALL output every line in the file that contains the specified word.
11. IF the Player runs `grep` with a file path that does not exist or is not a file, THEN THE Engine SHALL output a realistic error message and a short in-story tip.
12. WHEN the Player runs `chmod +x <file>`, THE Engine SHALL mark the specified VFS file as executable.
13. THE Engine SHALL accept `chmod +x` only; any other `chmod` variant SHALL return a realistic error message and a short in-story tip.
14. IF the Player runs `chmod` on a path that does not exist, THEN THE Engine SHALL output a realistic error message and a short in-story tip.
15. IF the Player runs `./<script>` on a file that is not marked executable, THEN THE Engine SHALL output "Permission denied" and a short in-story tip.
16. WHEN the Player runs `./<script>` on an executable file, THE Engine SHALL run the script's defined action within the VFS.
17. IF the Player runs `./` with a path that does not exist or is not a file, THEN THE Engine SHALL output a realistic error message and a short in-story tip.
18. IF the Player runs `ls` with a path that does not exist, THEN THE Engine SHALL output a realistic error message and a short in-story tip.
19. THE Engine SHALL accept `ls -la` and `ls -al` as equivalent to `ls -a -l` (combined flags), listing all entries including hidden files in long format.
20. WHEN the Player runs `ls -l` or `ls -la`/`ls -al`, THE Engine SHALL display the executable permission bit for each entry so that the effect of `chmod +x` is visible.
21. WHEN the Player runs `help`, THE Engine SHALL output a list of available commands with brief descriptions.
22. WHEN the Player runs `hint` and an unused hint for the current Level is available, THE Engine SHALL output the next unused hint for the current Level, up to three hints per Level.
23. WHEN the Player runs `hint` and all hints for the current Level have already been shown, THE Engine SHALL repeat the last hint.
24. WHEN the Player runs `clear`, THE Engine SHALL clear the Terminal output history.
25. WHEN the Player runs `reset`, THE Engine SHALL reinitialise the current Level, restoring the VFS and clearing Terminal output.
26. IF the Player enters an unknown command, THEN THE Engine SHALL output a realistic "command not found" error message and a short in-story tip.

---

### Requirement 4: Command History and Tab Completion

**User Story:** As a Player, I want to recall previous commands and auto-complete file names, so that the Terminal feels like a real shell.

#### Acceptance Criteria

1. WHEN the Player presses the Up arrow key in the Terminal input, THE Terminal SHALL display the previous command in the session history.
2. WHEN the Player presses the Down arrow key in the Terminal input, THE Terminal SHALL display the next command in the session history.
3. WHEN the Player presses Tab, THE Terminal SHALL attempt to complete the partial token against VFS entry names, including completion of partial path segments (e.g. `attic/di`) and completion after `./`.
4. IF multiple completions exist for a Tab press, THEN THE Terminal SHALL display all matching options without altering the current input.

---

### Requirement 5: Game Levels

**User Story:** As a Player, I want five progressive levels with a story and clear objectives, so that I learn commands in a guided narrative sequence.

#### Acceptance Criteria

1. THE Game SHALL contain exactly five Levels played in sequence: The Awakening, The Diary, Hidden Bones, The Whisper, and The Exorcism.
2. EACH Level SHALL have a story message, one objective description, a Win_Condition, and between one and three progressive hints.
3. WHEN the Player fulfils the Win_Condition of a Level, THE Game SHALL advance to the next Level.
4. WHEN the Player completes Level 5, THE Game SHALL display the Victory_Screen.
5. THE Victory_Screen SHALL list the commands taught by each of the five Levels (not all commands the player happened to type) and SHALL display a "Play again" button that clears all saved progress and restarts the Game from Level 1.
6. WHEN the Player is on Level 1 (The Awakening) and runs `ls` in the starting folder, THE Game SHALL register the Win_Condition as met.
7. WHEN the Player is on Level 2 (The Diary) and runs `cat` on the diary file using any valid path (relative from any directory or absolute), THE Game SHALL register the Win_Condition as met.
8. WHEN the Player is on Level 3 (Hidden Bones) and runs `cat` on the hidden file in the cellar directory, THE Game SHALL register the Win_Condition as met.
9. WHEN the Player is on Level 4 (The Whisper) and runs `grep` with the ghost's name (as revealed in the level's story) on the log file, with a case-sensitive match, and the output contains the target line, THE Game SHALL register the Win_Condition as met.
10. WHEN the Player is on Level 5 (The Exorcism) and runs `chmod +x exorcise.sh` followed by `./exorcise.sh`, THE Game SHALL register the Win_Condition as met.
11. EACH Level SHALL be completable using only the commands documented for that Level.

---

### Requirement 6: Progress Persistence

**User Story:** As a Player, I want my progress saved automatically, so that I can close the browser and resume from where I left off.

#### Acceptance Criteria

1. THE Game SHALL save the Player's current Level and completed Levels to LocalStorage after each Level completion.
2. WHEN the Player reopens the Game, THE Game SHALL restore the saved Level and progress from LocalStorage if available.
3. IF LocalStorage is unavailable or throws an error, THEN THE Game SHALL continue operating without persistence and SHALL not display an error to the Player.
4. THE Game SHALL function fully when LocalStorage is blocked or quota-exceeded.

---

### Requirement 7: Terminal User Interface

**User Story:** As a Player, I want a full-screen retro terminal aesthetic, so that the game feels immersive and atmospheric.

#### Acceptance Criteria

1. THE Game SHALL render a full-screen Terminal styled with a CRT_Effect including subtle glow and flicker animations.
2. THE Game SHALL display a Side_Panel containing the current Level objective, a hint button, and a Level progress indicator.
3. WHEN the Player clicks the hint button, THE Game SHALL execute the `hint` command on behalf of the Player.
4. THE Ghost visual SHALL increase in opacity with each Level completed, beginning nearly invisible at Level 1.
5. WHEN the Player completes Level 5, THE Ghost visual SHALL disappear from the interface.
6. THE Game SHALL respect the `prefers-reduced-motion` media query by disabling or reducing CRT_Effect animations when it is set.
7. THE Game SHALL maintain a text contrast ratio of at least 4.5:1 against the terminal background at all times.
8. THE Game SHALL not display any rapidly flashing content that could trigger photosensitive reactions.

---

### Requirement 8: Audio

**User Story:** As a Player, I want optional atmospheric sound effects, so that I can enjoy the horror ambiance without being forced into it.

#### Acceptance Criteria

1. THE Game SHALL initialise with all audio muted by default.
2. THE Game SHALL provide a sound toggle control that enables and disables audio playback.
3. WHEN audio is enabled and the Player advances a Level, THE Game SHALL generate and play an atmospheric sound effect using the Web Audio API, without loading any external audio files.
4. THE Game SHALL generate all audio programmatically via the Web Audio API and SHALL NOT load or bundle any external audio files.

---

### Requirement 9: Codebase Structure and Quality

**User Story:** As a developer, I want a well-structured codebase with property-based tests, so that the game is maintainable and its core logic is verifiable.

#### Acceptance Criteria

1. THE Engine code SHALL reside in an `engine/` directory and SHALL contain only pure functions with no React dependencies.
2. THE Level definitions SHALL reside in a `levels/` directory as data modules.
3. THE React components SHALL reside in a `ui/` directory.
4. THE Game SHALL include a Vitest test suite covering Engine functions.
5. THE Game SHALL include fast-check property-based tests verifying that: any path resolution stays inside the VFS root; `cd` into a directory followed by `cd ..` returns to the previous directory path; `ls -a` output always contains every entry that `ls` returns; and no input string causes THE Parser to throw.
6. THE Game SHALL be buildable and runnable with `npm install` and `npm run dev` using React and Vite.

---

### Requirement 10: Repository and Licensing

**User Story:** As a contributor or judge, I want an open-source repository with clear setup instructions, so that I can inspect, run, and evaluate the Game.

#### Acceptance Criteria

1. THE Game SHALL be hosted in a public GitHub repository containing an MIT LICENSE file.
2. THE Game repository SHALL include a README written in English that covers installation, running the development server, and running the test suite.
3. THE Game repository SHALL contain the `.kiro/` directory at the repository root and SHALL not list `.kiro/` in `.gitignore`.
4. THE Game SHALL only use visual assets that are original or carry a license permitting their use.

---

### Requirement 11: GitHub Pages Deployment

**User Story:** As a Player or judge, I want to play the Game directly in the browser from a public URL, so that no local installation is required.

#### Acceptance Criteria

1. THE Game SHALL be deployable to GitHub Pages using the correct Vite `base` path configuration matching the repository name.
2. THE Game repository SHALL include a GitHub Actions workflow that builds and deploys the Game to GitHub Pages on each push to the main branch.
3. THE README SHALL include the live GitHub Pages URL where the Game can be played.
