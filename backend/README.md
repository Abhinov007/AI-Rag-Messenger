# AIRagMessenger Backend

Local AI backend for summary and reply suggestions.

## Endpoints

- `GET /health`
- `GET /health/ollama`
- `POST /ai/summarize`
- `POST /ai/suggest-reply`

## Setup

1. Copy `.env.example` to `.env`
2. Install dependencies:

```powershell
npm install
```

3. Start Ollama and make sure `llama3.2` is available:

```powershell
ollama serve
ollama pull llama3.2
```

4. Start the backend:

```powershell
npm run dev
```
