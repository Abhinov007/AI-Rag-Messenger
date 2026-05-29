# 🚀 AIRagMessenger

[![Expo](https://img.shields.io/badge/Expo-54.0-blue?logo=expo&logoColor=white)](https://expo.dev/)
[![React Native](https://img.shields.io/badge/React_Native-0.81-61DAFB?logo=react&logoColor=white)](https://reactnative.dev/)
[![Supabase](https://img.shields.io/badge/Supabase-2.0-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com/)
[![Clerk](https://img.shields.io/badge/Clerk-Auth-6C47FF?logo=clerk&logoColor=white)](https://clerk.com/)
[![Ollama](https://img.shields.io/badge/Ollama-AI-orange?logo=ollama&logoColor=white)](https://ollama.com/)

**AIRagMessenger** is a modern, offline-first mobile chat application powered by AI. It combines the speed of local SQLite storage with the reliability of Supabase cloud synchronization, featuring intelligent summaries and reply suggestions powered by local LLMs.

---

## ✨ Key Features

- **📱 Offline-First:** Send messages instantly without waiting for the network. SQLite acts as your primary source of truth.
- **🔄 Smart Sync:** Background synchronization with Supabase ensures your chats are backed up and available across devices.
- **🤖 AI-Powered:** Get conversation summaries and smart reply suggestions using local LLMs (Ollama + Llama 3.2).
- **🔒 Secure Auth:** Seamless authentication powered by Clerk Expo.
- **⚡ Real-time:** Instant message delivery using Supabase Realtime subscriptions.
- **🎨 Modern UI:** Beautiful, responsive design built with NativeWind (Tailwind CSS).

---

## 🏗️ Architecture

The app follows a robust offline-first architecture:

1.  **UI** reads/writes to **SQLite** (Zero latency).
2.  **Sync Bootstrapper** runs background tasks to push/pull data.
3.  **Supabase** handles remote persistence and RLS security.
4.  **Ollama** provides local AI inference for privacy and speed.

> [!TIP]
> Check out the [Architecture Documentation](docs/architecture.md) for a deep dive into the system design.

---

## 🚀 Quick Start

### 1. Prerequisites
- [Ollama](https://ollama.com/) installed and running (`ollama pull llama3.2`)
- [Expo Go](https://expo.dev/go) app on your mobile device.

### 2. Installation
```bash
# Clone the repository
git clone https://github.com/your-username/AI-Rag-Messenger.git

# Install mobile dependencies
npm install

# Install backend dependencies
cd backend && npm install
```

### 3. Environment Setup
Copy `.env.example` to `.env` in both the root and `backend` folders and fill in your keys.

### 4. Running the Project
```bash
# Start the AI Backend
cd backend && npm run dev

# Start the Expo Mobile App (in a new terminal)
npm start
```

---

## 📚 Documentation

Detailed guides for various aspects of the project:

- 🛠️ **[Setup Guide](docs/setup.md)** - Detailed instructions for Clerk, Supabase, and AI.
- 🏗️ **[Architecture](docs/architecture.md)** - How the offline-first sync model works.
- 🗄️ **[Database Schema](docs/database.md)** - SQLite and Supabase table structures.
- 🔌 **[API Reference](docs/api.md)** - Documentation for the AI backend endpoints.

---

## 🛠️ Tech Stack

- **Frontend:** Expo, React Native, TypeScript, React Navigation.
- **State Management:** Zustand.
- **Styling:** NativeWind (Tailwind CSS).
- **Database:** Expo SQLite (Local), Supabase (Remote).
- **Auth:** Clerk Expo.
- **AI Backend:** Node.js (Express), Ollama, Llama 3.2.

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

<p align="center">Made with ❤️ for the AI/Mobile Community</p>
