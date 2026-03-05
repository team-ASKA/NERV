# Interview API Server

Backend API server for the multi-round interview system.

## Setup

1. Install dependencies:
```bash
cd server
npm install
```

2. Create a `.env` file with:
```
PORT=3001
AZURE_OPENAI_KEY=your_azure_openai_key_here
```

3. Run the server:
```bash
npm run dev
```

## API Endpoints

### Technical Round
- **POST** `/api/technical-round`
- **Body**: `{ emotionScore: string, answer?: string }`
- **Response**: `{ question: string }`

### Project Round
- **POST** `/api/project-round`
- **Body**: `{ emotionScore: string, answer?: string, skills: string[], projects: string[] }`
- **Response**: `{ question: string }`

### HR Round
- **POST** `/api/hr-round`
- **Body**: `{ emotionScore: string, answer?: string, achievements: string[] }`
- **Response**: `{ question: string }`

### Health Check
- **GET** `/health`
- **Response**: `{ status: "OK", message: "Interview API Server is running" }`



