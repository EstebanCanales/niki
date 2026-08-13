---
name: apple-notes
description: "Manage Apple Notes via memo CLI: create, search, edit."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [macos]
metadata:
  hermes:
    tags: [Notes, Apple, macOS, note-taking]
    related_skills: [obsidian]
prerequisites:
  commands: [memo]
---

# Apple Notes

Use `memo` to manage Apple Notes directly from the terminal. Notes sync across all Apple devices via iCloud.

## Prerequisites

- **macOS** with Notes.app
- Install: `brew tap antoniorodr/memo && brew install antoniorodr/memo/memo`
- Grant Automation access to Notes.app when prompted (System Settings → Privacy → Automation)

## When to Use

- User asks to create, view, or search Apple Notes
- Saving information to Notes.app for cross-device access
- Organizing notes into folders
- Exporting notes to Markdown/HTML

## When NOT to Use

- Obsidian vault management → use the `obsidian` skill
- Bear Notes → separate app (not supported here)
- Quick agent-only notes → use the `memory` tool instead

## Quick Reference

### View Notes

```bash
memo notes                        # List all notes with numbered index
memo notes -f "Folder Name"       # Filter by folder
memo notes -s                     # Search notes (interactive fuzzy)
memo notes -v N                   # View note number N from the list
```

### Create Notes

```bash
memo notes -a                     # Interactive editor
memo notes -a "Note Title"        # Quick add with title
```

### Edit Notes

```bash
memo notes -e                     # Interactive selection to edit
```

### Delete Notes

```bash
memo notes -d                     # Interactive selection to delete
```

**Non-interactive deletion workaround:** The `-d` flag prompts for a number interactively. For scripted deletion by title, use AppleScript directly:

```applescript
osascript -e '
tell application "Notes"
    set targetFolder to folder "Notes"
    set noteList to notes of targetFolder
    repeat with i from 1 to count of noteList
        set currentNote to item i of noteList
        if name of currentNote is "TARGET_TITLE" then
            delete currentNote
        end if
    end repeat
end tell
'
```

### Move Notes

```bash
memo notes -m                     # Move note to folder (interactive)
```

### Export Notes

```bash
memo notes -ex                    # Export to HTML/Markdown
```

## Limitations

- Cannot edit notes containing images or attachments (images are preserved at the end)
- Interactive prompts (`-d`, `-e`, `-m`, `-s`) require terminal access; use `pty=true` or AppleScript workarounds for automation
- macOS only — requires Apple Notes.app
- The `memo list` command does not exist; use `memo notes` instead

## Rules

1. Prefer Apple Notes when user wants cross-device sync (iPhone/iPad/Mac)
2. Use the `memory` tool for agent-internal notes that don't need to sync
3. Use the `obsidian` skill for Markdown-native knowledge management
