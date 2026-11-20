import { createRoot } from 'react-dom/client'
import { App } from './App'
import './fonts'
import './styles.css'

// the home page used to hold every section; old links like /#download go to their page now
const moved: Record<string, string> = {
  '#download': '/download',
  // the app's landing page moved to /app when the home page became the sldev family's
  '#how': '/app#how',
  '#free': '/app#free',
  '#pricing': '/app#free',
  '#faq': '/app#faq',
  // the deep dives went to /features when the home page became one argument
  '#lead': '/features#lead',
  '#board': '/features#board',
  '#evals': '/features#evals',
  '#why': '/features#why',
  '#limits': '/features#limits',
  '#context': '/features#context'
}
if (moved[location.hash]) location.replace(moved[location.hash])

createRoot(document.getElementById('root')!).render(<App />)
