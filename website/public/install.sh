#!/bin/sh
# Installs sldev-io on Linux (Debian/Ubuntu, .deb) or macOS (.dmg into /Applications).
#   curl -fsSL https://sldev-io.vercel.app/install.sh | sh
# Windows: download the installer from https://sldev-io.vercel.app/download
set -eu

SITE="${SLDEV_SITE_URL:-https://sldev-io.vercel.app}"

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || die "curl is required"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

# Downloads the installer for platform $1 to $2 and checks it against the SHA256SUMS of the same release.
# A release from before the checksums (no SHA256SUMS) still installs, with a note.
fetch() {
  # where /download/<platform> points: the installer on this repo's GitHub release
  url=$(curl -fsS -o /dev/null -w '%{redirect_url}' "$SITE/download/$1") || die "couldn't reach $SITE"
  case "$url" in
    */releases/download/*) ;;
    *) die "no installer for this system right now; see $SITE/download" ;;
  esac
  name=${url##*/}
  say "Downloading $name"
  curl -fL --progress-bar "$url" -o "$2" || die "download failed"
  if curl -fsSL "${url%/*}/SHA256SUMS" -o "$tmp/SHA256SUMS" 2>/dev/null; then
    want=$(awk -v n="$name" '$2 == n || $2 == "*" n { print $1 }' "$tmp/SHA256SUMS")
    [ -n "$want" ] || die "$name is not in the release's SHA256SUMS; not installing it"
    got=$(sha256 "$2")
    [ -n "$got" ] || die "sha256sum or shasum is needed to check the download"
    [ "$got" = "$want" ] || die "$name doesn't match the release's SHA256SUMS (got $got, expected $want); not installing it"
    say "Checksum matches the release's SHA256SUMS"
  else
    say "This release has no SHA256SUMS (it predates them); installing without the check"
  fi
}

case "$(uname -s)" in
  Linux)
    [ "$(uname -m)" = x86_64 ] || die "only x86_64 Linux builds are available for now"
    command -v dpkg >/dev/null 2>&1 || die "this installer needs a Debian-based distro (dpkg). Other distros: $SITE/download"
    sudo=""
    [ "$(id -u)" -eq 0 ] || sudo="sudo"
    fetch linux "$tmp/sldev-io.deb"
    say "Installing (you may be asked for your password)"
    if command -v apt-get >/dev/null 2>&1; then
      # apt-get resolves the package's dependencies, dpkg alone doesn't. --allow-downgrades: the
      # website's version is the one to have, and betas (0.1.0~beta.3) sort below a local 0.1.0 build
      $sudo apt-get install -y --allow-downgrades "$tmp/sldev-io.deb"
    else
      $sudo dpkg -i "$tmp/sldev-io.deb"
    fi
    say "Installed sldev-io $(dpkg-query -W -f='${Version}' sldev-io 2>/dev/null | sed 's/~/-/'). Start it from your app menu or run: sldev-io"
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
    die "unsupported system. Windows: download the installer from $SITE/download"
    ;;
esac
