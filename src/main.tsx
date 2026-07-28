import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

/**
 * The faces are bundled, not fetched. Loading them from Google meant the viewer
 * called a third party every time it opened — which is the wrong behaviour for
 * a tool whose whole claim is that nothing leaves your machine, and it left the
 * deck rendering in fallback type with no network at all.
 *
 * Only the weights `app.css` actually asks for: display 400, body 400–700,
 * the handwritten accent at 600, mono 400–500.
 */
import '@fontsource/instrument-serif/400.css'
import '@fontsource/instrument-serif/400-italic.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/caveat/600.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'

import App from './App'
import './app.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
