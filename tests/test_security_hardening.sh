#!/usr/bin/env bash

set -u

DEST="org.gnome.Shell"
OBJ="/org/gnome/Shell/Extensions/Windows"
IFACE="org.gnome.Shell.Extensions.Windows"

PASS=0
FAIL=0
SKIP=0
TOTAL=0

CALL_STATUS=0
CALL_OUTPUT=""

FOCUSED_PAYLOAD=""
FOCUSED_JSON=""
WINID=""
PID=""
WORKSPACE=""
MONITOR=""
INVALID_WINID=""

DESTRUCTIVE_MODE="${WINDOW_ACTIONS_TEST_DESTRUCTIVE:-auto}"
MONITOR_LOG=""
MONITOR_PID=""
TEMP_DIR=""
LAUNCHED_PID=""

cleanup() {
  if [[ -n "${MONITOR_PID}" ]]; then
    kill "${MONITOR_PID}" >/dev/null 2>&1 || true
    wait "${MONITOR_PID}" >/dev/null 2>&1 || true
  fi

  if [[ -n "${LAUNCHED_PID}" ]]; then
    kill "${LAUNCHED_PID}" >/dev/null 2>&1 || true
    wait "${LAUNCHED_PID}" >/dev/null 2>&1 || true
  fi

  if [[ -n "${TEMP_DIR}" && -d "${TEMP_DIR}" ]]; then
    rm -rf "${TEMP_DIR}"
  fi
}

trap cleanup EXIT

section() {
  echo ""
  echo "━━━ $1 ━━━"
}

record_pass() {
  TOTAL=$((TOTAL + 1))
  PASS=$((PASS + 1))
  echo "  PASS: $1"
}

record_fail() {
  TOTAL=$((TOTAL + 1))
  FAIL=$((FAIL + 1))
  echo "  FAIL: $1"
}

record_skip() {
  TOTAL=$((TOTAL + 1))
  SKIP=$((SKIP + 1))
  echo "  SKIP: $1"
}

run_call() {
  local method="$1"
  shift

  local output=""
  if output=$(gdbus call --session --dest "${DEST}" --object-path "${OBJ}" --method "${IFACE}.${method}" "$@" 2>&1); then
    CALL_STATUS=0
    CALL_OUTPUT="${output}"
  else
    CALL_STATUS=$?
    CALL_OUTPUT="${output}"
  fi
}

preflight_session_access() {
  local output=""
  if output=$(gdbus introspect --session --dest "${DEST}" --object-path "${OBJ}" 2>&1); then
    if [[ "${output}" == *"${IFACE}"* ]]; then
      return 0
    fi

    echo "Preflight failed: DBus object is reachable but ${IFACE} is not exported."
    exit 1
  fi

  case "${output}" in
    *"Operation not permitted"*|*"Cannot autolaunch D-Bus"*|*"Failed to open display"*|*"Error connecting:"*)
      echo "Preflight skipped: the current environment cannot reach the GNOME session bus."
      echo "Run this script inside the logged-in GNOME user session."
      exit 2
      ;;
    *)
      echo "Preflight failed: could not introspect ${OBJ} on ${DEST}."
      echo "${output}"
      exit 1
      ;;
  esac
}

unwrap_gdbus_single() {
  printf '%s' "$1" | python3 -c '
import ast
import sys

text = sys.stdin.read().strip()
value = ast.literal_eval(text)
if not isinstance(value, tuple) or len(value) != 1:
    raise SystemExit(1)
item = value[0]
if not isinstance(item, str):
    raise SystemExit(2)
print(item)
'
}

json_eval() {
  local payload="$1"
  local filter="$2"
  printf '%s' "${payload}" | jq -e "${filter}" >/dev/null 2>&1
}

assert_error_contains() {
  local description="$1"
  local expected="$2"
  shift 2

  run_call "$@"
  if [[ "${CALL_STATUS}" -ne 0 && "${CALL_OUTPUT}" == *"${expected}"* ]]; then
    record_pass "${description}"
  else
    record_fail "${description} -> expected error containing '${expected}', got: ${CALL_OUTPUT}"
  fi
}

assert_success_json() {
  local description="$1"
  local filter="$2"
  shift 2

  run_call "$@"
  if [[ "${CALL_STATUS}" -ne 0 ]]; then
    record_fail "${description} -> unexpected DBus error: ${CALL_OUTPUT}"
    return 1
  fi

  local payload=""
  if ! payload=$(unwrap_gdbus_single "${CALL_OUTPUT}" 2>/dev/null); then
    record_fail "${description} -> could not parse gdbus output: ${CALL_OUTPUT}"
    return 1
  fi

  if json_eval "${payload}" "${filter}"; then
    record_pass "${description}"
    return 0
  fi

  record_fail "${description} -> JSON assertion failed for payload: ${payload}"
  return 1
}

assert_success_json_with_pid() {
  local description="$1"
  local expected_pid="$2"
  local filter="$3"
  shift 3

  run_call "$@"
  if [[ "${CALL_STATUS}" -ne 0 ]]; then
    record_fail "${description} -> unexpected DBus error: ${CALL_OUTPUT}"
    return 1
  fi

  local payload=""
  if ! payload=$(unwrap_gdbus_single "${CALL_OUTPUT}" 2>/dev/null); then
    record_fail "${description} -> could not parse gdbus output: ${CALL_OUTPUT}"
    return 1
  fi

  if printf '%s' "${payload}" | jq -e --argjson pid "${expected_pid}" "${filter}" >/dev/null 2>&1; then
    record_pass "${description}"
    return 0
  fi

  record_fail "${description} -> JSON assertion failed for payload: ${payload}"
  return 1
}

load_focused_window() {
  run_call GetFocusedWindow
  if [[ "${CALL_STATUS}" -ne 0 ]]; then
    record_fail "GetFocusedWindow() setup -> ${CALL_OUTPUT}"
    return 1
  fi

  if ! FOCUSED_PAYLOAD=$(unwrap_gdbus_single "${CALL_OUTPUT}" 2>/dev/null); then
    record_fail "GetFocusedWindow() setup -> could not parse payload"
    return 1
  fi

  if ! json_eval "${FOCUSED_PAYLOAD}" 'type == "object" and has("id") and has("pid") and has("workspace") and has("monitor")'; then
    record_fail "GetFocusedWindow() setup -> payload missing required keys: ${FOCUSED_PAYLOAD}"
    return 1
  fi

  FOCUSED_JSON="${FOCUSED_PAYLOAD}"
  WINID=$(printf '%s' "${FOCUSED_JSON}" | jq -r '.id')
  PID=$(printf '%s' "${FOCUSED_JSON}" | jq -r '.pid')
  WORKSPACE=$(printf '%s' "${FOCUSED_JSON}" | jq -r '.workspace')
  MONITOR=$(printf '%s' "${FOCUSED_JSON}" | jq -r '.monitor')
  return 0
}

choose_invalid_winid() {
  run_call List
  if [[ "${CALL_STATUS}" -ne 0 ]]; then
    record_fail "List() setup for invalid window id -> ${CALL_OUTPUT}"
    return 1
  fi

  local payload=""
  if ! payload=$(unwrap_gdbus_single "${CALL_OUTPUT}" 2>/dev/null); then
    record_fail "List() setup for invalid window id -> could not parse payload"
    return 1
  fi

  INVALID_WINID=$(printf '%s' "${payload}" | python3 -c '
import json
import sys

windows = json.load(sys.stdin)
ids = [int(win.get("id", 0)) for win in windows if isinstance(win, dict)]
print(max(ids, default=0) + 100000)
')
  return 0
}

start_signal_monitor() {
  MONITOR_LOG="${TEMP_DIR}/gdbus-monitor.log"
  gdbus monitor --session --dest "${DEST}" --object-path "${OBJ}" >"${MONITOR_LOG}" 2>&1 &
  MONITOR_PID=$!
  sleep 1
}

wait_for_pid_window() {
  local expected_pid="$1"
  local deadline=$((SECONDS + 20))

  while (( SECONDS < deadline )); do
    run_call GetWindowsByPID "${expected_pid}"
    if [[ "${CALL_STATUS}" -eq 0 ]]; then
      local payload=""
      if payload=$(unwrap_gdbus_single "${CALL_OUTPUT}" 2>/dev/null); then
        local found=""
        found=$(printf '%s' "${payload}" | jq -r --argjson pid "${expected_pid}" 'first(.[]? | select(.pid == $pid) | .id) // empty')
        if [[ -n "${found}" ]]; then
          printf '%s\n' "${found}"
          return 0
        fi
      fi
    fi
    sleep 1
  done

  return 1
}

detect_default_launcher() {
  if command -v gnome-text-editor >/dev/null 2>&1; then
    printf '%s\n' "gnome-text-editor"
    return 0
  fi

  if command -v gnome-terminal >/dev/null 2>&1; then
    printf '%s\n' "gnome-terminal"
    return 0
  fi

  return 1
}

launch_disposable_window() {
  local launcher="$1"

  case "${launcher}" in
    gnome-text-editor)
      local scratch_file="${TEMP_DIR}/window-actions-security-test.txt"
      printf 'window-actions security verification\n' >"${scratch_file}"
      gnome-text-editor --standalone --new-window "${scratch_file}" >/dev/null 2>&1 &
      LAUNCHED_PID=$!
      ;;
    gnome-terminal)
      gnome-terminal --wait --title "window-actions-security-test" -- bash -lc 'exec sleep 600' >/dev/null 2>&1 &
      LAUNCHED_PID=$!
      ;;
    *)
      return 1
      ;;
  esac

  sleep 1
  return 0
}

assert_monitor_contains() {
  local description="$1"
  local pattern="$2"

  if grep -Fq "${pattern}" "${MONITOR_LOG}"; then
    record_pass "${description}"
  else
    record_fail "${description} -> pattern not found: ${pattern}"
  fi
}

wait_for_monitor_pattern() {
  local description="$1"
  local pattern="$2"
  local deadline=$((SECONDS + 10))

  while (( SECONDS < deadline )); do
    if grep -Fq "${pattern}" "${MONITOR_LOG}"; then
      record_pass "${description}"
      return 0
    fi
    sleep 1
  done

  record_fail "${description} -> pattern not found within timeout: ${pattern}"
  return 1
}

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Window Actions — Security Hardening Verification"
echo "═══════════════════════════════════════════════════════"
echo ""

preflight_session_access

section "Setup"
if load_focused_window; then
  record_pass "Focused window discovery returned a live window"
  echo "  Focused window id: ${WINID}"
  echo "  Focused pid: ${PID}"
  echo "  Focused workspace: ${WORKSPACE}"
  echo "  Focused monitor: ${MONITOR}"
else
  echo "  No focused window available; live-window assertions will be skipped"
fi

if [[ -n "${WINID}" ]]; then
  choose_invalid_winid
fi

section "H-01 GetTitle returns JSON string"
if [[ -n "${WINID}" ]]; then
  run_call GetTitle "${WINID}"
  if [[ "${CALL_STATUS}" -ne 0 ]]; then
    record_fail "GetTitle(${WINID}) -> ${CALL_OUTPUT}"
  else
    TITLE_PAYLOAD=$(unwrap_gdbus_single "${CALL_OUTPUT}")
    if json_eval "${TITLE_PAYLOAD}" 'type == "string" and length >= 0'; then
      record_pass "GetTitle(${WINID}) returns a JSON string payload"
    else
      record_fail "GetTitle(${WINID}) did not return a JSON string: ${TITLE_PAYLOAD}"
    fi

    run_call Details "${WINID}"
    if [[ "${CALL_STATUS}" -ne 0 ]]; then
      record_fail "Details(${WINID}) for GetTitle comparison -> ${CALL_OUTPUT}"
    else
      DETAILS_FOR_TITLE=$(unwrap_gdbus_single "${CALL_OUTPUT}")
      DETAILS_TITLE=$(printf '%s' "${DETAILS_FOR_TITLE}" | jq -c '.title')
      if [[ "${TITLE_PAYLOAD}" == "${DETAILS_TITLE}" ]]; then
        record_pass "GetTitle(${WINID}) matches Details(${WINID}).title"
      else
        record_fail "GetTitle(${WINID}) did not match Details(${WINID}).title"
      fi
    fi
  fi
else
  record_skip "GetTitle live-window checks"
fi

section "H-02 Input validation"
assert_error_contains "ListOnWorkspace rejects invalid high workspace" "Invalid workspaceIndex" ListOnWorkspace 999
assert_error_contains "GetMonitorGeometry rejects negative monitor index" "Invalid monitorIndex" GetMonitorGeometry -- -1
assert_error_contains "GetMonitorGeometry rejects invalid high monitor index" "Invalid monitorIndex" GetMonitorGeometry 999

if [[ -n "${WINID}" ]]; then
  assert_error_contains "MoveToWorkspace validates workspace bounds before mutation" "Invalid workspaceIndex" MoveToWorkspace "${WINID}" 999
  assert_error_contains "MoveResize rejects zero width" "Invalid width" MoveResize "${WINID}" 0 0 0 100
  assert_error_contains "MoveResize rejects zero height" "Invalid height" MoveResize "${WINID}" 0 0 100 0
  assert_error_contains "Resize rejects zero width" "Invalid width" Resize "${WINID}" 0 100
  assert_error_contains "Resize rejects zero height" "Invalid height" Resize "${WINID}" 100 0
else
  record_skip "Mutation validation checks against a live window"
fi

section "Query method schema"
assert_success_json "List() returns a JSON array" 'type == "array"' List

if [[ -n "${WORKSPACE}" ]]; then
  assert_success_json "ListOnWorkspace(${WORKSPACE}) returns a JSON array" 'type == "array"' ListOnWorkspace "${WORKSPACE}"
fi

if [[ -n "${MONITOR}" ]]; then
  assert_success_json "GetMonitorGeometry(${MONITOR}) returns a geometry object" 'type == "object" and (.width | type == "number") and (.height | type == "number") and has("scale_factor") and has("is_primary")' GetMonitorGeometry "${MONITOR}"
fi

if [[ -n "${PID}" ]]; then
  assert_success_json_with_pid "GetWindowsByPID(${PID}) returns an array filtered by pid" "${PID}" 'type == "array" and length >= 1 and all(.[]; .pid == $pid)' GetWindowsByPID "${PID}"
fi

section "Focused window invariants"
if [[ -n "${WINID}" ]]; then
  assert_success_json "GetFocusedWindow() returns an object with focus=true" 'type == "object" and .focus == true and has("id") and has("pid")' GetFocusedWindow

  run_call Details "${WINID}"
  if [[ "${CALL_STATUS}" -ne 0 ]]; then
    record_fail "Details(${WINID}) -> ${CALL_OUTPUT}"
  else
    DETAILS_PAYLOAD=$(unwrap_gdbus_single "${CALL_OUTPUT}")
    if json_eval "${DETAILS_PAYLOAD}" 'type == "object" and has("canclose") and has("canmaximize") and has("canminimize")'; then
      record_pass "Details(${WINID}) keeps expected capability fields"
    else
      record_fail "Details(${WINID}) missing expected capability fields"
    fi

    if json_eval "${DETAILS_PAYLOAD}" 'has("display") | not'; then
      record_pass "Details(${WINID}) no longer exposes display"
    else
      record_fail "Details(${WINID}) still exposes display"
    fi

    if printf '%s' "${DETAILS_PAYLOAD}" | jq -e --argjson winid "${WINID}" --argjson pid "${PID}" '.id == $winid and .pid == $pid' >/dev/null 2>&1; then
      record_pass "Details(${WINID}) matches the focused window id and pid"
    else
      record_fail "Details(${WINID}) did not match the focused window identity"
    fi
  fi

  assert_success_json "GetFrameRect(${WINID}) returns rectangle fields" 'type == "object" and (.x | type == "number") and (.y | type == "number") and (.width | type == "number") and (.height | type == "number")' GetFrameRect "${WINID}"
  assert_success_json "GetFrameBounds(${WINID}) returns frame_bounds" 'type == "object" and has("frame_bounds")' GetFrameBounds "${WINID}"
else
  record_skip "Focused window invariant checks"
fi

section "Invalid window handling"
if [[ -n "${INVALID_WINID}" ]]; then
  assert_error_contains "Details(${INVALID_WINID}) returns Not found" "Not found" Details "${INVALID_WINID}"
  assert_error_contains "GetTitle(${INVALID_WINID}) returns Not found" "Not found" GetTitle "${INVALID_WINID}"
  assert_error_contains "GetFrameRect(${INVALID_WINID}) returns Not found" "Not found" GetFrameRect "${INVALID_WINID}"
else
  record_skip "Invalid window id checks"
fi

section "Signal and close-rate-limit lifecycle"
if [[ "${DESTRUCTIVE_MODE}" == "0" ]]; then
  record_skip "Disposable-window lifecycle tests disabled by WINDOW_ACTIONS_TEST_DESTRUCTIVE=0"
else
  TEMP_DIR=$(mktemp -d)
  start_signal_monitor

  LAUNCHER=""
  if ! LAUNCHER=$(detect_default_launcher); then
    record_skip "Disposable-window lifecycle tests require gnome-text-editor or gnome-terminal"
  elif ! launch_disposable_window "${LAUNCHER}"; then
    record_skip "Disposable-window lifecycle tests could not launch ${LAUNCHER}"
  else
    TEST_WINID=""
    if TEST_WINID=$(wait_for_pid_window "${LAUNCHED_PID}"); then
      record_pass "Disposable window appeared for pid ${LAUNCHED_PID}"

      run_call Close "${TEST_WINID}"
      if [[ "${CALL_STATUS}" -eq 0 ]]; then
        record_pass "Close(${TEST_WINID}) succeeded on disposable window"
      else
        record_fail "Close(${TEST_WINID}) failed: ${CALL_OUTPUT}"
      fi

      run_call Close "${TEST_WINID}"
      if [[ "${CALL_STATUS}" -ne 0 && "${CALL_OUTPUT}" == *"Rate limited"* ]]; then
        record_pass "Close(${TEST_WINID}) enforces rate limiting"
      else
        record_fail "Close(${TEST_WINID}) did not hit rate limit on immediate repeat: ${CALL_OUTPUT}"
      fi

      if grep -Fq "WindowFocusChanged (uint32 ${TEST_WINID}" "${MONITOR_LOG}"; then
        wait_for_monitor_pattern "WindowCreated signal was emitted for the disposable focused window" "WindowCreated (uint32 ${TEST_WINID}"
      else
        record_skip "WindowCreated assertion skipped because the disposable window never took focus"
      fi
      wait_for_monitor_pattern "WindowClosed signal was emitted for the disposable window" "WindowClosed (uint32 ${TEST_WINID}"
    else
      if [[ "${DESTRUCTIVE_MODE}" == "1" ]]; then
        record_fail "Disposable window did not become queryable for launched pid ${LAUNCHED_PID}"
      else
        record_skip "Disposable window did not become queryable; launcher may use a service model"
      fi
    fi
  fi
fi

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Results: ${PASS} passed, ${FAIL} failed, ${SKIP} skipped, ${TOTAL} total"
echo "═══════════════════════════════════════════════════════"
echo ""

if [[ "${FAIL}" -eq 0 ]]; then
  echo "All required checks passed."
else
  echo "Some checks failed."
fi
