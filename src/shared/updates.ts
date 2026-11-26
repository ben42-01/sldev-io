import type { InstallKind, UpdateStatus } from './types'

/** What main knows about how it was started; pure input so the decision is unit-tested. */
export interface InstallFacts {
  packaged: boolean
  platform: NodeJS.Platform
  /** process.env.APPIMAGE: set by the AppImage runtime to the .AppImage file it runs from */
  appImage?: string
  /** resources/package-type, which electron-builder writes for the .deb (and rpm/pacman) */
  packageType: string | null
}

export function installKind(f: InstallFacts): InstallKind {
  if (!f.packaged) return 'dev'
  if (f.platform === 'win32') return 'windows'
  if (f.platform === 'darwin') return 'mac'
  if (f.platform !== 'linux') return 'dev'
  if (f.appImage) return 'appimage'
  if (f.packageType?.trim() === 'deb') return 'deb'
  return 'linux'
}

/** The AppImage recommended on Linux: installed by install.sh into the user's home, so it can replace itself. */
export const APPIMAGE_HOME = '~/Applications/sldev-io.AppImage'

export interface InstallText {
  /** "AppImage", "Debian package (.deb)" … */
  label: string
  /** what an update does for this install, in a sentence or two */
  update: string
}

/** Settings → About and the update toast: which kind of install this is and what an update will do. */
export function installText(s: Pick<UpdateStatus, 'install' | 'manual'>): InstallText {
  switch (s.install) {
    case 'windows':
      return {
        label: 'Windows installer',
        update: 'Updates download in the background and install when you quit, or right away with Restart to update.'
      }
    case 'mac':
      return s.manual
        ? {
            label: 'macOS app',
            update: "Builds aren't signed yet, so macOS can't install updates itself: Download opens the new .dmg."
          }
        : {
            label: 'macOS app',
            update: 'Updates download in the background and install when you quit, or right away with Restart to update.'
          }
    case 'appimage':
      return s.manual
        ? {
            label: 'AppImage',
            update: `This AppImage is in a folder you can't write to, so it can't replace itself: Download gets the new one. Keep it in your home folder (install.sh puts it at ${APPIMAGE_HOME}) to update automatically.`
          }
        : {
            label: 'AppImage',
            update: 'Updates download in the background and replace the AppImage file when you quit, or right away with Restart to update. No password needed.'
          }
    case 'deb':
      return s.manual
        ? {
            label: 'Debian package (.deb)',
            update:
              'The .deb is installed system-wide, which needs your administrator password, and no graphical password prompt (pkexec) was found: Download gets the new .deb to install with apt. The AppImage updates itself without a password.'
          }
        : {
            label: 'Debian package (.deb)',
            update:
              'Updates download in the background. Installing one asks for your administrator password, because the .deb is installed system-wide under /opt. The AppImage updates itself without a password.'
          }
    case 'linux':
      return {
        label: 'Linux build',
        update: "This build can't update itself. Get new versions from the website (the AppImage updates itself)."
      }
    case 'dev':
      return {
        label: 'Development build',
        update: 'Updates are installed by the packaged app (not in development builds).'
      }
  }
}

/** The /download/<platform> a manual update opens (website/api/download.ts). */
export function downloadPlatform(install: InstallKind, arch: string): string {
  if (install === 'mac') return arch === 'arm64' ? 'mac' : 'mac-intel'
  if (install === 'deb') return 'linux'
  if (install === 'appimage' || install === 'linux') return 'linux-appimage'
  return 'windows'
}

/** The restart dialog's text: a .deb says why the password prompt is coming before it comes. */
export function restartDetail(install: InstallKind, siteUrl: string): string {
  const base = 'Running terminals and agents will be stopped. Your layout and missions come back after the restart.'
  if (install !== 'deb') return base
  return (
    `${base}\n\nsldev-io was installed from the .deb, which lives system-wide under /opt, so your system will ask for ` +
    'your administrator password to install the update. To update without a password from now on, switch to the AppImage ' +
    `(your settings and missions stay): curl -fsSL ${siteUrl}/install.sh | sh`
  )
}

/** The toast when an update is ready (or, for installs that can't update themselves, out): what happens next. */
export function updateToast(s: Pick<UpdateStatus, 'state' | 'version' | 'install' | 'manual'>): string | null {
  if (!s.version) return null
  if (s.state === 'available' && s.manual) return `sldev-io ${s.version} is out. This ${installText(s).label} can't update itself: Settings → About → Download.`
  if (s.state !== 'ready') return null
  if (s.install === 'deb')
    return `sldev-io ${s.version} is ready. Restart to update asks for your administrator password, because the .deb is installed system-wide.`
  if (s.install === 'appimage') return `sldev-io ${s.version} is ready. It replaces the AppImage when you quit, no password needed.`
  return `sldev-io ${s.version} is ready. It installs when you quit, or restart to update now.`
}
