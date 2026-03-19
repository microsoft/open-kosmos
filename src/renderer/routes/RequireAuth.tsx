import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthContext } from '../components/auth/AuthProvider';

export const RequireAuth: React.FC = () => {
  const { isAuthenticated, loading } = useAuthContext();
  const location = useLocation();

  if (loading) {
    return (
      <div className="h-full flex flex-col glass-container">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center glass-card p-12 max-w-sm mx-auto">
            <div className="relative w-16 h-16 mx-auto mb-6">
              <div className="absolute inset-0 border-4 border-primary-500/30 rounded-full"></div>
              <div className="absolute inset-0 border-4 border-primary-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
            <h2 className="text-xl font-semibold text-neutral-700 mb-2">Loading...</h2>
            <p className="text-neutral-500 text-sm">Verifying authentication...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    // Redirect to login page, saving current location for post-login redirect
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
};
