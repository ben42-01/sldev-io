import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles/app.css'

// No StrictMode: its double-mount would create and tear down a second dock, and with it live terminals.
createRoot(document.getElementById('root')!).render(<App />)
