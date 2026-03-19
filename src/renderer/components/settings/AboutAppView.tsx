import React from 'react';
import AboutAppHeaderView from './AboutAppHeaderView';
import AboutAppContentView from './AboutAppContentView';
import '../../styles/RuntimeSettings.css';

const AboutAppView: React.FC = () => {
  return (
    <div className="runtime-settings-view">
      <AboutAppHeaderView />
      <AboutAppContentView />
    </div>
  );
};

export default AboutAppView;
