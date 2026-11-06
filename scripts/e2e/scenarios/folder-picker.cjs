// Open folder / Browse… start the folder picker in the open project, or in the home folder when none is open
// (without a start the OS dialog picks its own place, often Downloads). The native dialog is stubbed to record it.
const os = require('os')
const { dialog } = require('electron')

module.exports = async (h) => {
  const asked = []
  const real = dialog.showOpenDialog
  dialog.showOpenDialog = async (_win, opts) => {
    asked.push(opts.defaultPath)
    return { canceled: true, filePaths: [] }
  }
  try {
    // no project: the Explorer's Open folder
    await h.js(`window.api.settings.set({ rootFolder: null, sidebarVisible: true })`)
    await h.reload()
    await h.wait(1500)
    await h.click('.btn', 'Open folder')
    h.expect(await h.until(() => asked.length === 1, 3000), 'Open folder shows the picker')
    h.expect(asked[0] === os.homedir(), `with no project it starts in the home folder (${asked[0]})`)

    // a project open: the start screen's Browse… starts in it
    await h.openFixture()
    await h.click('.welcome .btn', 'Browse')
    h.expect(await h.until(() => asked.length === 2, 3000), 'Browse… shows the picker')
    h.expect(asked[1] === h.fixture, `with a project open it starts in that project (${asked[1]})`)
  } finally {
    dialog.showOpenDialog = real
  }
}
