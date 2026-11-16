/** Set by vite.config.ts from cli/package.json. */
declare const __CLI_VERSION__: string

/** The built CLI's `sldev help`, parsed at build time (vite.config.ts, scripts/cliHelp.ts). */
declare module 'virtual:cli-help' {
  const help: import('../scripts/cliHelp').CliHelp
  export default help
}
