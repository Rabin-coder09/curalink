# 🔬 Curalink — AI Medical Research Assistant

> Real research. Real trials. Real answers.

[![Live Demo](https://img.shields.io/badge/Live-Demo-blue)](https://your-vercel-url.vercel.app)
[![Backend](https://img.shields.io/badge/Backend-Render-green)](https://curalink-backend-xle1.onrender.com)

## 🌐 Live App
👉 **[Open Curalink](https://curalink-swart.vercel.app/)**

## 🎯 What is Curalink?
Curalink is a full-stack AI-powered medical research assistant that:
- Fetches real research from **PubMed**, **OpenAlex**, and **ClinicalTrials.gov**
- Uses **LLaMA 3.3-70B via Groq** for structured AI responses
- Calculates **Patient Fit Score** for every clinical trial
- Remembers conversation context across sessions
- Supports voice input, PDF export, dark/light mode

## ✨ Key Features

| Feature | Description |
|---|---|
| 🔍 Smart Query Expansion | Disease + intent merged automatically |
| 📚 3-Source Retrieval | PubMed + OpenAlex + ClinicalTrials.gov |
| 🎯 Patient Fit Score | Age + Gender + Location + Phase matching |
| 🧠 LLaMA 3.3 AI | Structured, cited, non-hallucinated responses |
| 💬 Context Memory | Multi-turn conversation with MongoDB |
| 📄 PDF Export | Download full research report |
| 🎤 Voice Input | Speak your query |
| 🌙 Dark/Light Mode | Professional UI |

## 🏗 Architecture
## 🛠 Tech Stack

**Frontend:** React.js, Vercel, jsPDF, Voice API

**Backend:** Node.js, Express.js, Render, Groq SDK

**Database:** MongoDB Atlas, Mongoose

**AI + APIs:** LLaMA 3.3-70B (Groq), PubMed NCBI, OpenAlex, ClinicalTrials.gov v2

## 🚀 Run Locally

### Backend
```bash
cd backend
npm install
# Create .env file with GROQ_API_KEY and MONGO_URI
node server.js
```

### Frontend
```bash
cd frontend
npm install
npm start
```

## 🎯 Patient Fit Score
Each clinical trial is scored 0-100% based on:
- **Disease Match** — 40 points
- **Recruiting Status** — 20 points  
- **Location Match** — 15 points
- **Age Match** — 15 points
- **Gender Match** — 10 points

## 📊 Demo Queries
- "Latest treatments for Alzheimer's disease"
- "Active clinical trials for diabetes"
- "Can I take Vitamin D?" (follow-up — context memory!)
- "Top researchers in Parkinson's disease"

## 🏆 Built For
Curalink Hackathon 2026 — AI Medical Research Assistant Challenge

---
*Built with dedication · Powered by AI · Designed to save lives*
