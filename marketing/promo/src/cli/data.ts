// What the CLI video says comes from the website and the CLI itself, so the video and the /cli page agree.
import cliSite from '../../../../website/src/cli/cli.json'
import site from '../../../../website/src/content/site.json'
import pkg from '../../../../cli/package.json'

export const CLI = { ...cliSite, version: pkg.version }
/** the /cli page's address, under the install command on the end card */
export const CLI_URL = `${site.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}/cli`
