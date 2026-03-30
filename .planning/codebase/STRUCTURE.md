# Project Structure

The codebase is organized as a monolithic repository that holds both the client application and a lightweight API server.

**Root Directory**
-   `package.json`, `vite.config.ts`, `tsconfig.json`: Project root config prioritizing the frontend.
-   `vercel.json`: Vercel edge/serverless routing overrides.
-   `test*.js`: Collection of individual testing scripts (like `test-did-agent.js`, `test_sarvam.js`), likely built explicitly for trying isolated API modules.

**Frontend (`src/`)**
-   `components/`: Reusable UI elements (Navbar, SPLINE wrapper, ErrorBoundary, IntervierAvatar, VideoPlayer).
-   `contexts/`: React Contexts providing global data flows (`AuthContext`).
-   `lib/`: Library initialization configs (Firebase, Supabase).
-   `models/`: Data structures/interfaces (`VideoSnippet.ts`).
-   `pages/`: The core views mapped to routes (`LandingPage`, `Dashboard`, `TechnicalRound`, `HRRound`, `Results`, `NERVSummary`, etc.).
-   `services/`: Service classes for wrapping third-party endpoints. Highly modular directory with distinct files mapping to APIs (e.g., `openAIService.ts`, `humeAIService.ts`).
-   `App.tsx`: The primary route and authentication protection wrapper class.

**Backend (`server/`)**
-   `index.ts`: Express application root.
-   `routes/`: Routers separated logically by interview round types (`technicalRound.ts`, `hrRound.ts`, etc.).
-   `package.json`: Separated backend module definition.

**Vercel / Serverless (`api/`)**
-   Contains edge/serverless functions such as `groq-proxy.ts`.
