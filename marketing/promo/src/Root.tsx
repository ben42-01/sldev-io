import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
import '@fontsource/roboto/latin-100.css'
import '@fontsource/roboto/latin-300.css'
import '@fontsource/jetbrains-mono/latin-200.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-500.css'
import { Composition, continueRender, delayRender } from 'remotion'
import { CLI_DURATION, CliPromo } from './cli/CliPromo'
import { FPS } from './lib'
import { DURATION, Promo, type PromoProps } from './Promo'

// wait for the self-hosted fonts before any frame is captured, or the first frames render in a fallback
const fonts = delayRender('fonts')
void Promise.all(['400 20px Inter', '600 20px Inter', '700 20px Inter', '400 20px "JetBrains Mono"', '100 20px Roboto', '300 20px Roboto', '200 20px "JetBrains Mono"'].map((f) => document.fonts.load(f))).then(() => continueRender(fonts))

export function Root() {
  return (
    <>
      <Composition id="Promo" component={Promo} durationInFrames={DURATION} fps={FPS} width={1920} height={1080} defaultProps={{ music: null } satisfies PromoProps} />
      <Composition id="CliPromo" component={CliPromo} durationInFrames={CLI_DURATION} fps={FPS} width={1920} height={1080} defaultProps={{ music: null } satisfies PromoProps} />
    </>
  )
}
