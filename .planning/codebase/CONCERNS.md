# Concerns & Tech Debt

**1. Testing Infrastructure**
- The total absence of rigorous automated testing (Jest/Vitest) is a major risk, especially when orchestrating complex state flows across multiple interdependent API services (STT, LLMs, external DBs). The proliferation of root-level `test*.js` files clutters the directory and provides brittle validation.

**2. Duplicate Data Stores**
- Both Firebase and Supabase packages and library configurations are present (`firebase.ts`, `supabase.ts`). Transitioning from one BaaS to another might be incomplete, leading to fragmented user data and authentication state mismatches.

**3. Large Page Components**
- Page components like `HRRound.tsx` (60KB+), `Dashboard.tsx` (62KB+), and `Results.tsx` (122KB+) are exceptionally large. This signifies bloated logic, intermingled data-fetching, complex side effects, and lack of UI refactoring into smaller, testable sub-components. 

**4. Secret Management**
- `server/index.ts` accesses `.env` but warns of missing keys. If `api/groq-proxy.ts` isn't secured properly, arbitrary front-end invocation could drain Groq API credits. 

**5. File Organization**
- Server and Serverless structure division: Express application resides in `server/`, but serverless endpoints run in `api/`. This split structure risks divergent API logic if Vercel serverless functions compete with Express routing behaviors. Root directory is highly cluttered with scripts.
