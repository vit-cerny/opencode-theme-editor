# OpenCode Theme Editor

A small local web app for visually editing [opencode](https://opencode.ai) themes.
It includes the terminal theme editor and a desktop theme studio with a preset shop,
live preview, background opacity, acrylic blur and a reversible native transparency patch.

![OpenCode Theme Editor](docs/screenshot.png)

## What it does

- Edits **all 52 colour tokens** opencode supports, plus the numeric `thinkingOpacity`.
- Edits the optional `defs` palette, so tokens can reference named colours.
- **Live preview** of a mock opencode TUI: header, sidebar with a selected list item,
  chat messages, fenced code block, diff hunk, markdown, input box and status line.
- **Dark / light / side-by-side** preview. Every token holds a `dark` and a `light` value.
- **Transparency**: per-token alpha slider (writes 8-digit hex) and an explicit
  transparent option. Transparent surfaces show a checkerboard in the preview.
- **Import** from any of the 33 built-in presets, from a theme you already saved, or
  from a `.json` file / pasted JSON.
- **Export** to a `.json` file.
- **Save** and **Apply to opencode** write to your real opencode config.
- Every overwrite is backed up to `<file>.bak.<timestamp>` first. Nothing is ever
  deleted without a backup.

## Prerequisites

- [Node.js](https://nodejs.org) 18 or newer. Nothing else - zero dependencies.
- Windows, macOS or Linux. (Tested on Windows 11 with PowerShell 5.1.)

## Install

```powershell
git clone https://github.com/vit-cerny/opencode-theme-editor.git
cd opencode-theme-editor
.\start.cmd
```

That starts the server and opens the editor in your browser at
`http://127.0.0.1:4288/`. No build step, no `npm install`.

To also get a Desktop shortcut:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

## Usage

1. Pick a **Preset** (33 built-in opencode themes) or one of **My themes**, then click
   **Load**.
2. Type a name in the top-left box (letters, digits, dot, dash, underscore).
3. Tweak tokens. The preview updates as you go.
   - The colour swatch opens a picker.
   - The text box accepts hex, an ANSI index 0-255, `none`, `transparent`, or a `defs` name.
   - The slider sets alpha.
   - **LINK** edits dark and light together; click it to switch to **SPLIT** and set them
     independently.
4. **Save** writes `<config>/themes/<name>.json`.
   **Apply to opencode** does that and also points `tui.json` at your theme.
5. Restart opencode. Your theme is live.

## Making a transparent theme

opencode accepts **8-digit hex with alpha** (`#RRGGBBAA`) even though the docs only
mention 6-digit hex, and the literal values `none` / `transparent`.

Two ready-made transparent themes are included:

- [`examples/nord-bluish.json`](examples/nord-bluish.json) - the Nord palette with
  translucent slate-blue panels, a fully transparent background and a cyan active border.
  This is the "Nord Bluish" look: dark glass over your wallpaper.
- [`examples/glass.json`](examples/glass.json) - a neutral dark glass theme.

Both are built the same way:

```json
{
  "background":        { "dark": "none",      "light": "none" },
  "backgroundPanel":   { "dark": "#0f1115d9", "light": "#ffffffd9" },
  "backgroundElement": { "dark": "#171a21bf", "light": "#f2f4f7bf" },
  "border":            { "dark": "#ffffff26", "light": "#00000026" }
}
```

`d9` is 85% opaque, `bf` is 75%, `26` is 15%.

For the wallpaper to actually show through, your **terminal** must be transparent too.
Windows Terminal, for example:

```json
"opacity": 70,
"useAcrylic": true
```

The theme controls colours; the see-through comes from the terminal compositor.

## Desktop app theme studio

The desktop app does not load theme files from disk. Its themes are bundled into
`resources/app.asar`, so the terminal theme above does not affect it.

This project includes a separate desktop studio at:

```text
http://127.0.0.1:4288/desktop
```

It provides:

- a preset shop with six desktop presets
- colour sliders for backgrounds, panels, text, borders, accents and states
- background opacity and window opacity sliders
- optional Windows 11 acrylic blur
- layout controls for density, sidebar width, corner radius and font scale
- custom CSS
- a reversible native transparency patch for the installed desktop app
- restore-to-original

Desktop theme data is written to:

```text
%APPDATA%\opencode-theme-editor\desktop.json
%APPDATA%\opencode-theme-editor\desktop.css
```

### Native transparency

Electron requires `transparent: true` when the window is created. Changing the
installed app at runtime is not supported, so the studio uses a small,
version-guarded ASAR patch.

1. Choose a preset and click **Apply theme**.
2. Close every OpenCode Desktop window.
3. Click **Enable native transparency**.
4. Start OpenCode Desktop again.

The patcher:

- refuses unknown OpenCode versions
- backs up `app.asar` to `app.asar.bak.<timestamp>`
- verifies the patched archive and restores the backup on failure
- keeps only the version-specific constructor patch
- can be undone with **Restore original**

The current tested version is OpenCode Desktop `2.0.32`. An app update can replace
the patched bundle, so re-apply the patch after updating.

Windows 11 acrylic blur is optional. Without it, the window is transparent but
not blurred. With native transparency enabled, Electron's documented Windows
transparent-window restrictions apply, including resize limitations.

## Desktop app theme editor

The desktop app ignores theme files on disk: its themes are compiled into
`resources/app.asar`. The editor therefore writes your theme to a folder it owns and
installs a small loader into the app once, so the theme loads on every start.

Open it at:

```text
http://127.0.0.1:4288/desktop
```

What you can change:

- 6 presets in the preset shop
- background mode: transparent, acrylic blur, opaque
- window opacity slider
- Windows 11 acrylic blur
- density, corner radius, font scale
- 15 colour slots with per-colour alpha
- custom CSS
- live preview of the desktop window

### Install it

1. Pick a preset, tune it.
2. Fully quit OpenCode Desktop.
3. Click **Install to OpenCode**.
4. Start OpenCode Desktop.

That is a one time step. After it, changing colours and clicking **Install to OpenCode**
again updates the theme; restart the app to see it.

Your theme lives in:

```text
%APPDATA%\opencode-theme-editor\desktop.json
%APPDATA%\opencode-theme-editor\desktop.css
```

### Command line

```powershell
node desktop\cli.cjs status
node desktop\cli.cjs apply nord-bluish
node desktop\cli.cjs install nord-bluish
node desktop\cli.cjs restore
```

`apply` only writes the theme files and never touches the app. `install` writes the
theme files and installs the loader. Both require OpenCode Desktop to be closed.

### Safety

- The patcher refuses any OpenCode Desktop version it was not tested against.
- Before writing, it copies `app.asar` to `app.asar.bak.<timestamp>`.
- It verifies the patched archive and restores the backup if verification fails.
- **Restore original** puts the untouched bundle back.
- An OpenCode update replaces the patched bundle. Reinstall after updating.

Tested against OpenCode Desktop `2.0.32`. Windows 11 acrylic blur is optional; without
it the window is transparent but not blurred.

## Where files go

| Thing | Path |
|---|---|
| Theme you save | `<config>/themes/<name>.json` |
| Theme selection | `<config>/tui.json` -> `{ "theme": "<name>" }` |
| Backups | next to the file, as `<file>.bak.<timestamp>` |
| `<config>` on Windows | `C:\Users\<you>\.config\opencode` |
| `<config>` on macOS/Linux | `~/.config/opencode` (or `$XDG_CONFIG_HOME/opencode`) |

opencode loads themes in this order, later overriding earlier: built-ins, then
`<config>/themes/*.json`, then `<project>/.opencode/themes/*.json`, then
`./.opencode/themes/*.json`.

## Uninstall

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
```

Removes the install folder, the Desktop shortcut and the desktop studio data. It does
**not** touch your terminal themes or your opencode config.

Keep the saved desktop theme data with:

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 -KeepThemes
```

If you ran it straight from the clone, just delete the folder. To revert a theme you
applied, either set `"theme": "opencode"` in `tui.json`, or restore the backup:

```powershell
Copy-Item "<config>\tui.json.bak.<timestamp>" "<config>\tui.json" -Force
```

## Options

```
node server.js [--port 4288] [--no-open] [--config-dir <path>]
```

- `--port` - port to listen on (default 4288)
- `--no-open` - do not open a browser
- `--config-dir` - override the opencode config directory (useful for testing)

The server binds to `127.0.0.1` only.

## Theme format

```json
{
  "$schema": "https://opencode.ai/theme.json",
  "defs": { "myBlue": "#58a6ff" },
  "theme": {
    "primary": { "dark": "myBlue", "light": "#0969da" }
  }
}
```

Token values may be 6-digit hex, 8-digit hex with alpha, an ANSI index 0-255,
`none` / `transparent`, a `defs` reference, another token name, or a
`{ "dark": ..., "light": ... }` pair. `defs` is optional.

## License

MIT
