# Window Actions for OpenALO

`window-actions` is a GNOME Shell extension that exposes window metadata and window control APIs over DBus for OpenALO.

It supports:

- listing windows and detailed window metadata
- focused-window and monitor-geometry queries for grounding
- workspace and PID filtered window queries
- focus, creation, close, and workspace-change signals
- moving, resizing, activating, maximizing, minimizing, and closing windows

## Extension Identity

- Name: `Window Actions for OpenALO`
- UUID: `window-actions@openalo.local`
- DBus object path: `/org/gnome/Shell/Extensions/Windows`
- DBus interface: `org.gnome.Shell.Extensions.Windows`

## Local Installation

Install the extension locally from this repo:

```sh
mkdir -p ~/.local/share/gnome-shell/extensions/window-actions@openalo.local
cp /home/jony/alo-agent/window-actions/extension.js ~/.local/share/gnome-shell/extensions/window-actions@openalo.local/
cp /home/jony/alo-agent/window-actions/metadata.json ~/.local/share/gnome-shell/extensions/window-actions@openalo.local/
gnome-extensions disable window-calls@domandoman.xyz || true
gnome-extensions disable window-actions@openalo.local || true
gnome-extensions enable window-actions@openalo.local
```

Verify:

```sh
gnome-extensions info window-actions@openalo.local
gdbus introspect --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/Windows
```

If GNOME does not discover the extension immediately on Wayland, log out and back in once.

## Milestone A

Milestone A is implemented in the current extension.

It adds:

- lifecycle-safe signal registration and cleanup
- `WindowFocusChanged`
- `WindowCreated`
- `WindowClosed`
- `WorkspaceChanged`
- `GetFocusedWindow()`
- `GetMonitorGeometry(monitor_index)`

### Signals

Monitor signals with:

```sh
gdbus monitor --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/Windows
```

Exported signals:

- `WindowFocusChanged(winid, details_json)`
- `WindowCreated(winid, wm_class, pid)`
- `WindowClosed(winid, wm_class)`
- `WorkspaceChanged(workspace_index)`

Notes:

- `WindowCreated` is intentionally focus-gated so transient popup surfaces do not create noise.
- `WindowClosed` is emitted for windows that were previously announced or have usable metadata.
- `WindowFocusChanged` intentionally ignores Desktop Icons NG focus surfaces (`wm_class: gjs`, title `Desktop Icons ...`).

### Focused Window Query

```sh
gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/Windows \
  --method org.gnome.Shell.Extensions.Windows.GetFocusedWindow
```

Example result:

```json
{
  "id": 3655718775,
  "title": "codex",
  "wm_class": "com.github.amezin.ddterm",
  "wm_class_instance": "com.github.amezin.ddterm",
  "pid": 913271,
  "x": 1432,
  "y": 32,
  "width": 1854,
  "height": 724,
  "monitor": 0,
  "workspace": 0,
  "focus": true
}
```

### Monitor Geometry Query

```sh
gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/Windows \
  --method org.gnome.Shell.Extensions.Windows.GetMonitorGeometry 0
```

Example result:

```json
{
  "x": 1366,
  "y": 0,
  "width": 1920,
  "height": 1080,
  "scale_factor": 1,
  "is_primary": true
}
```

### OpenALO Coordinate Correction

Use the focused window frame and monitor scale together:

```python
focused = ext.GetFocusedWindow()
monitor = ext.GetMonitorGeometry(focused['monitor'])
scale = monitor['scale_factor']
screen_x = (atspi_x + focused['x']) * scale
screen_y = (atspi_y + focused['y']) * scale
```

## Milestone B

Milestone B is also implemented.

It adds server-side filtering methods:

- `ListOnWorkspace(workspace_index)`
- `GetWindowsByPID(pid)`

### List All Windows

```sh
gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/Windows \
  --method org.gnome.Shell.Extensions.Windows.List
```

### List Windows on a Workspace

```sh
gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/Windows \
  --method org.gnome.Shell.Extensions.Windows.ListOnWorkspace 0
```

### List Windows by PID

```sh
gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/Windows \
  --method org.gnome.Shell.Extensions.Windows.GetWindowsByPID 913271
```

These methods return the same JSON window objects as `List()`, but filtered server-side.

## Existing Window Details and Control Methods

### Detailed Window Information

```sh
gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/Windows \
  --method org.gnome.Shell.Extensions.Windows.Details 3655718775
```

### Frame Rectangle

```sh
gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/Windows \
  --method org.gnome.Shell.Extensions.Windows.GetFrameRect 3655718775
```

### Move Window to Workspace

```sh
gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/Windows \
  --method org.gnome.Shell.Extensions.Windows.MoveToWorkspace 3655718775 1
```

### Move and Resize

```sh
gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/Windows \
  --method org.gnome.Shell.Extensions.Windows.MoveResize 3655718775 1500 100 1200 800
```

### Window Actions

Methods taking only `winid`:

- `Maximize`
- `Minimize`
- `Unmaximize`
- `Unminimize`
- `Activate`
- `Close`

## Notes on `jq`

Some `gdbus` builds do not support `--print-reply=literal`. If your local version prints a usage message when you pass that flag, use plain `gdbus call` and parse the returned tuple manually.

## Docs

Additional project docs:

- [DBus API Reference](docs/API.md)
- [Execution Plan](docs/WindowCalls_OpenALO_Execution_Plan.md)
- [Expert Report](docs/report.md)
