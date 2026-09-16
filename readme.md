# Bookmarks Folders Bridge

Move folders between the Zen Browser tab sidebar and the bookmarks bar, preserving their full nested structure.

## Features

- **Tab folder → Bookmarks:** Right-click any folder or subfolder in the tab sidebar → "Guardar en Marcadores" → choose which bookmarks folder to save it into. Subfolders and all open tabs are preserved as bookmarks.

- **Bookmarks → Tab folder:** Right-click any folder in the bookmarks bar → "Abrir como carpeta de pestañas" → choose the workspace and optionally a target folder to nest it into. All bookmarks are opened as pinned tabs inside the recreated folder structure.

## Requirements

- Zen Browser with Sine mod manager
- `sine.allow-unsafe-js` set to `true` in `about:config`

## Usage

### Saving a tab folder to bookmarks
1. Right-click on any folder in the tab sidebar
2. Click **"📌 Guardar en Marcadores…"**
3. Select the destination bookmark folder from the tree
4. Click **Guardar**

### Opening a bookmark folder as tab folder
1. Right-click on any folder in the bookmarks bar
2. Click **"📂 Abrir como carpeta de pestañas…"**
3. Select the target workspace
4. Optionally select a folder inside that workspace to nest into
5. Click **Abrir**

## Notes

- Saving a tab folder to bookmarks does **not** close the tabs — it creates a bookmark copy.
- Opening a bookmark folder as tabs opens new tabs — it does **not** delete the bookmarks.
- Empty tabs (`about:newtab`, `about:blank`) are excluded when saving to bookmarks.
