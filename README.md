# Orato - AI-Powered Interview Platform

## Environment Setup

This project uses environment variables to store sensitive information like API keys.

1. Create a `.env` file in the root directory
2. Add the following variables to your `.env` file:
   ```
   VITE_OPENAI_API_KEY=your_openai_api_key_here
   ```
3. Replace `your_openai_api_key_here` with your actual OpenAI API key

Note: Never commit your `.env` file to version control. The `.env.example` file is provided as a template. 