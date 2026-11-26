#!/bin/sh
# Installs sldev-io on Linux or macOS (.dmg into /Applications).
#   curl -fsSL https://sldev-io.vercel.app/install.sh | sh
# Linux gets the AppImage in ~/Applications with an app-menu entry: no root, and it updates itself
# without a password. For the system-wide .deb instead (Debian/Ubuntu; updating it asks for your password):
#   curl -fsSL https://sldev-io.vercel.app/install.sh | sh -s -- --deb
# Windows: download the installer from https://sldev-io.vercel.app/download
set -eu

SITE="${SLDEV_SITE_URL:-https://sldev-io.vercel.app}"

say() { printf '\033[1m==>\033[0m %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

linux=appimage
for arg in "$@"; do
  case "$arg" in
    --deb) linux=deb ;;
    --appimage) linux=appimage ;;
    *) die "unknown option: $arg (use --deb or --appimage)" ;;
  esac
done

command -v curl >/dev/null 2>&1 || die "curl is required"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

fetch() {
  say "Downloading $1"
  curl -fL --progress-bar "$SITE/download/$1" -o "$2" || die "download failed"
}

install_deb() {
  command -v dpkg >/dev/null 2>&1 || die "the .deb needs a Debian-based distro (dpkg). Run this without --deb for the AppImage"
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
  say "Updates install from the app and ask for your password. To update without one, run this script without --deb."
}

# The AppImage lives in the user's home, so the app can replace its own file on update (no root).
# Its name has no version on purpose: electron-updater then overwrites it in place, and the launcher
# and app-menu entry below keep pointing at it.
install_appimage() {
  [ "$(id -u)" -ne 0 ] || die "run this as your own user, not root: the AppImage goes into your home folder so it can update itself"
  apps="$HOME/Applications"
  bin="$HOME/.local/bin"
  data="${XDG_DATA_HOME:-$HOME/.local/share}"
  image="$apps/sldev-io.AppImage"
  mkdir -p "$apps" "$bin" "$data/applications" "$data/icons/hicolor/512x512/apps"
  fetch linux-appimage "$tmp/sldev-io.AppImage"
  chmod 755 "$tmp/sldev-io.AppImage"
  # a running copy keeps its old file open; replacing the name is safe and takes effect on the next start
  mv -f "$tmp/sldev-io.AppImage" "$image"
  ln -sf "$image" "$bin/sldev-io"
  # the icon comes out of the AppImage itself (extracting needs no FUSE)
  if (cd "$tmp" && "$image" --appimage-extract 'usr/share/icons/hicolor/512x512/apps/*' >/dev/null 2>&1); then
    for icon in "$tmp"/squashfs-root/usr/share/icons/hicolor/512x512/apps/*.png; do
      [ -f "$icon" ] && cp -f "$icon" "$data/icons/hicolor/512x512/apps/sldev-io.png"
      break
    done
  fi
  # same file name as the .deb's entry, so the two don't show up twice when both are installed
  cat > "$data/applications/sldev-io.desktop" <<DESKTOP
[Desktop Entry]
Name=sldev-io
Comment=The terminal-first workspace for agentic coding
Exec="$image" %U
Icon=sldev-io
Terminal=false
Type=Application
Categories=Development;
StartupWMClass=sldev-io
DESKTOP
  if command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database "$data/applications" >/dev/null 2>&1 || true; fi
  say "Installed sldev-io into $image. Start it from your app menu or run: sldev-io"
  case ":$PATH:" in *":$bin:"*) ;; *) say "Add $bin to your PATH to run sldev-io from a terminal." ;; esac
  say "It updates itself, no password needed."
  if command -v dpkg-query >/dev/null 2>&1 && dpkg-query -W -f='${Status}' sldev-io 2>/dev/null | grep -q 'install ok installed'; then
    say "The .deb is installed too. Settings and missions are shared, so you can remove it: sudo apt remove sldev-io"
  fi
}

case "$(uname -s)" in
  Linux)
    [ "$(uname -m)" = x86_64 ] || die "only x86_64 Linux builds are available for now"
    if [ "$linux" = deb ]; then install_deb; else install_appimage; fi
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
