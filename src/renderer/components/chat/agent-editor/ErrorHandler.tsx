import React from 'react'


import '../../../styles/Agent.css';
interface ErrorHandlerProps {
  error: string | null
  onDismiss?: () => void
  className?: string
}

const ErrorHandler: React.FC<ErrorHandlerProps> = ({
  error,
  onDismiss,
  className = ''
}) => {
  if (!error) return null

  return (
    <div className={`error-handler ${className}`}>
      <div className="error-content">
        <div className="error-icon">⚠️</div>
        <div className="error-message">{error}</div>
        {onDismiss && (
          <button 
            className="error-dismiss"
            onClick={onDismiss}
            aria-label="Dismiss error"
          >
            ×
          </button>
        )}
      </div>

      </div>
  )
}

export default ErrorHandler