# NERV AI Interview System - README

## Overview

NERV is an AI-powered technical interview system that conducts realistic job interviews, analyzes candidate responses, and provides detailed feedback. The system uses facial emotion recognition, speech-to-text, and natural language processing to create an immersive interview experience.

## Features

- **AI-Driven Interviews**: Conducts technical interviews with industry-level questions
- **Emotion Analysis**: Captures and analyzes facial expressions during responses
- **Voice Interaction**: Uses speech recognition and text-to-speech for natural conversation
- **Detailed Results**: Provides comprehensive feedback with emotional analysis
- **Resume Analysis**: Customizes questions based on candidate's resume

## Prerequisites

- Node.js (v16+)
- npm or yarn
- Modern web browser with camera and microphone access

## Environment Setup

This project uses environment variables to store sensitive information like API keys.

1. Create a `.env` file in the root directory
2. Add the following variables to your `.env` file:
   ```
   # Azure OpenAI
   VITE_APP_AZURE_OPENAI_API_KEY=your_azure_openai_api_key
   VITE_APP_AZURE_OPENAI_ENDPOINT=your_azure_openai_endpoint
   VITE_APP_AZURE_OPENAI_DEPLOYMENT=your_deployment_name
   VITE_APP_AZURE_OPENAI_API_VERSION=2023-05-15

   # Azure Speech Services
   VITE_APP_AZURE_TTS_API_KEY=your_azure_tts_api_key
   VITE_APP_AZURE_TTS_REGION=your_azure_region

   # Hume AI (for emotion analysis)
   VITE_HUME_API_KEY=your_hume_api_key
   VITE_HUME_SECRET_KEY=your_hume_secret_key

   # Firebase (for authentication and storage)
   VITE_FIREBASE_API_KEY=your_firebase_api_key
   VITE_FIREBASE_AUTH_DOMAIN=your_firebase_auth_domain
   VITE_FIREBASE_PROJECT_ID=your_firebase_project_id
   VITE_FIREBASE_STORAGE_BUCKET=your_firebase_storage_bucket
   VITE_FIREBASE_MESSAGING_SENDER_ID=your_firebase_messaging_sender_id
   VITE_FIREBASE_APP_ID=your_firebase_app_id
   ```
3. Replace the placeholder values with your actual API keys and configuration details

Note: Never commit your `.env` file to version control. The `.env.example` file is provided as a template.

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/nerv-ai-interview.git
   cd nerv-ai-interview
   ```

2. Install dependencies:
   ```bash
   npm install
   # or
   yarn install
   ```

3. Start the development server:
   ```bash
   npm run dev
   # or
   yarn dev
   ```

4. Open your browser and navigate to `http://localhost:5173`

## Project Structure

```
nerv-ai-interview/
├── public/             # Static assets
├── src/
│   ├── components/     # Reusable UI components
│   ├── contexts/       # React contexts (Auth, etc.)
│   ├── pages/          # Main application pages
│   │   ├── Dashboard.tsx
│   │   ├── Interview.tsx
│   │   ├── Results.tsx
│   │   └── ...
│   ├── services/       # API and service integrations
│   ├── utils/          # Utility functions
│   ├── App.tsx         # Main application component
│   └── main.tsx        # Application entry point
├── .env                # Environment variables
├── package.json        # Dependencies and scripts
└── README.md           # Project documentation
```

## Usage

1. **Sign Up/Login**: Create an account or log in to access the system
2. **Upload Resume**: Upload your resume for personalized interview questions
3. **Start Interview**: Begin the AI-driven interview process
4. **Answer Questions**: Respond to questions verbally while the system analyzes your responses
5. **Review Results**: Get detailed feedback on your performance, including emotional analysis

## Technologies Used

- **Frontend**: React, TypeScript, TailwindCSS
- **AI Services**: Azure OpenAI, Azure Speech Services, Hume AI
- **Authentication**: Firebase Authentication
- **Storage**: Firebase Storage
- **Deployment**: Vercel/Netlify (recommended)

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Azure OpenAI for providing the language model capabilities
- Hume AI for emotion recognition technology
- Firebase for authentication and storage solutions
