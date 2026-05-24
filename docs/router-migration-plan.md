# Router Migration Technical Document

## 1. Background and Current State Analysis

The Kosmos project's main window currently relies entirely on React component internal state management for page switching. This is primarily controlled by multiple state variables in `App.tsx` that govern the visibility of different components.

### 1.1 Current Implementation

In `src/renderer/App.tsx`, the rendering logic mainly depends on these states:

*   `isAuthenticated`: whether the user is authenticated.
*   `showStartup`: whether to show the startup page.
*   `startupValidationResult`: startup validation result, used to decide whether to show the login page, error page, or auto-login.
*   `dataReady`: whether data has finished loading.

The rendering logic is filled with a large number of `if/else` conditions:

```tsx
// Pseudocode example
if (!isAuthenticated && !showStartup) return <SignInPage />;
if (showStartup) return <StartupPage />;
if (startupValidationResult) return <SignInPage ... />; // or other handling
if (isAuthenticated && !dataReady) return <DataLoadingPage />;
return <AgentPage />;
```

### 1.2 Existing Problems

1.  **Tightly coupled logic**: Page navigation logic is tightly coupled with business state (such as authentication, data loading), making `App.tsx` bloated and hard to maintain.
2.  **Poor extensibility**: Adding a new page requires introducing new state variables and modifying the rendering condition logic.
3.  **Lack of routing capability**:
    *   Cannot directly access specific pages via URL (though URL navigation needs are weaker in Electron apps, it is very useful during development/debugging and certain feature jumps).
    *   Lacks history management (forward/back).
    *   Cannot leverage standard patterns like Route Guards for access control.
4.  **Deep linking is difficult**: Hard to implement direct jumps from external sources (e.g., system notifications, other windows) to specific views within the app.

## 2. Migration Goals

Introduce a standard routing management library to extract page navigation logic from component state, achieving:

1.  **Declarative route definitions**: Clearly define the mapping between URLs and components.
2.  **Decouple navigation from state**: Use routing hooks for page navigation instead of modifying global state.
3.  **Unified layout management**: Use nested routes to implement a unified Layout (e.g., sidebar, top bar).
4.  **Better extensibility**: Adding a new page only requires registering a route, without modifying core rendering logic.

## 3. Technical Plan

### 3.1 Core Library Selection

The project already has `react-router-dom` (v6.30.1) installed; use this library directly for migration.

**Note**: The `@types/react-router-dom` version in `package.json` is `^5.3.3`, which is incompatible with v6. It needs to be upgraded to the type definitions for v6 (usually included in the `react-router-dom` v6 main package; v6 comes with its own type definitions, so the old `@types` package may need to be removed).

### 3.2 Router Mode

Use **`HashRouter`**.

*   **Reason**: Electron apps typically load local files (`file://` protocol). `BrowserRouter` relies on the HTML5 History API, which can cause path resolution issues under the `file://` protocol (unless complex server rewrite rules are configured). `HashRouter` uses the URL's hash portion (`#/path/to/page`), which is most stable in Electron environments and requires no additional configuration.

### 3.3 Route Structure Design

Recommended route structure:

```
/                   -> Root path, redirects based on state
/startup            -> Startup check page (StartupPage)
/login              -> Login page (SignInPage)
/loading            -> Data loading page (DataLoadingPage)
/agent              -> Main application page (AgentPage)
  /agent/chat       -> Chat view (ChatView)
  /agent/mcp        -> MCP management view (McpView)
  /agent/skills     -> Skills management view (SkillsView)
  /agent/memory     -> Memory management view (MemoryView)
  /agent/settings   -> Settings page (SettingsPage)
```

### 3.4 Route Guards

Create a `RequireAuth` component to protect routes that require authentication (e.g., `/agent`).

## 4. Migration Implementation Steps

### Step 1: Dependency Adjustment

1.  Remove incompatible type definitions: `npm uninstall @types/react-router-dom` (v6 includes its own types).
2.  Verify the `react-router-dom` version is correct.

### Step 2: Create Route Configuration Component

Create `src/renderer/routes/AppRoutes.tsx` and define all routes.

```tsx
import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { StartupPage } from '../components/pages/StartupPage';
import { SignInPage } from '../components/pages/SignInPage';
import { DataLoadingPage } from '../components/pages/DataLoadingPage';
import { AgentPage } from '../components/pages/AgentPage';
import { ChatView } from '../components/chat/ChatView';
import { McpView } from '../components/mcp/McpView';
import { SkillsView } from '../components/skills/SkillsView';
import { MemoryView } from '../components/memory/MemoryView';
import { SettingsPage } from '../components/pages/SettingsPage';
import { RequireAuth } from './RequireAuth'; // needs to be created

export const AppRoutes: React.FC = () => {
  return (
    <Routes>
      {/* Startup flow routes */}
      <Route path="/startup" element={<StartupPage />} />
      <Route path="/login" element={<SignInPage />} />
      
      {/* Protected routes */}
      <Route element={<RequireAuth />}>
        <Route path="/loading" element={<DataLoadingPage />} />
        <Route path="/agent" element={<AgentPage />}>
          {/* Nested routes */}
          <Route index element={<Navigate to="chat" replace />} />
          <Route path="chat" element={<ChatView />} />
          <Route path="mcp" element={<McpView />} />
          <Route path="skills" element={<SkillsView />} />
          <Route path="memory" element={<MemoryView />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Route>

      {/* Default redirect */}
      <Route path="/" element={<Navigate to="/startup" replace />} />
    </Routes>
  );
};
```

### Step 3: Implement Route Guard

Create `src/renderer/routes/RequireAuth.tsx`.

```tsx
import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthContext } from '../components/auth/AuthProvider';

export const RequireAuth: React.FC = () => {
  const { isAuthenticated, loading } = useAuthContext();
  const location = useLocation();

  if (loading) {
    return <div>Loading...</div>; // or a unified Loading component
  }

  if (!isAuthenticated) {
    // Redirect to login page, saving current location for post-login redirect
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
};
```

### Step 4: Refactor App.tsx

Wrap the application with `HashRouter` and remove the original state-based condition logic.

```tsx
import { HashRouter } from 'react-router-dom';
import { AppRoutes } from './routes/AppRoutes';

// ... imports

const App: React.FC = () => {
  // ... providers setup
  
  return (
    <ToastProvider>
      {/* ... other providers */}
        <AuthProvider>
          <HashRouter>
             <AppRoutes />
          </HashRouter>
        </AuthProvider>
      {/* ... other providers */}
    </ToastProvider>
  );
};
```

### Step 5: Refactor Page Components

Modify `StartupPage`, `SignInPage`, and other components; replace the original `onComplete` or `setStartupValidationResult` callbacks with `useNavigate` for navigation.

**Example (StartupPage):**

```tsx
// Before
props.onComplete(result);

// After
const navigate = useNavigate();
// ...
if (result.recommendedAction === StartupAction.SHOW_USER_SELECTION) {
  navigate('/login', { state: { startupResult: result } });
} else if (/* ... */) {
  navigate('/agent');
}
```

## 5. Sub-component Route Refactoring (Sub-routes Refactoring)

In addition to the top-level routes in `App.tsx`, `AgentPage` and its sub-components (`AppLayout`, `ContentContainer`) also contain a large amount of view-switching logic that needs to be refactored into nested routes.

### 5.1 Current State Analysis

*   **`AgentPage`**: Serves as the main entry point, rendering `AppLayout`.
*   **`AppLayout`**: Renders `LeftNavigation` and `ContentContainer`.
*   **`LayoutProvider`**: Maintains the `activeView` state (`chat` | `mcp` | `skills` | `memory` | `settings-page`).
*   **`LeftNavigation`**: Switches views via `setActiveView`.
*   **`ContentContainer`**: Renders different components (`ChatView`, `McpView`, etc.) based on `activeView`.

This pattern forces `ContentContainer` to receive all Props needed by sub-views and pass them through (Prop Drilling), increasing coupling between components.

### 5.2 Refactoring Plan

1.  **`AgentPage` as a layout component**:
    *   `AgentPage` will serve as the Layout component for the `/agent` route.
    *   It will continue to be responsible for fetching global chat state (such as `messages`, `streamingMessage`) and passing it to sub-routes via the `Outlet` context.

2.  **`AppLayout` & `ContentContainer`**:
    *   `AppLayout` remains unchanged, responsible for the overall layout structure.
    *   `ContentContainer` will no longer switch components based on `activeView`, but will directly render `<Outlet />`.
    *   Remove the heavy Prop drilling from `ContentContainer`; sub-view components should directly use Context or Hooks to get data.

3.  **`LeftNavigation`**:
    *   Replace click events (`onClick`) with the `NavLink` component.
    *   `NavLink` handles active state (active class) automatically, without manually checking `activeView`.

    ```tsx
    // Before
    <NavItem onClick={() => setActiveView('mcp')} isActive={activeView === 'mcp'} ... />

    // After
    <NavLink to="/agent/mcp" className={({ isActive }) => isActive ? 'active' : ''}>
      <NavItem ... />
    </NavLink>
    ```

4.  **Data passing optimization**:
    *   For `messages` and other data needed by `ChatView`, it can be obtained via `useOutletContext`, or lifted into a separate Context (`ChatContext`). Since `AgentPage` already holds this state, using the `Outlet` context attribute is a smooth transition approach.

    ```tsx
    // AgentPage.tsx
    <Outlet context={{ messages, onSendMessage, ... }} />

    // ChatView.tsx
    const { messages } = useOutletContext<ChatContextType>();
    ```

## 6. Risks and Notes

1.  **State passing**: The original `startupValidationResult` was passed via Props. After migration, it needs to be passed via React Router's `state` attribute, or placed in a global Context (such as `StartupContext`). For complex startup data, using Context or a global Store is recommended.
2.  **Lifecycle**: Route switching causes components to unmount and remount. Check whether any components rely on the assumption of "always being present" (e.g., some `useEffect` that runs only once when the app starts). If state needs to be preserved, it may be necessary to lift state to Context or use a state management library.
3.  **Style compatibility**: Ensure routing containers (`Routes`, `Outlet`) do not break existing CSS layouts (e.g., `flex`, `h-screen`, etc.).

## 7. Summary

By introducing `react-router-dom`, the Kosmos project will gain standard routing management capabilities. The code structure will be cleaner, laying a solid foundation for future multi-page feature expansion (such as settings pages, standalone chat windows, etc.).

## 8. Implementation Progress Tracking (TODO List)

### Phase 1: Basic Environment and Top-Level Routes

- [x] **Dependency management**
    - [x] Remove incompatible `@types/react-router-dom` (v5).
    - [x] Confirm `react-router-dom` (v6) is installed correctly.

- [x] **Route component creation**
    - [x] Create `src/renderer/routes/RequireAuth.tsx` (route guard).
    - [x] Create `src/renderer/routes/AppRoutes.tsx` (route configuration).

- [x] **App.tsx refactoring**
    - [x] Introduce `HashRouter`.
    - [x] Remove `showStartup`, `startupValidationResult`, and other states used for page switching.
    - [x] Replace original conditional rendering logic with `<AppRoutes />`.

- [x] **Page component adaptation (top-level)**
    - [x] `StartupPage`: replace `onComplete` callback with `useNavigate` navigation.
    - [x] `SignInPage`: use `useNavigate` to navigate to `/agent` after login.
    - [x] `DataLoadingPage`: navigate after loading completes.

### Phase 2: Sub-routes and Layout Refactoring (AgentPage)

- [ ] **AgentPage refactoring (Layout)**
    - [ ] Change `AgentPage` to render sub-content using `<Outlet />`.
    - [ ] Pass shared state like `messages`, `streamingMessage` via `Outlet.context` or Context API.

- [ ] **AppLayout & ContentContainer refactoring**
    - [ ] `ContentContainer`: remove `activeView` check; directly render `<Outlet />`.
    - [ ] Clean up Prop drilling from `ContentContainer` that is no longer needed.

- [ ] **LeftNavigation refactoring**
    - [ ] Use `<NavLink>` to replace `onClick` event handler for view switching.
    - [ ] Remove `activeView` state from `LayoutProvider` (if no longer needed).

- [ ] **Sub-view component adaptation**
    - [ ] `ChatView`: adapt to get data from `useOutletContext`.
    - [ ] `McpView`: adapt to route parameters (if any).
    - [ ] `SkillsView`, `MemoryView`, `SettingsPage`: ensure they render correctly as sub-routes.

## 5. Implementation Summary (Completed)

The router migration was successfully completed on December 24, 2025.

### 5.1 Implemented Changes

1.  **Router Installation**: `react-router-dom` is now the core routing library.
2.  **Route Configuration**: Created `src/renderer/routes/AppRoutes.tsx` which defines the following routes:
    *   `/`: Startup page (StartupWrapper)
    *   `/login`: Sign-in page (SignInWrapper)
    *   `/auto-login`: Auto-login processing (AutoLoginWrapper)
    *   `/loading`: Data loading page (DataLoadingWrapper)
    *   `/agent`: Protected main application area
        *   `/agent/chat`: Chat view
        *   `/agent/chat/:chatId`: Chat view with specific chat
        *   `/agent/chat/:chatId/:sessionId`: Chat view with specific session
        *   `/agent/mcp`: MCP management
        *   `/agent/skills`: Skills management
        *   `/agent/memory`: Memory view
        *   `/agent/settings`: Settings page
3.  **Auth Protection**: Implemented `RequireAuth` component in `src/renderer/routes/RequireAuth.tsx` to protect `/agent` routes.
4.  **App Component**: Refactored `src/renderer/App.tsx` to remove complex state management (`showStartup`, `startupValidationResult`, etc.) and use `HashRouter` with `AppRoutes`.
5.  **Navigation**: Updated `AppLayout.tsx` and other components to use `useNavigate` hook for navigation instead of `setActiveView`.
6.  **Component Extraction**: Extracted `AutoLoginSingleUser` logic into a standalone component `src/renderer/components/auth/AutoLoginSingleUser.tsx`.

### 5.2 Usage Guide

*   **Navigation**: Use `useNavigate` hook.
    ```tsx
    import { useNavigate } from 'react-router-dom';
    const navigate = useNavigate();
    navigate('/agent/settings');
    ```
*   **Route Parameters**: Use `useParams` hook.
    ```tsx
    import { useParams } from 'react-router-dom';
    const { chatId } = useParams();
    ```
*   **Accessing State**: Route state can be passed via `navigate`.
    ```tsx
    navigate('/login', { state: { startupResult } });
    ```
