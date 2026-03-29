# Architecture

**Overview**
The NERV Interview Platform is a hybrid application comprising a React Single Page Application (SPA) interacting closely with both BaaS solutions (Firebase, Supabase) and a custom Express backend. It facilitates multi-round interactive interviews, analyzing candidates through extensive AI integration.

**System Layers**
1.  **Frontend SPA (`src/`)**: 
    - Handles complex routing and state for interview rounds (e.g., `TechnicalRound`, `HRRound`, `CoreRound`). 
    - Coordinates UI components (forms, WebRTC video feeds, Spline animations).
2.  **Service Abstraction (`src/services/`)**: 
    - A dedicated layer that intercepts external API calls across various AI tools (Hume AI, OpenAI, Groq, D-ID, Sarvam, Azure Face API). This encapsulates complex logic away from React components.
3.  **Local API Endpoints (`api/`)**: 
    - Potential Vercel serverless functions (like `groq-proxy.ts`) supplementing client routes.
4.  **Backend REST Server (`server/`)**: 
    - An Express backend serving at port 3001, providing core LLM-based logic and interview state processing via distinct routers (`technicalRound`, `projectRound`, `hrRound`, `summary`).

**Data Flow**
-   **Authentication**: Handled primarily via `AuthContext`, abstracting underlying identity providers.
-   **Interview Processing**: 
    - Video/audio captured in the browser (`src/components/VideoPlayer.tsx`).
    - Audio is sent to STT services (Whisper, Sarvam) and returned as text.
    - Text responses or coding actions are handled by components and periodically sent to AI services (Groq, Gemini) via abstraction points in `src/services/`.
    - Backend processes these chunks and issues scores/summations, tracking persistent state in Supabase/Firebase.

**Entry Points**
- **Frontend Entry**: `index.html` -> `src/main.tsx` -> `src/App.tsx`.
- **Backend Entry**: `server/index.ts`.
