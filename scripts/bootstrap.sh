#!/usr/bin/env bash

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

die() {
  echo "$*" >&2
  exit 1
}

# Shown when a step fails (install bun yourself)
iby='Install it, or install Bun yourself from https://bun.sh.'

# Reads a top-level string from versions.json without needing a JSON parser.
json_value() {
  sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" versions.json | head -n1
}

# True when $1 is at least $2.
version_at_least() {
  local left right index a b
  IFS=. read -r -a left <<<"${1%%[-+]*}"
  IFS=. read -r -a right <<<"${2%%[-+]*}"

  for index in 0 1 2; do
    a="${left[index]:-0}"
    b="${right[index]:-0}"
    a="${a//[^0-9]/}"
    b="${b//[^0-9]/}"
    ((10#${a:-0} > 10#${b:-0})) && return 0
    ((10#${a:-0} < 10#${b:-0})) && return 1
  done
  return 0
}

bun_version() {
  "$1" --version 2>/dev/null | tr -d '[:space:]'
}

fetch() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$2" "$1"
  else
    die "Downloading Bun needs curl or wget. $iby"
  fi
}

# Echoes nothing when the host has no hashing tool.
sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$1" | awk '{print $NF}'
  fi
}

unpack() {
  if command -v unzip >/dev/null 2>&1; then
    unzip -q "$1" -d "$2"
  elif tar -xf "$1" -C "$2" 2>/dev/null; then
    : # bsdtar reads zips, GNU tar does not, hence the order
  else
    die "Unpacking the Bun download needs unzip. $iby"
  fi
}

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) die "Bun has no build for $(uname -s). $iby" ;;
esac

case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  arm64 | aarch64) arch=aarch64 ;;
  *) die "Bun has no build for $(uname -m). $iby" ;;
esac

libc=''
if [ "$os" = linux ] && ldd --version 2>&1 | grep -qi musl; then
  libc='-musl'
fi

# Bun's default x64 builds need AVX2; older CPUs need the -baseline asset.
wants_baseline() {
  [ "$arch" = x64 ] || return 1

  case "$os" in
    linux) grep -qw avx2 /proc/cpuinfo 2>/dev/null && return 1 || return 0 ;;
    darwin) sysctl -n machdep.cpu.leaf7_features 2>/dev/null | grep -qiw avx2 && return 1 || return 0 ;;
  esac
  return 1
}

# Downloads the pinned Bun into bin/.
install_bun() {
  local version="$1" destination="$2" suffix="${3-}"
  local asset archive base tmp expected actual extracted

  asset="bun-$os-$arch$libc$suffix"
  archive="$asset.zip"
  base="https://github.com/oven-sh/bun/releases/download/bun-v$version"
  tmp="$root/.data/tmp/bun-$$"

  echo "Downloading Bun $version ($asset)..."
  rm -rf "$tmp"
  mkdir -p "$tmp"

  fetch "$base/$archive" "$tmp/$archive"
  fetch "$base/SHASUMS256.txt" "$tmp/SHASUMS256.txt"

  expected="$(awk -v name="$archive" '$2 == name || $2 == "*" name { print $1 }' "$tmp/SHASUMS256.txt" | head -n1)"
  [ -n "$expected" ] || die "Bun $version publishes no checksum for $archive."

  actual="$(sha256 "$tmp/$archive")"
  [ -n "$actual" ] || die "Verifying the download needs sha256sum, shasum or openssl. $iby"
  [ "$actual" = "$expected" ] || die "Checksum mismatch for $archive."

  unpack "$tmp/$archive" "$tmp"
  extracted="$(find "$tmp" -type f -name bun | head -n1)"
  [ -n "$extracted" ] || die "The Bun download did not contain a bun binary."

  mkdir -p "$(dirname "$destination")"
  cp "$extracted" "$destination"
  chmod +x "$destination"
  rm -rf "$tmp"

  if [ -z "$(bun_version "$destination")" ] && [ -z "$suffix" ] && [ "$arch" = x64 ]; then
    echo "That build does not run on this CPU; retrying with the baseline build..."
    install_bun "$version" "$destination" '-baseline'
    return
  fi

  echo "Saved Bun to $destination"
}

# Echoes the Bun to run, installing the pinned one if nothing usable is around.
resolve_bun() {
  local pin minimum bundled system
  pin="$(json_value bun)"
  minimum="$(json_value bunMinimum)"
  [ -n "$pin" ] && [ -n "$minimum" ] || die 'versions.json is missing the Bun pins.'

  bundled="$root/bin/bun"
  system="$(command -v bun || true)"

  if [ -n "$system" ] && version_at_least "$(bun_version "$system")" "$minimum"; then
    echo "$system"
    return
  fi

  if [ ! -x "$bundled" ] || [ "$(bun_version "$bundled")" != "$pin" ]; then
    if [ -n "$system" ]; then
      echo "Bun $(bun_version "$system") is older than the required $minimum." >&2
    fi
    if wants_baseline; then
      install_bun "$pin" "$bundled" '-baseline' >&2
    else
      install_bun "$pin" "$bundled" >&2
    fi
  fi

  echo "$bundled"
}

mode="${1:-}"
case "$mode" in
  dev | start) shift ;;
  *) die "usage: ${BASH_SOURCE[0]} <dev|start> [options]" ;;
esac

bun="${BUN_BINARY:-$(resolve_bun)}"

exec "$bun" scripts/runner.ts "$mode" "$@"
