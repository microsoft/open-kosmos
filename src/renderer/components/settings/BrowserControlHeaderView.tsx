'use client'

import React from 'react'
import '../../styles/Header.css'

// Browser icon component
const BrowserIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="10" stroke="#272320" strokeWidth="1.5"/>
    <circle cx="12" cy="12" r="4" stroke="#272320" strokeWidth="1.5"/>
    <path d="M21.17 8H12" stroke="#272320" strokeWidth="1.5"/>
    <path d="M3.95 6.06L8.54 14" stroke="#272320" strokeWidth="1.5"/>
    <path d="M10.88 21.94L15.46 14" stroke="#272320" strokeWidth="1.5"/>
  </svg>
)

const BrowserControlHeaderView: React.FC = () => {
  return (
    <div className="unified-header">
      <div className="header-title">
        <BrowserIcon />
        <span className="header-name">Browser Control</span>
      </div>
    </div>
  )
}

export default BrowserControlHeaderView
