# Window Actions DBus API

This document is the authoritative DBus API reference for the `window-actions@openalo.local` GNOME Shell extension.

The extension exposes window discovery, focused-window grounding metadata, lifecycle events, and window control operations over the GNOME Shell session bus for OpenALO.

## Overview

The API is designed around three use cases:

- reactive window awareness via DBus signals
- accurate grounding data for the currently focused window
- direct window enumeration and control without polling the full desktop state more than necessary

The current implementation includes:

- Milestone A: reactive lifecycle signals and focused grounding methods
- Milestone B: server-side filtered enumeration methods

## DBus Coordinates

- Bus: session bus
- Destination: `org.gnome.Shell`
- Object path: `/org/gnome/Shell/Extensions/Windows`
- Interface: `org.gnome.Shell.Extensions.Windows`
- Extension UUID: `window-actions@openalo.local`

## Design Notes

### Data Format

Most methods return JSON strings instead of typed DBus structs. This keeps the API surface consistent with the historical extension behavior and simplifies compatibility with existing consumers.

### Lifecycle Model

The extension does not emit a raw `window-created` event for every transient Mutter surface.

Instead:

- `WindowCreated` is emitted only when a window becomes identifiable and focused.
- `WindowClosed` is emitted for windows that were previously announced or have usable cached metadata.
- transient popup/menu surfaces are intentionally suppressed to keep the signal stream useful for OpenALO.

### Focus Filtering

`WindowFocusChanged` intentionally ignores Desktop Icons NG focus surfaces, which otherwise generate noisy focus churn with `wm_class: gjs` and titles like `Desktop Icons 1`.

## Signals

### `WindowFocusChanged(winid, details_json)`
Emitted when the focused window changes to a user-relevant window.

Arguments:

- `winid`: `u`
- `details_json`: `s`

`details_json` schema:

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

Semantics:

- emitted after the extension resolves the current focused `MetaWindow`
- intended to be the primary trigger for OpenALO grounding refresh
- filtered to avoid desktop-icons noise

### `WindowCreated(winid, wm_class, pid)`
Emitted when a newly relevant window becomes identifiable and focused for the first time.

Arguments:

- `winid`: `u`
- `wm_class`: `s`
- `pid`: `u`

Semantics:

- not every low-level Mutter surface generates this signal
- popup menus and transient helper surfaces are intentionally excluded
- used to detect newly actionable windows rather than every raw compositor object

Typical uses:

- detect the main window after launching an application
- trigger one-time initialization for a newly focused app window

### `WindowClosed(winid, wm_class)`
Emitted when a tracked window closes.

Arguments:

- `winid`: `u`
- `wm_class`: `s`

Semantics:

- emitted when the extension can associate the closing window with prior metadata
- uses cached metadata so the class is still available during teardown

### `WorkspaceChanged(workspace_index)`
Emitted when the active GNOME workspace changes.

Arguments:

- `workspace_index`: `u`

Typical use:

- invalidate cached workspace-scoped window views
- refresh OpenALO context when workspace changes affect visible windows

## Query Methods

### `List()`
Returns all current windows as a JSON array.

Signature:

- output: `s`

Example call:

```sh
gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/Windows \
  --method org.gnome.Shell.Extensions.Windows.List
```

Example item shape:

```json
{
  "wm_class": "brave-browser",
  "wm_class_instance": "brave-browser",
  "title": "New Tab - Brave",
  "pid": 929623,
  "id": 3655718774,
  "frame_type": 0,
  "window_type": 0,
  "width": 1854,
  "height": 1048,
  "x": 1432,
  "y": 32,
  "focus": true,
  "in_current_workspace": true,
  "workspace": 0,
  "monitor": 0
}
```

### `ListOnWorkspace(workspace_index)`
Returns only windows assigned to the specified workspace.

Signature:

- input: `workspace_index` `i`
- output: `windows` `s`

Behavior:

- reuses the same JSON item shape as `List()`
- performs filtering inside the extension before returning the payload

Typical use:

- enumerate only the currently relevant workspace for grounding or launch detection

### `GetWindowsByPID(pid)`
Returns only windows associated with a specific process ID.

Signature:

- input: `pid` `u`
- output: `windows` `s`

Behavior:

- reuses the same JSON item shape as `List()`
- returns an empty JSON array when no window matches the PID

Typical use:

- correlate launched processes with visible windows
- narrow a multi-window application down to one process origin

### `GetFocusedWindow()`
Returns the currently focused window as JSON.

Signature:

- output: `s`

Behavior:

- returns JSON `null` if no focused window is available
- intended to replace `List()` plus client-side focus filtering for the common grounding path

Returned shape:

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

### `GetMonitorGeometry(monitor_index)`
Returns monitor geometry and scale metadata as JSON.

Signature:

- input: `monitor_index` `i`
- output: `geometry` `s`

Returned shape:

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

Typical use:

- apply HiDPI-aware coordinate correction
- determine per-monitor offsets in multi-monitor layouts

### `Details(winid)`
Returns expanded metadata for a single window.

Signature:

- input: `winid` `u`
- output: `win` `s`

Fields include:

- identity: `id`, `pid`, `title`, `wm_class`, `wm_class_instance`, `role`
- geometry: `x`, `y`, `width`, `height`, `monitor`
- state: `focus`, `maximized`, `frame_type`, `window_type`, `layer`
- capabilities: `moveable`, `resizeable`, `canclose`, `canmaximize`, `canminimize`, `canshade`
- work areas: `area`, `area_all`, `area_cust`

### `GetTitle(winid)`
Returns a window title string.

Signature:

- input: `winid` `u`
- output: `win` `s`

### `GetFrameRect(winid)`
Returns the frame rectangle for a window as JSON.

Signature:

- input: `winid` `u`
- output: `frameRect` `s`

Returned shape:

```json
{
  "x": 1432,
  "y": 32,
  "width": 1854,
  "height": 1048
}
```

### `GetFrameBounds(winid)`
Returns frame bounds for a window as JSON.

Signature:

- input: `winid` `u`
- output: `frameBounds` `s`

## Control Methods

### `MoveToWorkspace(winid, workspace_num)`
Moves a window to a target workspace.

### `MoveResize(winid, x, y, width, height)`
Moves and resizes a window in a single operation.

### `Resize(winid, width, height)`
Resizes a window.

### `Move(winid, x, y)`
Moves a window.

### `Maximize(winid)`
Maximizes a window.

### `Minimize(winid)`
Minimizes a window.

### `Unmaximize(winid)`
Restores a maximized window.

### `Unminimize(winid)`
Restores a minimized window.

### `Activate(winid)`
Activates a window, switching workspace if needed.

### `Close(winid)`
Requests window deletion using the current GNOME Shell timestamp.

## Error Behavior

Methods addressing a specific window ID throw `Not found` when the target window cannot be resolved.

Examples:

- `Details(winid)`
- `GetTitle(winid)`
- `GetFrameRect(winid)`
- `Move(winid, x, y)`
- `Close(winid)`

Collection methods return empty JSON arrays where appropriate instead of throwing.

## OpenALO Grounding Pattern

The intended focused grounding flow is:

1. subscribe to `WindowFocusChanged`
2. call `GetFocusedWindow()` if full state refresh is needed
3. call `GetMonitorGeometry(focused['monitor'])`
4. combine AT-SPI relative coordinates with frame offset and monitor scale

Reference formula:

```python
focused = ext.GetFocusedWindow()
monitor = ext.GetMonitorGeometry(focused['monitor'])
scale = monitor['scale_factor']
screen_x = (atspi_x + focused['x']) * scale
screen_y = (atspi_y + focused['y']) * scale
```

## Validation Commands

### Introspection

```sh
gdbus introspect --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/Windows
```

### Signal Monitoring

```sh
gdbus monitor --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/Windows
```

### Focused Window

```sh
gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/Windows \
  --method org.gnome.Shell.Extensions.Windows.GetFocusedWindow
```

### Monitor Geometry

```sh
gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/Windows \
  --method org.gnome.Shell.Extensions.Windows.GetMonitorGeometry 0
```

### Workspace Filter

```sh
gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/Windows \
  --method org.gnome.Shell.Extensions.Windows.ListOnWorkspace 0
```

### PID Filter

```sh
gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/Windows \
  --method org.gnome.Shell.Extensions.Windows.GetWindowsByPID 973721
```

## Compatibility Notes

- The API keeps JSON-string method outputs for backward compatibility with the original extension style.
- `WindowCreated` semantics are intentionally stricter than raw GNOME compositor lifecycle events.
- On Wayland, GNOME Shell sometimes requires a full logout/login before DBus interface shape changes become visible after local extension edits.
