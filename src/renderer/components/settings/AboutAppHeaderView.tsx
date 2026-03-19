import React from 'react';
import '../../styles/Header.css';
import { APP_NAME, BRAND_CONFIG } from '@shared/constants/branding';

// About icon component
const AboutIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2ZM3.5 12C3.5 7.30558 7.30558 3.5 12 3.5C16.6944 3.5 20.5 7.30558 20.5 12C20.5 16.6944 16.6944 20.5 12 20.5C7.30558 20.5 3.5 16.6944 3.5 12ZM12 7.75C12.4142 7.75 12.75 8.08579 12.75 8.5V12.75C12.75 13.1642 12.4142 13.5 12 13.5C11.5858 13.5 11.25 13.1642 11.25 12.75V8.5C11.25 8.08579 11.5858 7.75 12 7.75ZM13 16C13 16.5523 12.5523 17 12 17C11.4477 17 11 16.5523 11 16C11 15.4477 11.4477 15 12 15C12.5523 15 13 15.4477 13 16Z" fill="currentColor"/>
  </svg>
);

const AboutAppHeaderView: React.FC = () => {
  const brandDisplayName = BRAND_CONFIG.productName || APP_NAME;
  
  return (
    <div className="unified-header">
      <div className="header-title">
        <AboutIcon />
        <span className="header-name">About {brandDisplayName}</span>
      </div>
    </div>
  );
};

export default AboutAppHeaderView;
