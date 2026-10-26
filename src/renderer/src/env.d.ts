declare module '*.css'
/** marketing site, from website/src/content/site.json (or SLDEV_SITE_URL at build time) */
declare const __SITE_URL__: string
/** website/src/content/changelog.json, baked in at build time */
declare const __CHANGELOG__: import('@shared/changelog').ChangelogEntry[]
