import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/globals.css'
import { currentLocale } from './i18n'

// Screen readers and the browser's own translation prompt both read this.
document.documentElement.lang = currentLocale()

const container = document.getElementById('root')
if (!container) throw new Error('Falta el elemento #root')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
