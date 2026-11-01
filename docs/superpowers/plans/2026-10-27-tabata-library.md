# Tabata Library Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. No commits, service restarts or parallel agents are authorized.

**Goal:** Implement the random two-action Tabata design approved in this conversation.
**Architecture:** A small UMD `portal/tabata.js` owns the action catalog, candidate validation and random selection. Existing home-plan/editor/session/performance paths keep their keys and snapshots; runtime selections live in the active session and completed timer records.
**Tech Stack:** Existing vanilla JavaScript, Node test runner, native HTML controls and Playwright CLI.
**Spec:** Approved design below.

## Approved design

- Random/fixed modes, an action library with instructions, demonstrations and tags, and user exclusions.
- Draw two distinct actions when entering a Tabata group. Allow replacement before starting; refresh/pause/rerender never redraw. Keep the pair for the group across outer rounds.
- Retain configured work/rest/rounds, normally20/10×6. Show both actions, current/next cue, and actual chosen actions in history. Avoid the previous completed pair where possible.
- Preserve existing custom fixed intervals, strength doses, XP, RIR, four-day plan and frozen active workouts. Enable random mode in the user's saved three-day plan through the existing state API only after verification.

## Global constraints

- Only D:\projects\thin-muscle-workout; use existing localhost:3001, never start/restart a server.
- No storage-key renaming, database changes, history deletion or Git commit/push.
- UI test writes must be intercepted into an isolated account-state copy.
- Existing media may only be labeled as exact demonstrations when they match; use clearly labeled references or native SVG demonstrations for missing movements.

## Review focus

- Refresh, rerender and added outer rounds retain the pair; stale controls cannot modify another workout.
- Pools with fewer than two choices fail validation; custom fixed names remain supported and escaped.
- Starting, pausing or manually completing locks the selection; timer completion records actions without inventing reps.
- Existing frozen workouts and non-Tabata interval warmups retain their behavior.
- Last rest says completion next, never suggests repeating the last action.

## Tasks

- [x] Add catalog/selection helpers, demonstration assets and meaningful pool/avoidance tests.
- [x] Extend interval configuration validation and editor mode/pool controls; keep legacy fixed intervals compatible.
- [x] Integrate one-time session selection, pre-start replacement, timer cues and performance/history snapshots.
- [x] Verify Node tests, actual mobile/desktop UI including timer transitions, and unchanged real training state.
- [x] Apply only the approved random-mode fields to the user's saved plan, verify readback, document results.

## Evidence and rulings

- 110 Node tests passed; actual editor, interval playback, refresh/pause, history retention and asset-animation checks are recorded in output/playwright/tabata-verification.md.
- Ruling: Existing fixed intervals remain fixed unless selected for the authorized personal-plan update; no automatic migration of other users or frozen workouts.
- Ruling: Four missing movement demonstrations use original animated SVG diagrams, labeled as movement diagrams; existing GIFs are reused unchanged.
- Ruling: Completed choices are copied into session history as well as per-round performance, so trimming detailed performance does not lose the actual pair.
- Personal three-day active plan and its saved counterpart now use random mode (revision6); only thinMuscleHomePlanV1 changed. Existing strength dosing, interval timing, four-day draft and all history/XP keys were verified unchanged.
