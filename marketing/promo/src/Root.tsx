import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-500.css'
import { Composition, continueRender, delayRender } from 'remotion'
import { FPS } from './lib'
import { DURATION, Promo, type PromoProps } from './Promo'

// wait for the self-hosted fonts before any frame is captured, or the first frames render in a fallback
const fonts = delayRender('fonts')
void Promise.all(['400 20px Inter', '600 20px Inter', '700 20px Inter', '400 20px "JetBrains Mono"'].map((f) => document.fonts.load(f))).then(() => continueRender(fonts))

export function Root() {
  return <Composition id="Promo" component={Promo} durationInFrames={DURATION} fps={FPS} width={1920} height={1080} defaultProps={{ music: null } satisfies PromoProps} />
}
