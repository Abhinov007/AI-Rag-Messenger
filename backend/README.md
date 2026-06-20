# AIRagMessenger Backend

Local AI backend for summary and reply suggestions. This service is optional and not called by the main mobile application.

## Endpoints

- `GET /health` - Checks whether the Express service is running.
- `GET /health/ollama` - Checks whether Ollama is reachable.
- `POST /ai/summarize` - Generates a summary for a given conversation.
- `POST /ai/suggest-reply` - Generates three reply suggestions.

## Setup

1. Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

2. Install dependencies:

```bash
npm install
```

3. Start Ollama and pull the expected model:

```bash
ollama serve
ollama pull llama3.2
```

4. Run development server:

```bash
npm run dev
```

## Available Scripts

- `npm run dev`: Runs the service in watch mode using `tsx`.
- `npm run build`: Compiles the TypeScript files into `dist/`.
- `npm run start`: Starts the compiled production build from `dist/index.js`.
- `npm run check`: Typechecks the TypeScript codebase.
