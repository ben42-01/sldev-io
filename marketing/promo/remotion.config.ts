import { Config } from '@remotion/cli/config'

// Remotion reads the JSX mode from tsconfig through TypeScript's `sys`, which TypeScript 7 doesn't
// export, so it falls back to classic JSX ("React is not defined"). Hand its esbuild loader the setting.
type Rule = { loader?: string; options?: Record<string, unknown>; use?: unknown; oneOf?: unknown; rules?: unknown }
function automaticJsx(node: unknown): void {
  if (Array.isArray(node)) return node.forEach(automaticJsx)
  if (!node || typeof node !== 'object') return
  const rule = node as Rule
  if (typeof rule.loader === 'string' && rule.loader.includes('esbuild-loader')) {
    rule.options = { ...rule.options, tsconfigRaw: { compilerOptions: { jsx: 'react-jsx' } } }
  }
  automaticJsx(rule.use)
  automaticJsx(rule.oneOf)
  automaticJsx(rule.rules)
}

Config.overrideWebpackConfig((config) => {
  automaticJsx(config.module?.rules)
  return config
})
Config.setVideoImageFormat('jpeg')
Config.setJpegQuality(92)
