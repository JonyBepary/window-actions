/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const MR_DBUS_IFACE = `
<node>
   <interface name="org.gnome.Shell.Extensions.Windows">
      <signal name="WindowFocusChanged">
         <arg type="u" name="winid" />
         <arg type="s" name="details" />
      </signal>
      <signal name="WindowCreated">
         <arg type="u" name="winid" />
         <arg type="s" name="wmClass" />
         <arg type="u" name="pid" />
      </signal>
      <signal name="WindowClosed">
         <arg type="u" name="winid" />
         <arg type="s" name="wmClass" />
      </signal>
      <signal name="WorkspaceChanged">
         <arg type="u" name="workspaceIndex" />
      </signal>
      <method name="List">
         <arg type="s" direction="out" name="win" />
      </method>
      <method name="ListOnWorkspace">
         <arg type="i" direction="in" name="workspaceIndex" />
         <arg type="s" direction="out" name="windows" />
      </method>
      <method name="GetWindowsByPID">
         <arg type="u" direction="in" name="pid" />
         <arg type="s" direction="out" name="windows" />
      </method>
      <method name="GetFocusedWindow">
         <arg type="s" direction="out" name="win" />
      </method>
      <method name="GetMonitorGeometry">
         <arg type="i" direction="in" name="monitorIndex" />
         <arg type="s" direction="out" name="geometry" />
      </method>
      <method name="Details">
         <arg type="u" direction="in" name="winid" />
         <arg type="s" direction="out" name="win" />
      </method>
      <method name="GetTitle">
         <arg type="u" direction="in" name="winid" />
         <arg type="s" direction="out" name="win" />
      </method>
      <method name="GetFrameRect">
         <arg type="u" direction="in" name="winid" />
         <arg type="s" direction="out" name="frameRect" />
      </method>
      <method name="GetFrameBounds">
         <arg type="u" direction="in" name="winid" />
         <arg type="s" direction="out" name="frameBounds" />
      </method>
      <method name="MoveToWorkspace">
         <arg type="u" direction="in" name="winid" />
         <arg type="u" direction="in" name="workspaceNum" />
      </method>
      <method name="MoveResize">
         <arg type="u" direction="in" name="winid" />
         <arg type="i" direction="in" name="x" />
         <arg type="i" direction="in" name="y" />
         <arg type="u" direction="in" name="width" />
         <arg type="u" direction="in" name="height" />
      </method>
      <method name="Resize">
         <arg type="u" direction="in" name="winid" />
         <arg type="u" direction="in" name="width" />
         <arg type="u" direction="in" name="height" />
      </method>
      <method name="Move">
         <arg type="u" direction="in" name="winid" />
         <arg type="i" direction="in" name="x" />
         <arg type="i" direction="in" name="y" />
      </method>
      <method name="Maximize">
         <arg type="u" direction="in" name="winid" />
      </method>
      <method name="Minimize">
         <arg type="u" direction="in" name="winid" />
      </method>
      <method name="Unmaximize">
         <arg type="u" direction="in" name="winid" />
      </method>
      <method name="Unminimize">
         <arg type="u" direction="in" name="winid" />
      </method>
      <method name="Activate">
         <arg type="u" direction="in" name="winid" />
      </method>
      <method name="Close">
         <arg type="u" direction="in" name="winid" />
      </method>
   </interface>
</node>`;


export default class Extension {
  enable() {
    this._signals = [];
    this._sources = [];
    this._announcedWindows = new Set();
    this._lastCloseTime = new Map();
    this._windowLifecycleSignals = new Map();
    this._windowMetadata = new Map();
    this._watchedWindows = new Map();
    this._dbus = Gio.DBusExportedObject.wrapJSObject(MR_DBUS_IFACE, this);
    this._dbus.export(Gio.DBus.session, '/org/gnome/Shell/Extensions/Windows');
    this._registerGlobalSignals();
    this._registerExistingWindows();
  }

  disable() {
    this._disconnectAllSources();
    this._disconnectAllSignals();
    this._announcedWindows.clear();
    this._lastCloseTime.clear();
    this._windowLifecycleSignals.clear();
    this._windowMetadata.clear();
    this._watchedWindows.clear();

    if (this._dbus) {
      this._dbus.flush();
      this._dbus.unexport();
      delete this._dbus;
    }
  }

  _connectSignal(obj, name, callback) {
    const id = obj.connect(name, callback);
    this._signals.push({obj, id});
    return id;
  }

  _disconnectSignal(obj, id) {
    const idx = this._signals.findIndex(entry => entry.obj === obj && entry.id === id);
    if (idx !== -1) {
      this._signals.splice(idx, 1);
    }

    try {
      obj.disconnect(id);
    } catch (error) {
      logError(error);
    }
  }

  _disconnectAllSignals() {
    for (const {obj, id} of this._signals.splice(0)) {
      try {
        obj.disconnect(id);
      } catch (error) {
        logError(error);
      }
    }
  }

  _scheduleIdle(callback) {
    let sourceId = 0;
    sourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      this._sources = this._sources.filter(id => id !== sourceId);
      callback();
      return GLib.SOURCE_REMOVE;
    });
    this._sources.push(sourceId);
    return sourceId;
  }

  _scheduleTimeout(delayMs, callback) {
    let sourceId = 0;
    sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delayMs, () => {
      this._sources = this._sources.filter(id => id !== sourceId);
      callback();
      return GLib.SOURCE_REMOVE;
    });
    this._sources.push(sourceId);
    return sourceId;
  }

  _disconnectAllSources() {
    for (const sourceId of this._sources.splice(0)) {
      try {
        GLib.Source.remove(sourceId);
      } catch (error) {
        logError(error);
      }
    }
  }

  _safeString(value) {
    return value ?? '';
  }

  _firstNonEmpty(...values) {
    for (const value of values) {
      const normalized = this._safeString(value).trim();
      if (normalized) {
        return normalized;
      }
    }

    return '';
  }

  _getWindowClass(win, fallback = '') {
    return this._firstNonEmpty(
      win?.get_wm_class?.(),
      win?.get_wm_class_instance?.(),
      win?.get_gtk_application_id?.(),
      win?.get_sandboxed_app_id?.(),
      fallback
    );
  }

  _validateInt(value, name) {
    if (!Number.isInteger(value)) {
      throw new Error(`Invalid ${name}: must be an integer`);
    }
  }

  _validatePositiveInt(value, name) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`Invalid ${name}: must be a positive integer`);
    }
  }

  _validateWorkspaceIndex(workspaceIndex) {
    this._validateInt(workspaceIndex, 'workspaceIndex');
    const workspaceCount = global.workspace_manager.get_n_workspaces();
    if (workspaceIndex < 0 || workspaceIndex >= workspaceCount) {
      throw new Error(`Invalid workspaceIndex: must be between 0 and ${workspaceCount - 1}`);
    }
  }

  _validateMonitorIndex(monitorIndex) {
    this._validateInt(monitorIndex, 'monitorIndex');
    const monitorCount = global.display.get_n_monitors();
    if (monitorIndex < 0 || monitorIndex >= monitorCount) {
      throw new Error(`Invalid monitorIndex: must be between 0 and ${monitorCount - 1}`);
    }
  }

  _isDesktopIconsWindow(win) {
    const wmClass = this._getWindowClass(win);
    const title = this._safeString(win?.get_title?.());
    return wmClass === 'gjs' && title.startsWith('Desktop Icons ');
  }

  _shouldEmitFocusSignals(win) {
    return !this._isDesktopIconsWindow(win);
  }

  _emitSignal(name, signature, values) {
    if (!this._dbus) {
      return;
    }

    this._dbus.emit_signal(name, new GLib.Variant(signature, values));
  }

  _getWindowActorById(winid) {
    return global.get_window_actors().find(w => w.meta_window?.get_id() === winid) ?? null;
  }

  _requireWindowActor(winid) {
    const actor = this._getWindowActorById(winid);
    if (!actor) {
      throw new Error('Not found');
    }

    return actor;
  }

  _registerGlobalSignals() {
    this._connectSignal(global.display, 'notify::focus-window', () => {
      const win = global.display.get_focus_window();
      if (!win) {
        return;
      }

      this._rememberWindowMetadata(win);
      const tracked = this._windowLifecycleSignals.get(win.get_id());
      if (tracked) {
        tracked.wmClass = this._windowMetadata.get(win.get_id())?.wmClass ?? tracked.wmClass;
      }

      if (!this._shouldEmitFocusSignals(win)) {
        return;
      }

      if (!this._announcedWindows.has(win.get_id())) {
        const wmClass = this._windowMetadata.get(win.get_id())?.wmClass ?? '';
        if (wmClass) {
          this._announcedWindows.add(win.get_id());
          this._emitSignal('WindowCreated', '(usu)', [
            win.get_id(),
            wmClass,
            win.get_pid(),
          ]);
        }
      }

      try {
        this._emitSignal('WindowFocusChanged', '(us)', [
          win.get_id(),
          JSON.stringify(this._serializeFocusedWindow(win)),
        ]);
      } catch (error) {
        logError(error);
      }
    });

    this._connectSignal(global.display, 'window-created', (_display, win) => {
      if (!win) {
        return;
      }

      this._trackWindowLifecycle(win);
    });

    this._connectSignal(global.workspace_manager, 'active-workspace-changed', () => {
      const activeWorkspace = global.workspace_manager.get_active_workspace();
      const workspaceIndex = activeWorkspace ? activeWorkspace.index() : -1;
      this._emitSignal('WorkspaceChanged', '(u)', [Math.max(0, workspaceIndex)]);
    });
  }

  _registerExistingWindows() {
    for (const actor of global.get_window_actors()) {
      if (actor.meta_window) {
        this._rememberWindowMetadata(actor.meta_window);
        this._trackWindowLifecycle(actor.meta_window);
      }
    }
  }

  _trackWindowLifecycle(win) {
    if (!win) {
      return;
    }

    const winid = win.get_id();
    if (this._windowLifecycleSignals.has(winid)) {
      return;
    }

    const signalIds = [];
    const unmanagedId = this._connectSignal(win, 'unmanaged', () => {
      const tracked = this._windowLifecycleSignals.get(winid);
      if (!tracked) {
        return;
      }

      const remembered = this._windowMetadata.get(winid);
      this._cleanupWindowLifecycle(winid);
      const wmClass = this._firstNonEmpty(
        remembered?.wmClass,
        this._getWindowClass(win, tracked.wmClass),
        tracked.wmClass
      );

      if (!this._announcedWindows.has(winid) && !wmClass) {
        this._windowMetadata.delete(winid);
        return;
      }

      this._emitSignal('WindowClosed', '(us)', [
        tracked.winid,
        wmClass,
      ]);
      this._announcedWindows.delete(winid);
      this._windowMetadata.delete(winid);
    });

    signalIds.push(unmanagedId);
    this._windowLifecycleSignals.set(winid, {
      object: win,
      signalIds,
      winid,
      wmClass: this._rememberWindowMetadata(win).wmClass,
    });
  }

  _cleanupWindowLifecycle(winid) {
    const tracked = this._windowLifecycleSignals.get(winid);
    if (!tracked) {
      return;
    }

    for (const id of tracked.signalIds) {
      this._disconnectSignal(tracked.object, id);
    }

    this._windowLifecycleSignals.delete(winid);
  }

  _rememberWindowMetadata(win) {
    const metadata = {
      wmClass: this._getWindowClass(win),
      pid: win?.get_pid?.(),
      title: this._safeString(win?.get_title?.()),
    };

    if (win?.get_id?.()) {
      this._windowMetadata.set(win.get_id(), metadata);
    }

    return metadata;
  }

  _listWindowActors(predicate = null) {
    const actors = global.get_window_actors().filter(actor => actor.meta_window);
    if (!predicate) {
      return actors;
    }

    return actors.filter(actor => predicate(actor.meta_window));
  }

  _serializeWindow(win) {
    const workspaceManager = global.workspace_manager;
    const frame = win.get_frame_rect();
    if (!frame) {
      throw new Error('Frame unavailable');
    }

    const workspace = win.get_workspace();

    return {
      wm_class: win.get_wm_class?.(),
      wm_class_instance: win.get_wm_class_instance?.(),
      title: win.get_title?.(),
      pid: win.get_pid?.(),
      id: win.get_id?.(),
      frame_type: win.get_frame_type?.(),
      window_type: win.get_window_type?.(),
      width: frame.width,
      height: frame.height,
      x: frame.x,
      y: frame.y,
      focus: win.has_focus?.() ?? false,
      in_current_workspace: win.located_on_workspace?.(workspaceManager.get_active_workspace?.()),
      workspace: workspace ? workspace.index() : -1,
      monitor: win.get_monitor?.(),
    };
  }

  _serializeDetailedWindow(win) {
    const workspaceManager = global.workspace_manager;
    const currentMonitor = global.display.get_current_monitor();
    const frame = win.get_frame_rect();
    if (!frame) {
      throw new Error('Frame unavailable');
    }

    return {
      wm_class: win.get_wm_class?.(),
      wm_class_instance: win.get_wm_class_instance?.(),
      pid: win.get_pid?.(),
      id: win.get_id?.(),
      width: frame.width,
      height: frame.height,
      x: frame.x,
      y: frame.y,
      maximized: win.get_maximized?.(),
      frame_type: win.get_frame_type?.(),
      window_type: win.get_window_type?.(),
      layer: win.get_layer?.(),
      monitor: win.get_monitor?.(),
      role: win.get_role?.(),
      title: win.get_title?.(),
      focus: win.has_focus?.() ?? false,
      in_current_workspace: win.located_on_workspace?.(workspaceManager.get_active_workspace?.()),
      moveable: win.allows_move?.(),
      resizeable: win.allows_resize?.(),
      area: win.get_work_area_current_monitor?.(),
      area_all: win.get_work_area_all_monitors?.(),
      area_cust: win.get_work_area_for_monitor?.(currentMonitor),
      canclose: win.can_close?.(),
      canmaximize: win.can_maximize?.(),
      canminimize: win.can_minimize?.(),
      canshade: win.can_shade?.(),
    };
  }

  _serializeFocusedWindow(win) {
    const serialized = this._serializeWindow(win);
    return {
      id: serialized.id,
      title: serialized.title,
      wm_class: serialized.wm_class,
      wm_class_instance: serialized.wm_class_instance,
      pid: serialized.pid,
      x: serialized.x,
      y: serialized.y,
      width: serialized.width,
      height: serialized.height,
      monitor: serialized.monitor,
      workspace: serialized.workspace,
      focus: serialized.focus,
    };
  }

  _serializeMonitor(monitorIndex) {
    const geometry = global.display.get_monitor_geometry(monitorIndex);
    if (!geometry) {
      throw new Error('Not found');
    }

    return {
      x: geometry.x,
      y: geometry.y,
      width: geometry.width,
      height: geometry.height,
      scale_factor: global.display.get_monitor_scale(monitorIndex),
      is_primary: global.display.get_primary_monitor() === monitorIndex,
    };
  }

  Details(winid) {
    const actor = this._requireWindowActor(winid);
    return JSON.stringify(this._serializeDetailedWindow(actor.meta_window));
  }

  List() {
    return JSON.stringify(this._listWindowActors()
      .map(actor => this._serializeWindow(actor.meta_window)));
  }

  ListOnWorkspace(workspaceIndex) {
    this._validateWorkspaceIndex(workspaceIndex);
    return JSON.stringify(this._listWindowActors(win => {
      const workspace = win.get_workspace();
      return workspace ? workspace.index() === workspaceIndex : false;
    }).map(actor => this._serializeWindow(actor.meta_window)));
  }

  GetWindowsByPID(pid) {
    return JSON.stringify(this._listWindowActors(win => win.get_pid?.() === pid)
      .map(actor => this._serializeWindow(actor.meta_window)));
  }

  GetFocusedWindow() {
    const win = global.display.get_focus_window();
    if (!win) {
      return JSON.stringify(null);
    }

    return JSON.stringify(this._serializeFocusedWindow(win));
  }

  GetMonitorGeometry(monitorIndex) {
    this._validateMonitorIndex(monitorIndex);
    return JSON.stringify(this._serializeMonitor(monitorIndex));
  }

  GetFrameBounds(winid) {
    const actor = this._requireWindowActor(winid);
    const result = {
      frame_bounds: actor.meta_window.get_frame_bounds(),
    };
    return JSON.stringify(result);
  }

  GetFrameRect(winid) {
    const actor = this._requireWindowActor(winid);
    const frame = actor.meta_window.get_frame_rect();
    if (!frame) {
      throw new Error('Frame unavailable');
    }

    const result = {
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
    };
    return JSON.stringify(result);
  }

  GetTitle(winid) {
    const actor = this._requireWindowActor(winid);
    return JSON.stringify(actor.meta_window.get_title());
  }

  MoveToWorkspace(winid, workspaceNum) {
    this._validateWorkspaceIndex(workspaceNum);
    const actor = this._requireWindowActor(winid);
    log(`[window-actions] MoveToWorkspace requested for winid=${winid} workspace=${workspaceNum}`);
    actor.meta_window.change_workspace_by_index(workspaceNum, false);
  }

  MoveResize(winid, x, y, width, height) {
    this._validateInt(x, 'x');
    this._validateInt(y, 'y');
    this._validatePositiveInt(width, 'width');
    this._validatePositiveInt(height, 'height');
    const actor = this._requireWindowActor(winid);
    log(`[window-actions] MoveResize requested for winid=${winid} x=${x} y=${y} width=${width} height=${height}`);

    if (actor.meta_window.maximized_horizontally || actor.meta_window.maximized_vertically) {
      actor.meta_window.unmaximize(3);
    }

    actor.meta_window.move_resize_frame(1, x, y, width, height);
  }

  Resize(winid, width, height) {
    this._validatePositiveInt(width, 'width');
    this._validatePositiveInt(height, 'height');
    const actor = this._requireWindowActor(winid);
    if (actor.meta_window.maximized_horizontally || actor.meta_window.maximized_vertically) {
      actor.meta_window.unmaximize(3);
    }
    actor.meta_window.move_resize_frame(1, actor.get_x(), actor.get_y(), width, height);
  }

  Move(winid, x, y) {
    this._validateInt(x, 'x');
    this._validateInt(y, 'y');
    const actor = this._requireWindowActor(winid);
    log(`[window-actions] Move requested for winid=${winid} x=${x} y=${y}`);
    if (actor.meta_window.maximized_horizontally || actor.meta_window.maximized_vertically) {
      actor.meta_window.unmaximize(3);
    }
    actor.meta_window.move_frame(1, x, y);
  }

  Maximize(winid) {
    const actor = this._requireWindowActor(winid);
    actor.meta_window.maximize(3);
  }

  Minimize(winid) {
    const actor = this._requireWindowActor(winid);
    actor.meta_window.minimize();
  }

  Unmaximize(winid) {
    const actor = this._requireWindowActor(winid);
    actor.meta_window.unmaximize(3);
  }

  Unminimize(winid) {
    const actor = this._requireWindowActor(winid);
    actor.meta_window.unminimize();
  }

  Activate(winid) {
    const actor = this._requireWindowActor(winid);
    const win = actor.meta_window;
    const workspace = win.get_workspace();
    if (workspace) {
      workspace.activate_with_focus(win, 0);
    } else {
      win.activate(0);
    }
  }

  Close(winid) {
    const now = GLib.get_monotonic_time();
    const lastClose = this._lastCloseTime.get(winid) ?? 0;
    if (now - lastClose < 100000) {
      throw new Error('Rate limited');
    }

    const actor = this._requireWindowActor(winid);
    this._lastCloseTime.set(winid, now);
    log(`[window-actions] Close requested for winid=${winid} (${this._getWindowClass(actor.meta_window)})`);
    actor.meta_window.delete(global.get_current_time());
  }
}
