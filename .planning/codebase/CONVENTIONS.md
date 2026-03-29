# Conventions

**Code Style & Typing**
- Almost exclusively **TypeScript** (`.ts`, `.tsx`), with strict compilation options enabled (`tsconfig.json`).
- Prefer functional components utilizing React Hooks (`react-use`, `useEffect`, `useState`).

**Routing & Protection**
- The app utilizes a `ProtectedRoute` wrapper component within `App.tsx` that redirects unauthenticated users back to `/login` via React Router.

**Error Handling**
- Component-level error handling via `<ErrorBoundary>` wrapper component.
- The service layer wraps external calls inside try/catch blocks and generally promises returning structured responses or raising console warnings. 
- Example: `index.ts` gracefully warns if `GEMINI_API_KEY` is not present, failing cleanly rather than crashing the startup loop unconditionally.

**State Management**
- Shared state relies on React Context (`AuthContext`).
- Highly isolated processing states for individual interview rounds remain localized to high-order Page components (`TechnicalRound.tsx`, `HRRound.tsx`), reducing global state leakage.

**Styling Rules**
- Purely reliant on **Tailwind CSS**. Custom classes mapped in `index.css`.
- Classes follow typical utility-first ordering; semantic classes are rarely used except for global tokens (`font-inter`, `bg-primary`).
