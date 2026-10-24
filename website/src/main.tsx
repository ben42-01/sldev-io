import { createRoot } from 'react-dom/client'
import { App } from './App'
import './fonts'
import './styles.css'

// the home page used to hold every section; old links like /#download go to their page now
const moved: Record<string, string> = { '#download': '/download', '#pricing': '/pricing', '#faq': '/pricing#faq', '#features': '/features' }
if (moved[location.hash]) location.replace(moved[location.hash])

createRoot(document.getElementById('root')!).render(<App />)
