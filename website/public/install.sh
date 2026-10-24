#!/bin/sh
# Installs sldev-io on Linux (Debian/Ubuntu, .deb) or macOS (.dmg into /Applications).
#   curl -fsSL https://sldev-io.vercel.app/install.sh | sh
# Windows: download the installer from https://sldev-io.vercel.app/#download
set -eu

SITE="${SLDEV_SITE_URL:-https://sldev-io.vercel.app}"

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || die "curl is required"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

fetch() {
  say "Downloading $1"
  curl -fL --progress-bar "$SITE/download/$1" -o "$2" || die "download failed"
}

case "$(uname -s)" in
  Linux)
    [ "$(uname -m)" = x86_64 ] || die "only x86_64 Linux builds are available for now"
    command -v dpkg >/dev/null 2>&1 || die "this installer needs a Debian-based distro (dpkg). Other distros: $SITE/#download"
    sudo=""
    [ "$(id -u)" -eq 0 ] || sudo="sudo"
    fetch linux "$tmp/sldev-io.deb"
    say "Installing (you may be asked for your password)"
    if command -v apt-get >/dev/null 2>&1; then
      # apt-get resolves the package's dependencies, dpkg alone doesn't
      $sudo apt-get install -y "$tmp/sldev-io.deb"
    else
      $sudo dpkg -i "$tmp/sldev-io.deb"
    fi
    say "Done. Start sldev-io from your app menu or run: sldev-io"
    ;;
  Darwin)
    case "$(uname -m)" in
      arm64) platform=mac ;;
      *) platform=mac-intel ;;
    esac
    fetch "$platform" "$tmp/sldev-io.dmg"
    say "Installing into /Applications"
    mnt="$tmp/mnt"
    mkdir "$mnt"
    hdiutil attach -nobrowse -quiet -mountpoint "$mnt" "$tmp/sldev-io.dmg"
    app=$(find "$mnt" -maxdepth 1 -name '*.app' | head -n 1)
    [ -n "$app" ] || { hdiutil detach -quiet "$mnt"; die "no app found in the disk image"; }
    rm -rf "/Applications/sldev-io.app"
    cp -R "$app" /Applications/
    hdiutil detach -quiet "$mnt"
    # builds aren't notarized yet; installing from a terminal skips the Gatekeeper prompt
    xattr -dr com.apple.quarantine /Applications/sldev-io.app 2>/dev/null || true
    say "Done. Open sldev-io from Launchpad or run: open -a sldev-io"
    ;;
  *)
    die "unsupported system. Windows: download the installer from $SITE/#download"
    ;;
esac
