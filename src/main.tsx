import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/App.css'
import './styles/TradeForm.css'
import './styles/TradeDetail.css'
import './styles/Responsive.css'
import './styles/Theme.css'
import './styles/ResponsiveEnhancements.css'
import './styles/Auth.css'
import './styles/ResponsiveOverrides.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
