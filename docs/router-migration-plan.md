# Page Router Migration Technical Document

## 1. Background and Current State Analysis

The current Kosmos project's main window page switching relies entirely on state management within React components. It primarily controls the visibility of different components through multiple state variables in `App.tsx`.

### 1.1 Current Implementation

In `src/renderer/App.tsx`, the page rendering logic depends on the following state:

*   `isAuthenticated`: Whether the user is authenticated.
*   `showStartup`: Whether to show the startup page.
*   `startupValidationResult`: Startup validation result, used to determine whether to show the login page, error page, or auto-login.
*   `dataReady`: Whether data loading is complete.
*   `window.location.hash`: Used only for determining window type.

The rendering logic is filled with extensive `if/else` conditions:

```tsx
// Pseudocode example
if (!isAuthenticated && !showStartup) return <SignInPage />;
if (showStartup) return <StartupPage />;
if (startupValidationResult) return <SignInPage ... />; // or other handling
if (isAuthenticated && !dataReady) return <DataLoadingPage />;
return <AgentPage />;
```

### 1.2 Existing Problems

1.  **Severe logic coupling**: Page navigation logic is tightly coupled with business state (such as authentication, data loading), making `App.tsx` bloated and difficult to maintain.
2.  **Poor extensibility**: Every new page requires introducing new state variables and modifying the rendering logic.
3.  **Lack of routing capabilities**:
    *   Cannot directly access specific pages via URL (although URL navigation needs are weaker in Electron applications, it is very useful for development debugging and certain feature transitions).
    *   Lacks history management (forward/back).
    *   Cannot leverage standard patterns like Route Guards for access control.
4.  **Difficult deep linking**: Hard to implement direct navigation from external sources (such as system notifications, other windows) to specific views within the application.

## 2. Migration Goals

Introduce a standard routing management library to separate page navigation logic from component state, achieving:

1.  **Declarative route definitions**: Clearly define the mapping between URLs and components.
2.  **Decouple navigation from state**: Use routing hooks for page transitions instead of modifying global state.
3.  **Unified layout management**: Leverage nested routes for consistent layouts (such as sidebar, top bar).
4.  **Better extensibility**: Adding new pages only requires registering routes, without modifying core rendering logic.

## 3. Technical Approach

### 3.1 Core Library Selection

The project already has `react-router-dom` (v6.30.1) installed, so we will use it directly for the migration.

**Note**: The `@types/react-router-dom` version in `package.json` is `^5.3.3`, which is incompatible with v6. It needs to be upgraded to the v6 type definitions (usually included in the `react-router-dom` v6 main package, or install `@types/react-router-dom@latest`; in practice, v6 includes its own type definitions, so the old `@types` package may need to be removed).

### 3.2 Routing Mode

Use **`HashRouter`**.

*   **Reason**: Electron applications typically load local files (`file://` protocol). `BrowserRouter` relies on the HTML5 History API, which can cause path resolution issues under the `file://` protocol (unless complex server rewrite rules are configured). `HashRouter` uses the URL hash portion (`#/path/to/page`), which is the most stable approach in Electron environments and requires no additional configuration.

### 3.3 Route Structure Design

The recommended route structure is as follows:

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

**Note**: The screenshot window has its own independent entry file (`screenshot.html` / `screenshot.tsx`) and does not share the main window's routing system, so it does not need to be configured here.

### 3.4 Route Guards

Create a `RequireAuth` component to protect routes that require authentication (such as `/agent`).

## 4. Migration Implementation Steps

### Step 1: Dependency Adjustments

1.  Remove incompatible type definitions: `npm uninstall @types/react-router-dom` (v6 includes its own types).
2.  Ensure the `react-router-dom` version is correct.

### Step 2: Create Route Configuration Component

Create `src/renderer/routes/AppRoutes.tsx` to define all routes.

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
import { RequireAuth } from './RequireAuth'; // Needs to be created

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

### Step 3: Implement Route Guards

Create `src/renderer/routes/RequireAuth.tsx`.

```tsx
import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthContext } from '../components/auth/AuthProvider';

export const RequireAuth: React.FC = () => {
  const { isAuthenticated, loading } = useAuthContext();
  const location = useLocation();

  if (loading) {
    return <div>Loading...</div>; // Or a unified Loading component
  }

  if (!isAuthenticated) {
    // Redirect to login page, saving current location for post-login redirect
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
};
```

### Step 4: Refactor App.tsx

Wrap the application with `HashRouter` and remove the original state-based conditional logic.

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

Modify `StartupPage`, `SignInPage`, and other components, replacing the original `onComplete` or `setStartupValidationResult` callback logic with navigation using `useNavigate`.

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

## 5. Sub-routes Refactoring

In addition to the top-level routing in `App.tsx`, `AgentPage` and its child components (`AppLayout`, `ContentContainer`) also contain extensive view switching logic that needs to be refactored into nested routes.

### 5.1 Current State Analysis

*   **`AgentPage`**: Serves as the main entry point, rendering `AppLayout`.
*   **`AppLayout`**: Renders `LeftNavigation` and `ContentContainer`.
*   **`LayoutProvider`**: Maintains the `activeView` state (`chat` | `mcp` | `skills` | `memory` | `settings-page`).
*   **`LeftNavigation`**: Switches views via `setActiveView`.
*   **`ContentContainer`**: Renders different components (`ChatView`, `McpView`, etc.) based on `activeView`.

This pattern forces `ContentContainer` to receive all props required by its child views and pass them through (prop drilling), increasing coupling between components.

### 5.2 Refactoring Approach

1.  **`AgentPage` as a layout component**:
    *   `AgentPage` will serve as the layout component for the `/agent` route.
    *   It will continue to be responsible for fetching global chat state (such as `messages`, `streamingMessage`) and passing it to child routes via `Outlet` context.

2.  **`AppLayout` & `ContentContainer`**:
    *   `AppLayout` remains unchanged, responsible for the overall layout structure.
    *   `ContentContainer` will no longer switch components based on `activeView`, but will instead directly render `<Outlet />`.
    *   Remove the extensive prop drilling in `ContentContainer`, and instead have child view components obtain data directly using Context or Hooks.

3.  **`LeftNavigation`**:
    *   Replace click events (`onClick`) with the `NavLink` component.
    *   `NavLink` automatically handles the active state (active class), eliminating the need to manually check `activeView`.

    ```tsx
    // Before
    <NavItem onClick={() => setActiveView('mcp')} isActive={activeView === 'mcp'} ... />

    // After
    <NavLink to="/agent/mcp" className={({ isActive }) => isActive ? 'active' : ''}>
      <NavItem ... />
    </NavLink>
    ```

4.  **Data passing optimization**:
    *   For data like `messages` needed by `ChatView`, it can be obtained via `useOutletContext`, or elevated to an independent Context (`ChatContext`). Since `AgentPage` already holds this state, using the `Outlet` context property provides a smooth transition.

    ```tsx
    // AgentPage.tsx
    <Outlet context={{ messages, onSendMessage, ... }} />

    // ChatView.tsx
    const { messages } = useOutletContext<ChatContextType>();
    ```

## 6. Risks and Considerations

1.  **State passing**: The original `startupValidationResult` was passed via Props. After the migration, it needs to be passed through React Router's `state` property, or managed in a global Context (such as `StartupContext`). For complex startup data, using Context or a global Store is recommended.
2.  **Screenshot window**: The screenshot window is a separate Electron window that may carry a specific hash when loaded. Ensure `HashRouter` handles this correctly.
3.  **Lifecycle**: Route transitions cause components to unmount and remount. Check whether any components depend on the assumption of "always existing" (for example, certain `useEffect` hooks that run only once at app startup). If state persistence is needed, the state may need to be elevated to Context or managed with a state management library.
4.  **Style compatibility**: Ensure that route containers (`Routes`, `Outlet`) do not break existing CSS layouts (such as `flex`, `h-screen`, etc.).

## 7. Summary

By introducing `react-router-dom`, the Kosmos project will gain standard routing management capabilities, resulting in a cleaner code structure and a solid foundation for future multi-page feature extensions (such as settings pages, independent chat windows, etc.).

## 8. Implementation Progress Tracking (TODO List)

### Phase 1: Basic Environment and Top-Level Routing

- [x] **Dependency management**
    - [x] Remove incompatible `@types/react-router-dom` (v5).
    - [x] Confirm `react-router-dom` (v6) is installed correctly.

- [x] **Route component creation**
    - [x] Create `src/renderer/routes/RequireAuth.tsx` (route guard).
    - [x] Create `src/renderer/routes/AppRoutes.tsx` (route configuration).

- [x] **App.tsx refactoring**
    - [x] Introduce `HashRouter`.
    - [x] Remove state variables used for page switching such as `showStartup`, `startupValidationResult`, etc.
    - [x] Replace original conditional rendering logic with `<AppRoutes />`.

- [x] **Page component adaptation (top-level)**
    - [x] `StartupPage`: Replace `onComplete` callback with `useNavigate` navigation.
    - [x] `SignInPage`: Navigate to `/agent` using `useNavigate` after successful login.
    - [x] `DataLoadingPage`: Navigate after loading completes.
    - [x] Verify screenshot standalone window routing works correctly.

### Phase 2: Sub-routes and Layout Refactoring (AgentPage)

- [ ] **AgentPage refactoring (Layout)**
    - [ ] Refactor `AgentPage` to use `<Outlet />` for rendering child content.
    - [ ] Pass shared state such as `messages`, `streamingMessage` via `Outlet.context` or Context API.

- [ ] **AppLayout & ContentContainer refactoring**
    - [ ] `ContentContainer`: Remove `activeView` conditional logic, render `<Outlet />` directly.
    - [ ] Clean up props no longer needed for prop drilling in `ContentContainer`.

- [ ] **LeftNavigation refactoring**
    - [ ] Replace `onClick` event handlers with `<NavLink>` for view switching.
    - [ ] Remove `activeView` state from `LayoutProvider` (if no longer needed).

- [ ] **Child view component adaptation**
    - [ ] `ChatView`: Adapt to obtain data from `useOutletContext`.
    - [ ] `McpView`: Adapt to route parameters (if applicable).
    - [ ] `SkillsView`, `MemoryView`, `SettingsPage`: Ensure they render correctly under sub-routes.

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


