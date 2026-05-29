# AI Backend API

The backend is a lightweight Express server that acts as a bridge between the mobile app and Ollama.

## Base URL
Default: `http://localhost:3000`

## Endpoints

### 1. Health Check
`GET /health`

**Response:**
```json
{ "status": "ok" }
```

### 2. Ollama Health Check
`GET /health/ollama`

Checks if the Ollama service is reachable and the required model is loaded.

---

### 3. Summarize Conversation
`POST /ai/summarize`

Generates a concise summary of a list of messages.

**Request Body:**
```json
{
  "messages": [
    { "role": "user", "content": "Hello!" },
    { "role": "assistant", "content": "Hi there, how can I help?" }
  ]
}
```

**Response:**
```json
{
  "summary": "User and assistant greeted each other."
}
```

---

### 4. Suggest Reply
`POST /ai/suggest-reply`

Generates 3 smart reply suggestions based on the conversation history.

**Request Body:**
```json
{
  "messages": [...]
}
```

**Response:**
```json
{
  "suggestions": [
    "Sounds good!",
    "Can you tell me more?",
    "I'll get back to you soon."
  ]
}
```

## Implementation Details

- **Model:** llama3.2 (configurable)
- **Framework:** Express.js
- **Runtime:** tsx (TypeScript Execute)
