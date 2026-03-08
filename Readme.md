# Window Actions for OpenALO

`window-actions` is a GNOME Shell extension that exposes a DBus API for window discovery, focused-window grounding, lifecycle signals, and controlled window manipulation.

The extension is intended for trusted local automation in OpenALO. It runs inside `gnome-shell` and publishes its API on the GNOME session bus.

## What It Provides

### Event Stream

- `WindowFocusChanged`
- `WindowCreated`
- `WindowClosed`
- `WorkspaceChanged`

### Query Methods

- `List()`
- `ListOnWorkspace(workspaceIndex)`
- `GetWindowsByPID(pid)`
- `GetFocusedWindow()`
- `GetMonitorGeometry(monitorIndex)`
- `Details(winid)`
- `GetTitle(winid)`
- `GetFrameRect(winid)`
- `GetFrameBounds(winid)`

### Control Methods

- `MoveToWorkspace(winid, workspaceNum)`
- `MoveResize(winid, x, y, width, height)`
- `Resize(winid, width, height)`
- `Move(winid, x, y)`
- `Maximize(winid)`
- `Minimize(winid)`
- `Unmaximize(winid)`
- `Unminimize(winid)`
- `Activate(winid)`
- `Close(winid)`

## Extension Identity

- Name: `Window Actions for OpenALO`
- UUID: `window-actions@openalo.local`
- DBus destination: `org.gnome.Shell`
- DBus object path: `/org/gnome/Shell/Extensions/Windows`
- DBus interface: `org.gnome.Shell.Extensions.Windows`

## Security Model

This extension has no caller authentication at the DBus layer.

Any process running in the same user session can:

- enumerate windows
- observe window lifecycle and focus signals
- read window titles, PIDs, and geometry
- invoke destructive methods such as `Close()` and `MoveResize()`

That is an intentional tradeoff for trusted local automation. Do not treat this extension as a secure multi-tenant control surface.

For the full security policy, see [SECURITY.md](/home/jony/alo-agent/window-actions/SECURITY.md).

## Installation

Install the extension locally from this repository:

```sh
mkdir -p ~/.local/share/gnome-shell/extensions/window-actions@openalo.local
cp /home/jony/alo-agent/window-actions/extension.js ~/.local/share/gnome-shell/extensions/window-actions@openalo.local/
cp /home/jony/alo-agent/window-actions/metadata.json ~/.local/share/gnome-shell/extensions/window-actions@openalo.local/
gnome-extensions disable window-actions@openalo.local || true
gnome-extensions enable window-actions@openalo.local
```

Verify that GNOME Shell sees the extension:

```sh
gnome-extensions info window-actions@openalo.local
gdbus introspect --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/Windows
```

## Development Workflow

### Reloading During Development

For normal extension edits:

```sh
cp /home/jony/alo-agent/window-actions/extension.js ~/.local/share/gnome-shell/extensions/window-actions@openalo.local/
gnome-extensions disable window-actions@openalo.local
gnome-extensions enable window-actions@openalo.local
```

If GNOME Shell continues to serve stale DBus methods or an older interface after reload, log out and back in. On Wayland, that is the reliable full shell restart.

### Preferred GNOME 49 Development Loop

For repeated development and debugging on GNOME 49 or later, use a nested shell as recommended by the GJS extension debugging guide:

```sh
dbus-run-session gnome-shell --devkit --wayland
```

For additional shell diagnostics:

```sh
export G_MESSAGES_DEBUG=all
export SHELL_DEBUG=all
dbus-run-session gnome-shell --devkit --wayland
```

Reference:

- [GJS Guide: Debugging and Reloading Extensions](https://gjs.guide/extensions/development/debugging.html#reloading-extensions)

## Implemented Capability Sets

### Lifecycle and Focus Tracking

The extension now provides:

- lifecycle-safe signal registration and cleanup
- focused-window grounding with `GetFocusedWindow()`
- monitor geometry lookup with `GetMonitorGeometry()`
- filtered focus notifications that ignore Desktop Icons NG noise
- focus-gated `WindowCreated` behavior to suppress transient popup surfaces

### Filtered Discovery Queries

The extension also provides:

- workspace-scoped enumeration with `ListOnWorkspace()`
- process-scoped enumeration with `GetWindowsByPID()`
- hardened parameter validation for workspace and monitor indices

These are shipped features of the current extension.

## Runtime Verification

### Signal Monitoring

```sh
gdbus monitor --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/Windows
```

### Focused Window Query

```sh
gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/Windows \
  --method org.gnome.Shell.Extensions.Windows.GetFocusedWindow
```

### Workspace Filter

```sh
gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/Windows \
  --method org.gnome.Shell.Extensions.Windows.ListOnWorkspace 0
```

### Security Verification Script

The repository includes a live verification script for the hardened DBus surface:

```sh
cd /home/jony/alo-agent/window-actions
bash tests/test_security_hardening.sh
```

The script checks:

- JSON return contracts
- invalid-parameter rejection
- invalid window ID handling
- focused-window invariants
- disposable-window close and rate-limit behavior
- lifecycle signal behavior where focus conditions allow it

## Usage Examples

### Example: Read the Focused Window

```sh
gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/Windows \
  --method org.gnome.Shell.Extensions.Windows.GetFocusedWindow
```

Typical response:

```text
('{"id":2436270931,"title":"~/alo-agent/window-actions","wm_class":"com.github.amezin.ddterm","wm_class_instance":"com.github.amezin.ddterm","pid":240345,"x":1432,"y":32,"width":1854,"height":992,"monitor":0,"workspace":0,"focus":true}',)
```

### Example: Find All Windows for a Process

If you already know a PID, query only the windows that belong to it:

```sh
gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/Windows \
  --method org.gnome.Shell.Extensions.Windows.GetWindowsByPID 240345
```

Typical response:

```text
('[{"wm_class":"com.github.amezin.ddterm","wm_class_instance":"com.github.amezin.ddterm","title":"~/alo-agent/window-actions","pid":240345,"id":2436270931,"frame_type":0,"window_type":0,"width":1854,"height":992,"x":1432,"y":32,"focus":true,"in_current_workspace":true,"workspace":0,"monitor":0}]',)
```

### Example: Monitor Live Window Events

```sh
gdbus monitor --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/Windows
```

Typical output while switching windows:

```text
/org/gnome/Shell/Extensions/Windows: org.gnome.Shell.Extensions.Windows.WindowFocusChanged (uint32 2436270931, '{"id":2436270931,"title":"~/alo-agent/window-actions","wm_class":"com.github.amezin.ddterm","wm_class_instance":"com.github.amezin.ddterm","pid":240345,"x":1432,"y":32,"width":1854,"height":992,"monitor":0,"workspace":0,"focus":true}')
```

### Example: End-to-End OpenALO Grounding Flow

1. Read the focused window.
2. Read the monitor geometry for that window.
3. Convert relative accessibility coordinates into screen coordinates.

```python
focused = ext.GetFocusedWindow()
monitor = ext.GetMonitorGeometry(focused["monitor"])
scale = monitor["scale_factor"]
screen_x = (atspi_x + focused["x"]) * scale
screen_y = (atspi_y + focused["y"]) * scale
```

### Example: Query a Workspace Only

```sh
gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/Windows \
  --method org.gnome.Shell.Extensions.Windows.ListOnWorkspace 0
```

Use this when you want server-side filtering instead of fetching every window and filtering client-side.

## OpenALO Grounding Pattern

Use the focused window frame together with the monitor scale factor:

```python
focused = ext.GetFocusedWindow()
monitor = ext.GetMonitorGeometry(focused["monitor"])
scale = monitor["scale_factor"]
screen_x = (atspi_x + focused["x"]) * scale
screen_y = (atspi_y + focused["y"]) * scale
```

## Documentation

- [DBus API Reference](/home/jony/alo-agent/window-actions/docs/API.md)
- [Security Policy](/home/jony/alo-agent/window-actions/SECURITY.md)
- [Changelog](/home/jony/alo-agent/window-actions/CHANGELOG.md)
