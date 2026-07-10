#!/usr/bin/env sh
set -eu

PROGRAM_NAME="iptv-picker"
DEFAULT_MANIFEST_URL="https://github.com/codingriver/iptv-picker/releases/latest/download/latest.json"
MANIFEST_URL="${IPTV_PICKER_MANIFEST_URL:-$DEFAULT_MANIFEST_URL}"
INSTALL_DIR="${IPTV_PICKER_HOME:-$HOME/.local/share/iptv-picker}"
TARGET_OVERRIDE=""
FORCE=0

usage() {
  cat <<'EOF'
Usage:
  autoupdate.sh [options] [install-directory]

Options:
  --force                 reinstall even when the local version is current or newer
  --manifest-url <url>    use a custom latest.json URL
  --target <target>       override detected target, for example linux-x64-musl
  --help, -h              show this help

Environment:
  IPTV_PICKER_HOME          default installation directory
  IPTV_PICKER_MANIFEST_URL  default latest.json URL
EOF
}

fail() {
  printf '%s: %s\n' "$PROGRAM_NAME autoupdate" "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

read_manifest_asset() {
  manifest_file="$1"
  asset_name="$2"
  if command -v jq >/dev/null 2>&1; then
    jq -er --arg name "$asset_name" '
      .version,
      (.assets[] | select(.name == $name) | .url),
      (.assets[] | select(.name == $name) | .sha256),
      (.assets[] | select(.name == $name) | .size)
    ' "$manifest_file"
    return
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$manifest_file" "$asset_name" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as stream:
    manifest = json.load(stream)
asset = next((item for item in manifest.get("assets", []) if item.get("name") == sys.argv[2]), None)
if not asset:
    raise SystemExit(1)
print(manifest["version"])
print(asset["url"])
print(asset["sha256"])
print(asset["size"])
PY
    return
  fi
  if command -v node >/dev/null 2>&1; then
    node - "$manifest_file" "$asset_name" <<'JS'
const fs = require('fs');
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const asset = manifest.assets?.find((item) => item.name === process.argv[3]);
if (!asset) process.exit(1);
console.log(manifest.version);
console.log(asset.url);
console.log(asset.sha256);
console.log(asset.size);
JS
    return
  fi
  fail 'JSON parser not found; install jq or python3'
}

normalize_version() {
  printf '%s' "$1" | sed 's/^v\([0-9]\)/\1/'
}

valid_version() {
  printf '%s' "$1" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+([+-][0-9A-Za-z.-]+)?$'
}

# Prints -1 when left is older, 0 when equal, and 1 when left is newer.
compare_versions() {
  awk -v left="$1" -v right="$2" '
    function parse(value, core, pre, parts, count) {
      sub(/^v/, "", value)
      sub(/\+.*/, "", value)
      pre = ""
      if (value ~ /-/) {
        pre = value
        sub(/^[^-]*-/, "", pre)
        sub(/-.*/, "", value)
      }
      count = split(value, parts, ".")
      core[1] = count >= 1 ? parts[1] + 0 : 0
      core[2] = count >= 2 ? parts[2] + 0 : 0
      core[3] = count >= 3 ? parts[3] + 0 : 0
      return pre
    }
    function numeric(value) { return value ~ /^[0-9]+$/ }
    BEGIN {
      left_pre = parse(left, left_core)
      right_pre = parse(right, right_core)
      for (i = 1; i <= 3; i++) {
        if (left_core[i] < right_core[i]) { print -1; exit }
        if (left_core[i] > right_core[i]) { print 1; exit }
      }
      if (left_pre == right_pre) { print 0; exit }
      if (left_pre == "") { print 1; exit }
      if (right_pre == "") { print -1; exit }
      left_count = split(left_pre, left_parts, ".")
      right_count = split(right_pre, right_parts, ".")
      max = left_count > right_count ? left_count : right_count
      for (i = 1; i <= max; i++) {
        if (i > left_count) { print -1; exit }
        if (i > right_count) { print 1; exit }
        if (left_parts[i] == right_parts[i]) continue
        left_numeric = numeric(left_parts[i])
        right_numeric = numeric(right_parts[i])
        if (left_numeric && right_numeric) {
          print (left_parts[i] + 0 < right_parts[i] + 0) ? -1 : 1
          exit
        }
        if (left_numeric != right_numeric) {
          print left_numeric ? -1 : 1
          exit
        }
        print (left_parts[i] < right_parts[i]) ? -1 : 1
        exit
      }
      print 0
    }
  '
}

detect_target() {
  os="$(uname -s)"
  arch="$(uname -m)"
  case "$os:$arch" in
    Linux:x86_64|Linux:amd64)
      if command -v ldd >/dev/null 2>&1 && ldd --version 2>&1 | grep -qi musl; then
        printf '%s\n' 'linux-x64-musl'
      else
        printf '%s\n' 'linux-x64'
      fi
      ;;
    Linux:i386|Linux:i486|Linux:i586|Linux:i686)
      printf '%s\n' 'linux-x86'
      ;;
    Darwin:x86_64|Darwin:amd64)
      printf '%s\n' 'macos-x64'
      ;;
    Darwin:arm64|Darwin:aarch64)
      printf '%s\n' 'macos-arm64'
      ;;
    Linux:aarch64|Linux:arm64)
      fail 'Linux arm64 release assets are not available'
      ;;
    *)
      fail "unsupported platform: $os $arch"
      ;;
  esac
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    fail 'missing required command: sha256sum or shasum'
  fi
}

read_local_version() {
  if [ -f "$INSTALL_DIR/.iptv-picker-version" ]; then
    tr -d '\r\n ' < "$INSTALL_DIR/.iptv-picker-version"
    return
  fi
  if [ -f "$INSTALL_DIR/.current-release" ]; then
    release_key="$(tr -d '\r\n ' < "$INSTALL_DIR/.current-release")"
    case "$release_key" in
      ''|*/*|*..*) ;;
      *)
        if [ -f "$INSTALL_DIR/releases/$release_key/VERSION" ]; then
          tr -d '\r\n ' < "$INSTALL_DIR/releases/$release_key/VERSION"
          return
        fi
        ;;
    esac
  fi
  if [ -x "$INSTALL_DIR/iptv-picker" ]; then
    "$INSTALL_DIR/iptv-picker" --version 2>/dev/null | awk '/^iptv-picker [^ ]+$/ { print $2; exit }'
  fi
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --force)
      FORCE=1
      shift
      ;;
    --manifest-url)
      [ "$#" -ge 2 ] || fail '--manifest-url requires a value'
      MANIFEST_URL="$2"
      shift 2
      ;;
    --target)
      [ "$#" -ge 2 ] || fail '--target requires a value'
      TARGET_OVERRIDE="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --*)
      fail "unknown option: $1"
      ;;
    *)
      INSTALL_DIR="$1"
      shift
      [ "$#" -eq 0 ] || fail 'only one installation directory may be provided'
      ;;
  esac
done

require_command curl
require_command tar
require_command awk
require_command sed
require_command grep

TARGET="${TARGET_OVERRIDE:-$(detect_target)}"
case "$TARGET" in
  linux-x64|linux-x64-musl|linux-x86|macos-x64|macos-arm64) ;;
  *) fail "unsupported release target: $TARGET" ;;
esac

ASSET_NAME="iptv-picker-$TARGET.tar.gz"
mkdir -p "$INSTALL_DIR"
INSTALL_DIR="$(CDPATH= cd -- "$INSTALL_DIR" && pwd)"
TMP_DIR="$(mktemp -d "$INSTALL_DIR/.update.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT HUP INT TERM

MANIFEST_FILE="$TMP_DIR/latest.json"
ARCHIVE_FILE="$TMP_DIR/$ASSET_NAME"
UNPACK_DIR="$TMP_DIR/unpack"

printf 'Checking %s\n' "$MANIFEST_URL"
curl -fsSL --retry 3 --connect-timeout 15 --user-agent 'iptv-picker-autoupdate/1' \
  "$MANIFEST_URL" -o "$MANIFEST_FILE"

MANIFEST_VALUES="$(read_manifest_asset "$MANIFEST_FILE" "$ASSET_NAME")" || fail "asset not found in latest.json: $ASSET_NAME"
REMOTE_VERSION="$(normalize_version "$(printf '%s\n' "$MANIFEST_VALUES" | sed -n '1p')")"
ASSET_URL="$(printf '%s\n' "$MANIFEST_VALUES" | sed -n '2p')"
EXPECTED_SHA256="$(printf '%s\n' "$MANIFEST_VALUES" | sed -n '3p')"
EXPECTED_SIZE="$(printf '%s\n' "$MANIFEST_VALUES" | sed -n '4p')"

valid_version "$REMOTE_VERSION" || fail "invalid remote version: $REMOTE_VERSION"
printf '%s' "$EXPECTED_SHA256" | grep -Eq '^[0-9a-f]{64}$' || fail 'invalid asset SHA-256'
printf '%s' "$EXPECTED_SIZE" | grep -Eq '^[1-9][0-9]*$' || fail 'invalid asset size'

LOCAL_VERSION="$(read_local_version || true)"
if [ -n "$LOCAL_VERSION" ] && ! valid_version "$LOCAL_VERSION"; then
  printf 'Ignoring invalid local version marker: %s\n' "$LOCAL_VERSION" >&2
  LOCAL_VERSION=""
fi

if [ "$FORCE" -eq 0 ] && [ -n "$LOCAL_VERSION" ]; then
  COMPARISON="$(compare_versions "$LOCAL_VERSION" "$REMOTE_VERSION")"
  if [ "$LOCAL_VERSION" = "$REMOTE_VERSION" ] && [ -x "$INSTALL_DIR/iptv-picker" ] && [ -f "$INSTALL_DIR/.current-release" ]; then
    printf 'Already up to date: %s\n' "$REMOTE_VERSION"
    exit 0
  fi
  if [ "$COMPARISON" -gt 0 ] && [ -x "$INSTALL_DIR/iptv-picker" ] && [ -f "$INSTALL_DIR/.current-release" ]; then
    printf 'Local version %s is newer than remote %s; no downgrade performed\n' "$LOCAL_VERSION" "$REMOTE_VERSION"
    exit 0
  fi
fi

printf 'Installing %s -> %s (%s)\n' "${LOCAL_VERSION:-not installed}" "$REMOTE_VERSION" "$TARGET"
curl -fsSL --retry 3 --connect-timeout 15 --user-agent 'iptv-picker-autoupdate/1' \
  "$ASSET_URL" -o "$ARCHIVE_FILE"

ACTUAL_SIZE="$(wc -c < "$ARCHIVE_FILE" | tr -d ' ')"
[ "$ACTUAL_SIZE" = "$EXPECTED_SIZE" ] || fail "asset size mismatch: expected $EXPECTED_SIZE, got $ACTUAL_SIZE"
ACTUAL_SHA256="$(sha256_file "$ARCHIVE_FILE")"
[ "$ACTUAL_SHA256" = "$EXPECTED_SHA256" ] || fail 'asset SHA-256 mismatch'

ARCHIVE_PREFIX="iptv-picker-$TARGET/"
tar -tzf "$ARCHIVE_FILE" | awk -v prefix="$ARCHIVE_PREFIX" '
  index($0, prefix) != 1 || $0 ~ /(^|\/)\.\.(\/|$)/ { invalid = 1 }
  END { exit invalid ? 1 : 0 }
' || fail 'archive contains an unexpected path'

mkdir -p "$UNPACK_DIR"
tar -xzf "$ARCHIVE_FILE" -C "$UNPACK_DIR"
PAYLOAD_DIR="$UNPACK_DIR/iptv-picker-$TARGET"
[ -f "$PAYLOAD_DIR/iptv-picker" ] && [ -x "$PAYLOAD_DIR/iptv-picker" ] && [ ! -L "$PAYLOAD_DIR/iptv-picker" ] || \
  fail 'archive does not contain a regular executable iptv-picker'

if [ -f "$PAYLOAD_DIR/VERSION" ]; then
  PACKAGE_VERSION="$(tr -d '\r\n ' < "$PAYLOAD_DIR/VERSION")"
  [ "$PACKAGE_VERSION" = "$REMOTE_VERSION" ] || fail "package version mismatch: expected $REMOTE_VERSION, got $PACKAGE_VERSION"
else
  printf '%s\n' "$REMOTE_VERSION" > "$PAYLOAD_DIR/VERSION"
fi

RELEASE_KEY="$REMOTE_VERSION-$TARGET-$(printf '%s' "$EXPECTED_SHA256" | cut -c1-12)"
RELEASES_DIR="$INSTALL_DIR/releases"
RELEASE_DIR="$RELEASES_DIR/$RELEASE_KEY"
mkdir -p "$RELEASES_DIR" "$INSTALL_DIR/config" "$INSTALL_DIR/data" "$INSTALL_DIR/res" "$INSTALL_DIR/publish"
[ ! -L "$RELEASE_DIR" ] || fail "release directory must not be a symbolic link: $RELEASE_DIR"

if [ ! -d "$RELEASE_DIR" ]; then
  mv "$PAYLOAD_DIR" "$RELEASE_DIR"
elif [ ! -x "$RELEASE_DIR/iptv-picker" ]; then
  fail "existing release directory is incomplete: $RELEASE_DIR"
fi

if [ -d "$RELEASE_DIR/config" ]; then
  for file in "$RELEASE_DIR"/config/*; do
    [ -e "$file" ] || continue
    name="$(basename "$file")"
    [ -e "$INSTALL_DIR/config/$name" ] || cp -R "$file" "$INSTALL_DIR/config/$name"
  done
fi

CURRENT_TMP="$INSTALL_DIR/.current-release.$$"
printf '%s\n' "$RELEASE_KEY" > "$CURRENT_TMP"
mv -f "$CURRENT_TMP" "$INSTALL_DIR/.current-release"

WRAPPER_TMP="$INSTALL_DIR/.iptv-picker.$$"
cat > "$WRAPPER_TMP" <<'EOF'
#!/usr/bin/env sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
RELEASE_KEY="$(tr -d '\r\n ' < "$ROOT/.current-release")"
case "$RELEASE_KEY" in
  ''|*/*|*..*)
    printf 'iptv-picker: invalid release pointer\n' >&2
    exit 1
    ;;
esac
cd "$ROOT"
exec "$ROOT/releases/$RELEASE_KEY/iptv-picker" "$@"
EOF
chmod +x "$WRAPPER_TMP"
mv -f "$WRAPPER_TMP" "$INSTALL_DIR/iptv-picker"

VERSION_TMP="$INSTALL_DIR/.iptv-picker-version.$$"
printf '%s\n' "$REMOTE_VERSION" > "$VERSION_TMP"
mv -f "$VERSION_TMP" "$INSTALL_DIR/.iptv-picker-version"

printf 'Installed iptv-picker %s\n' "$REMOTE_VERSION"
printf 'Run: %s\n' "$INSTALL_DIR/iptv-picker"
