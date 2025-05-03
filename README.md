# NERV AI Interview System - README

## Overview

NERV is an AI-powered technical interview system that conducts realistic job interviews, analyzes candidate responses, and provides detailed feedback. The system uses facial emotion recognition, speech-to-text, and natural language processing to create an immersive interview experience.

## Features

- **AI-Driven Interviews**: Conducts technical interviews with industry-level questions
- **Emotion Analysis**: Captures and analyzes facial expressions during responses
- **Voice Interaction**: Uses speech recognition and text-to-speech for natural conversation
- **Detailed Results**: Provides comprehensive feedback with emotional analysis
- **Resume Analysis**: Customizes questions based on candidate's resume

## Retrieval Augmented Generation (RAG) Procedure

NERV uses a sophisticated Retrieval Augmented Generation (RAG) system to generate contextually relevant interview questions based on:

1. **Candidate's Technical Stack**: Questions are tailored to specific technologies
2. **Emotional State**: The system adapts questions based on detected emotions
3. **Previous Questions**: Ensures questions don't repeat and follow a logical flow

### RAG Implementation

Our implementation uses Azure OpenAI services with the following components:

1. **Document Preparation**:
   - PDF of interview questions is loaded and processed
   - Text is split into semantic chunks (400 tokens with 40 token overlap)
   - Chunks are embedded using Azure's text-embedding-ada-002 model

2. **Vector Storage**:
   - Embeddings are stored in a FAISS vector database
   - Enables fast semantic similarity search

3. **Contextual Retrieval**:
   - System crafts a query combining tech stack and emotion
   - Retrieves the most relevant question contexts from the vector store
   - Top 5 most similar chunks are retrieved

4. **Question Generation**:
   - Retrieved contexts are sent to Azure's GPT-4o model
   - LLM generates appropriate questions based on context, emotion, and history
   - Low temperature (0.1) ensures consistent, focused responses

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

## Deploying to Vercel

NERV is designed to be easily deployed to Vercel without requiring a separate backend:

1. **Prepare for deployment**:
   - Ensure all API endpoints point to deployed Azure services
   - Verify environment variables are correctly configured

2. **Create a `vercel.json` file**:
   ```json
   {
     "framework": "vite",
     "buildCommand": "npm run build",
     "outputDirectory": "dist",
     "rewrites": [
       { "source": "/(.*)", "destination": "/index.html" }
     ]
   }
   ```

3. **Deploy using Vercel Dashboard**:
   - Push your code to GitHub, GitLab, or Bitbucket
   - Import the repository in Vercel dashboard
   - Configure environment variables
   - Deploy

## Backend RAG API Implementation

```python
# FastAPI for RAG Question Generation
import os
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field
from typing import List, Optional
import logging
from fastapi.middleware.cors import CORSMiddleware

# Langchain Imports
from langchain_openai import AzureChatOpenAI, AzureOpenAIEmbeddings
from langchain_community.vectorstores import FAISS
from langchain_community.document_loaders import PyPDFLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter

# --- Configuration ---
AZURE_OPENAI_API_KEY = os.getenv("AZURE_OPENAI_API_KEY")
AZURE_OPENAI_BASE = "https://kushal43.openai.azure.com"
AZURE_OPENAI_API_VERSION = "2025-01-01-preview"
AZURE_EMBEDDING_DEPLOYMENT = "text-embedding-ada-002"
AZURE_CHAT_DEPLOYMENT = "gpt-4o"

PDF_FILE = "QUESTIONS.pdf"
FAISS_INDEX_PATH = "faiss_index_colab"
CHUNK_SIZE = 400
CHUNK_OVERLAP = 40

# Configure logging
logger = logging.getLogger(__name__)

# --- Pydantic Models ---
class InterviewInput(BaseModel):
    emotion: str = Field(..., description="Perceived emotion...")
    tech_stack: List[str] = Field(..., description="List of relevant technical skills/topics for PDF query.")
    previous_questions: Optional[List[str]] = Field(None, description="List of questions already asked.")

class InterviewResponse(BaseModel):
    question: str

# --- FastAPI App ---
app = FastAPI(
    title="AI Interview Assistant API",
    version="1.7.0"
)

# --- CORS ---
origins = [
    "http://localhost:3000", "http://localhost", "http://localhost:8080", "http://127.0.0.1:3000",
]
app.add_middleware(
    CORSMiddleware, allow_origins=origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)

# --- Core Logic ---
def load_or_create_vector_store(pdf_path: str, index_path: str, embeddings_model):
    # Load existing index or create new one from PDF
    if os.path.exists(index_path):
        try:
            vectorstore = FAISS.load_local(index_path, embeddings_model, allow_dangerous_deserialization=True)
            return vectorstore
        except Exception as e:
            logger.warning(f"Failed to load existing index: {e}. Recreating index.")
    
    # Create new index from PDF
    loader = PyPDFLoader(pdf_path)
    documents = loader.load()
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=CHUNK_SIZE, chunk_overlap=CHUNK_OVERLAP)
    text_chunks = text_splitter.split_documents(documents)
    vectorstore = FAISS.from_documents(text_chunks, embeddings_model)
    vectorstore.save_local(index_path)
    return vectorstore

def generate_interview_question(llm, retriever, emotion: str, tech_stack: List[str], previous_questions: List[str]) -> str:
    # Generate specific query combining tech stack and emotion
    tech_stack_str = " ".join(tech_stack)
    query = f"Interview questions for {tech_stack_str} when candidate is feeling {emotion}"
    
    # Retrieve relevant context from vector store
    docs = retriever.get_relevant_documents(query)
    context = "\n\n---\n\n".join([f"Retrieved Context Snippet {i+1}:\n{doc.page_content}" for i, doc in enumerate(docs[:3])])
    
    # Format history of previous questions
    history_string = "None yet."
    if previous_questions:
        history_string = "\n".join([f"- {q}" for q in previous_questions])
    
    # Create prompt for question generation
    prompt = f"""
You are an AI generating the *next* interview question for a candidate interested in {', '.join(tech_stack)}.
The candidate seems {emotion}.

**CONTEXT:**
- The 'Reference Context' below was specifically retrieved from a PDF section containing questions for candidates interested in '{", ".join(tech_stack)}' who seem '{emotion}'.
- 'Previously Asked Questions' lists questions already asked in this session.

**YOUR TASK:**
1.  **Select the BEST question snippet** from the 'Reference Context' below that fits the situation.
2.  **Rephrase** the selected question slightly to make it conversational, while keeping the core meaning.
3.  The generated question **MUST NOT** be identical or substantially similar to any question in 'Previously Asked Questions'.
4.  If the 'Reference Context' is empty, shows an error, or contains no usable question snippets despite the specific search, then output ONLY the exact phrase: "Tell me about a project you're proud of using {tech_stack_str}."

**Reference Context:**
---
{context}
---

**Previously Asked Questions:**
---
{history_string}
---

**Next Interview Question:**
"""
    
    # Generate question using LLM
    response = llm.invoke(prompt)
    question = response.content.strip()
    
    # Clean up response and return
    return question

# --- FastAPI Endpoints ---
@app.post("/next-question", response_model=InterviewResponse)
async def get_next_question(interview_input: InterviewInput, request: Request):
    # Process request and generate next question
    llm = request.app.state.llm
    retriever = request.app.state.retriever
    previous_questions = interview_input.previous_questions or []
    
    question = generate_interview_question(
        llm=llm, 
        retriever=retriever, 
        emotion=interview_input.emotion,
        tech_stack=interview_input.tech_stack, 
        previous_questions=previous_questions
    )
    
    return InterviewResponse(question=question)
```

## Project Structure

nerv-ai-interview/
├── public/ # Static assets
├── src/
│ ├── components/ # Reusable UI components
│ ├── contexts/ # React contexts (Auth, etc.)
│ ├── pages/ # Main application pages
│ │ ├── Dashboard.tsx
│ │ ├── Interview.tsx
│ │ ├── Results.tsx
│ │ └── ...
│ ├── services/ # API and service integrations
│ ├── utils/ # Utility functions
│ ├── App.tsx # Main application component
│ └── main.tsx # Application entry point
├── .env # Environment variables
├── package.json # Dependencies and scripts
├── vercel.json # Vercel deployment configuration
└── README.md # Project documentation
```

## Usage

1. **Sign Up/Login**: Create an account or log in to access the system
2. **Upload Resume**: Upload your resume for personalized interview questions
3. **Start Interview**: Begin the AI-driven interview process
4. **Answer Questions**: Respond to questions verbally while the system analyzes your responses
5. **Review Results**: Get detailed feedback on your performance, including emotional analysis

## Technologies Used

- **Frontend**: React, TypeScript, TailwindCSS
- **AI Services**: 
  - Azure OpenAI (GPT-4o for question generation)
  - Azure Speech Services (Text-to-Speech)
  - Azure Embeddings (text-embedding-ada-002)
- **Vector Database**: FAISS (Facebook AI Similarity Search)
- **Authentication**: Firebase Authentication
- **Storage**: Firebase Storage
- **Deployment**: Vercel (frontend-only deployment)

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
- Firebase for authentication and storage solutions
- LangChain for RAG implementation framework