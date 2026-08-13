---
name: macos-disk-cleanup
title: macOS Disk Cleanup
description: Free disk space on macOS by identifying and removing large unused files, caches, and app data.
triggers:
  - "limpiar disco"
  - "free up space"
  - "disk full"
  - "borrar archivos"
  - "no tengo espacio"
  - "cleanup mac"
  - "delete large files"
---

# macOS Disk Cleanup

## Quick Assessment

Start with the big four user directories:

```
du -sh ~/Downloads ~/Desktop ~/Documents ~/Applications 2>/dev/null | sort -rh
```

Then check hidden heavy hitters:

```
du -sh ~/Library/Caches ~/Library/Containers ~/Library/Application\ Support 2>/dev/null | sort -rh
```

## Phase 1: Downloads (safest)

List largest files:

```
find ~/Downloads -maxdepth 1 -type f -exec ls -lh {} + | sort -k5 -rh | head -30
```

Common removable items:
- `.dmg` installers after app installation
- `.zip` archives after extraction
- OS images (Raspberry Pi `.img`, ISOs)
- Old videos, PDFs, installers

## Phase 2: Library/Caches

Show top cache consumers:

```
du -sh ~/Library/Caches/* 2>/dev/null | sort -rh | head -20
```

Safe to delete (apps will rebuild):
- Browser caches (Chrome, Safari, Arc, Vivaldi)
- IDE caches (JetBrains, VSCode, Zed, Cursor)
- Package manager caches (pip, npm, yarn, cargo, gradle)
- Game caches (Steam, Minecraft)
- App-specific caches (Spotify offline, Notion, Discord, Figma)

Avoid deleting while app is running. Some caches (e.g. `com.apple.*` system caches) may be protected.

## Phase 3: Library/Containers

Show top container consumers:

```
du -sh ~/Library/Containers/* 2>/dev/null | sort -rh | head -20
```

Containers hold sandboxed app data. Large ones often include:
- `com.docker.docker` — Docker VM images (can be 10-60 GB)
- `com.zhou.dynamicwallpaper` — downloaded wallpapers
- `net.whatsapp.WhatsApp` — media and backups
- Microsoft Office apps

### Docker special case

If Docker is not running, `docker system prune` will not work. Instead:

```
rm -rf ~/Library/Containers/com.docker.docker/Data/vms
```

This removes the VM disk image directly. Docker will recreate it on next launch.

## Phase 4: Library/Application Support

Show top consumers:

```
du -sh ~/Library/Application\ Support/* 2>/dev/null | sort -rh | head -20
```

Common large items:
- `Claude` — local app data and cache
- `com.openai.atlas` — ChatGPT app data
- `Spotify` — offline music
- Browser profiles (Chrome, Arc, Vivaldi)
- IDE extensions and indexes (Code, JetBrains, Zed)
- Game data (Steam, Minecraft)

## Phase 5: Developer Caches

Check these common locations:

```
du -sh ~/.npm ~/.gradle ~/.cargo ~/.cache/pip ~/Library/Developer/Xcode/DerivedData 2>/dev/null
```

All are safe to delete and will be rebuilt on next use.

## Phase 6: Logs

```
du -sh ~/Library/Logs /var/log 2>/dev/null
```

Safe to clear. System logs in `/var/log` may require `sudo`.

## Protected Directories

Some paths under `~/Library/Containers` and `~/Library/Caches` are SIP-protected or in use:
- `com.apple.*` system services
- Apps currently running
- Microsoft Teams (often locked)

If `rm -rf` fails with "Operation not permitted", skip and move on. Do not force with `sudo` unless explicitly asked.

## Verification

After cleanup, check free space:

```
df -h /
```

And re-check the cleaned directories:

```
du -sh ~/Downloads ~/Library/Caches ~/Library/Containers ~/Library/Application\ Support 2>/dev/null
```

## Pitfalls

1. **Do not delete `.app` bundles from /Applications without confirming the user no longer uses them.**
2. **Do not delete Photos library or iCloud Drive contents.**
3. **Do not delete Time Machine local snapshots with `tmutil` unless asked.**
4. **Always ask before deleting personal files (Documents, Desktop, Movies).**
5. **Docker VMs can only be deleted safely when Docker Desktop is NOT running.**
6. **Some `~/Library/Containers` subdirectories are locked by running apps — handle errors gracefully and continue.**
