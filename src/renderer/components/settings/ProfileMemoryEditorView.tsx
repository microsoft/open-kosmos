import React from 'react';
import { Navigate } from 'react-router-dom';

const ProfileMemoryEditorView: React.FC = () => (
  <Navigate to="/settings/memex" replace />
);

export default ProfileMemoryEditorView;
