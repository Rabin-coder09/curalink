// frontend/src/App.js - COMPLETE FINAL VERSION
import React, { useState, useRef, useEffect } from "react";
import axios from "axios";
import jsPDF from "jspdf";
import "./App.css";

const API = "https://curalink-backend-xle1.onrender.com";

// ── Voice Input Hook ──
function useVoiceInput(onResult) {
  const [listening, setListening] = useState(false);
  const startListening = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Voice input not supported. Please use Chrome browser.");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.onstart = () => setListening(true);
    recognition.onresult = (e) => { onResult(e.results[0][0].transcript); setListening(false); };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognition.start();
  };
  return { listening, startListening };
}

// ── Typing Animation ──
function TypingText({ text }) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    setDisplayed("");
    setDone(false);
    let i = 0;
    const interval = setInterval(() => {
      if (i < text.length) { setDisplayed(text.slice(0, i + 1)); i++; }
      else { setDone(true); clearInterval(interval); }
    }, 8);
    return () => clearInterval(interval);
  }, [text]);
  return (
    <div className="ai-text">
      {displayed.split("\n").map((line, j) => <p key={j}>{line}</p>)}
      {!done && <span className="cursor">▋</span>}
    </div>
  );
}

// ── Paper Card ──
function PaperCard({ paper, saved, onSave }) {
  return (
    <div className="paper-card">
      <div className="card-top">
        <span className="card-source">{paper.source} · {paper.year}</span>
        <button className={`save-btn ${saved ? "saved" : ""}`} onClick={() => onSave(paper)} title={saved ? "Unsave" : "Save paper"}>
          {saved ? "★" : "☆"}
        </button>
      </div>
      <a href={paper.url} target="_blank" rel="noreferrer" className="card-title">{paper.title}</a>
      <div className="card-authors">{paper.authors}</div>
      <p className="card-abstract">{paper.abstract?.slice(0, 200)}…</p>
    </div>
  );
}

// ── Trial Card ──
function TrialCard({ trial }) {
  const [expanded, setExpanded] = useState(false);
  const fit = trial.fitScore;

  const scoreColor = fit?.gradeColor === "green" ? "#10b981"
    : fit?.gradeColor === "blue" ? "#3b82f6"
    : fit?.gradeColor === "orange" ? "#f59e0b"
    : "#ef4444";

  const scoreBg = fit?.gradeColor === "green" ? "#064e3b"
    : fit?.gradeColor === "blue" ? "#1e3a5f"
    : fit?.gradeColor === "orange" ? "#3b2a1a"
    : "#2d1515";

  return (
    <div className="trial-card">
      {/* Fit Score Badge */}
      {fit && (
        <div className="fit-score-bar">
          <div className="fit-score-left">
            <div className="fit-score-circle" style={{ background: scoreBg, borderColor: scoreColor, color: scoreColor }}>
              {fit.score}%
            </div>
            <div className="fit-score-info">
              <div className="fit-grade" style={{ color: scoreColor }}>{fit.grade}</div>
              <div className="fit-label">Patient Fit Score</div>
            </div>
          </div>
          <div className="fit-progress-wrap">
            <div className="fit-progress-bg">
              <div className="fit-progress-fill" style={{ width: `${fit.score}%`, background: scoreColor }}></div>
            </div>
          </div>
        </div>
      )}

      <div className="trial-header">
        <span className={`status-badge ${trial.status?.toLowerCase().replace(/ /g, "_")}`}>{trial.status}</span>
        <span className="trial-phase">{trial.phase}</span>
      </div>

      <a href={trial.url} target="_blank" rel="noreferrer" className="card-title">{trial.title}</a>
      <div className="trial-meta">📍 {trial.location} &nbsp;|&nbsp; 🗓 {trial.startDate}</div>
      <p className="card-abstract">{trial.description?.slice(0, 180)}…</p>

      {expanded && (
        <div className="trial-extra">
          {/* Why this score */}
          {fit && (
            <div className="fit-reasons">
              <div className="fit-reasons-title">Why this score?</div>
              {fit.reasons.map((r, i) => (
                <div key={i} className="fit-reason good">✓ {r}</div>
              ))}
              {fit.mismatches.map((r, i) => (
                <div key={i} className="fit-reason bad">✗ {r}</div>
              ))}
            </div>
          )}
          <div className="eligibility-box">
            <strong>Eligibility:</strong>
            <p>{trial.eligibility?.slice(0, 400)}</p>
          </div>
          <div className="contact-box"><strong>Contact:</strong> {trial.contact}</div>
        </div>
      )}

      <div className="trial-actions">
        <button className="expand-btn" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Show less ▲" : "Show fit details & eligibility ▼"}
        </button>
        <a href={trial.url} className="trial-link" target="_blank" rel="noreferrer">
          View on ClinicalTrials.gov →
        </a>
      </div>
    </div>
  );
}

// ── Main App ──
export default function App() {
  const [screen, setScreen] = useState("home");
  const [sessionId, setSessionId] = useState(null);
  const [disease, setDisease] = useState("");
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [patientName, setPatientName] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [otherConditions, setOtherConditions] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [darkMode, setDarkMode] = useState(true);
  const [activeTab, setActiveTab] = useState("chat");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [savedPapers, setSavedPapers] = useState(() => {
    try { return JSON.parse(localStorage.getItem("savedPapers") || "[]"); } catch { return []; }
  });
  const [sessions, setSessions] = useState(() => {
    try { return JSON.parse(localStorage.getItem("sessions") || "[]"); } catch { return []; }
  });
  const chatEndRef = useRef(null);

  useEffect(() => {
    document.body.className = darkMode ? "dark" : "light";
  }, [darkMode]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const { listening, startListening } = useVoiceInput((transcript) => setQuery(transcript));

  const toggleSave = (paper) => {
    setSavedPapers((prev) => {
      const exists = prev.find((p) => p.url === paper.url);
      const updated = exists ? prev.filter((p) => p.url !== paper.url) : [...prev, paper];
      localStorage.setItem("savedPapers", JSON.stringify(updated));
      return updated;
    });
  };

  const isPaperSaved = (paper) => savedPapers.some((p) => p.url === paper.url);

  const startSession = () => {
    if (!disease.trim()) { alert("Please enter a disease or condition."); return; }
    setMessages([]);
    setSessionId(null);
    setScreen("chat");
  };

  const loadSession = (sess) => {
    setDisease(sess.disease);
    setPatientName(sess.patientName || "");
    setMessages(sess.messages || []);
    setSessionId(sess.sessionId);
    setScreen("chat");
  };

  const goHome = () => {
    if (messages.length > 0 && disease) {
      const sessData = {
        id: sessionId || Date.now(),
        sessionId, disease, patientName, messages,
        date: new Date().toLocaleDateString(),
        preview: messages[0]?.text || disease,
      };
      setSessions((prev) => {
        const filtered = prev.filter((s) => s.id !== sessData.id);
        const updated = [sessData, ...filtered].slice(0, 20);
        localStorage.setItem("sessions", JSON.stringify(updated));
        return updated;
      });
    }
    setScreen("home");
    setDisease("");
    setQuery("");
    setMessages([]);
    setSessionId(null);
  };

  const sendQuery = async (overrideQuery) => {
    const q = overrideQuery || query;
    if (!q.trim() && !disease.trim()) return;
    const userText = q || `Tell me about ${disease}`;
    setMessages((prev) => [...prev, { type: "user", text: userText }]);
    setQuery("");
    setLoading(true);
    try {
      const res = await axios.post(`${API}/query`, { disease, query: userText, location, sessionId, patientName, age, gender, otherConditions });
      const data = res.data;
      setSessionId(data.sessionId);
      setMessages((prev) => [...prev, {
        type: "assistant",
        ai: data.ai,
        papers: data.papers,
        trials: data.trials,
        meta: data.meta,
        expandedQuery: data.query,
      }]);
    } catch (err) {
      setMessages((prev) => [...prev, { type: "error", text: "Error fetching results. Is the backend running on port 5000?" }]);
    }
    setLoading(false);
  };

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendQuery(); }
  };

  // ── PDF Export ──
  const exportPDF = () => {
    const doc = new jsPDF();
    let y = 20;
    doc.setFontSize(18);
    doc.setTextColor(30, 78, 216);
    doc.text("Curalink Medical Research Report", 20, y); y += 10;
    doc.setFontSize(11);
    doc.setTextColor(100, 116, 139);
    doc.text(`Disease: ${disease} | Date: ${new Date().toLocaleDateString()}`, 20, y); y += 15;
    messages.forEach((msg) => {
      if (y > 270) { doc.addPage(); y = 20; }
      if (msg.type === "user") {
        doc.setFontSize(11); doc.setTextColor(29, 78, 216);
        doc.text(`Q: ${msg.text}`, 20, y); y += 8;
      }
      if (msg.type === "assistant") {
        doc.setFontSize(10); doc.setTextColor(50, 50, 50);
        const aiLines = doc.splitTextToSize(msg.ai || "", 170);
        aiLines.forEach((line) => { if (y > 270) { doc.addPage(); y = 20; } doc.text(line, 20, y); y += 6; });
        y += 4;
        if (msg.papers?.length > 0) {
          doc.setFontSize(11); doc.setTextColor(30, 78, 216);
          doc.text("Research Publications:", 20, y); y += 7;
          msg.papers.forEach((p, i) => {
            if (y > 270) { doc.addPage(); y = 20; }
            doc.setFontSize(9); doc.setTextColor(50, 50, 50);
            const title = doc.splitTextToSize(`${i + 1}. ${p.title} (${p.year}) - ${p.source}`, 170);
            title.forEach(line => { doc.text(line, 20, y); y += 5; });
          });
          y += 4;
        }
        if (msg.trials?.length > 0) {
          doc.setFontSize(11); doc.setTextColor(139, 92, 246);
          doc.text("Clinical Trials:", 20, y); y += 7;
          msg.trials.forEach((t, i) => {
            if (y > 270) { doc.addPage(); y = 20; }
            doc.setFontSize(9); doc.setTextColor(50, 50, 50);
            doc.text(`${i + 1}. ${t.title} — ${t.status}`, 20, y); y += 5;
          });
        }
        y += 8;
      }
    });
    doc.save(`curalink-${disease}-${Date.now()}.pdf`);
  };

  // ── Text Export ──
  const exportText = () => {
    const text = messages.map((m) => {
      if (m.type === "user") return `USER: ${m.text}`;
      if (m.type === "assistant") return `AI:\n${m.ai}\n\nPapers: ${m.papers?.map((p) => p.title).join(", ")}`;
      return "";
    }).join("\n\n---\n\n");
    const blob = new Blob([text], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `curalink-${disease}-${Date.now()}.txt`;
    a.click();
  };

  // ══════════════════════════════════════════════
  // HOME SCREEN
  // ══════════════════════════════════════════════
  if (screen === "home") {
    return (
      <div className="app">
        <div className="home-layout">
          {/* Sidebar */}
          <div className="sidebar">
            <div className="sidebar-header">
              <div className="logo">🔬 Curalink</div>
              <div className="tagline">AI Medical Research</div>
            </div>
            <div className="sidebar-section">
              <div className="section-label">Recent Sessions</div>
              {sessions.length === 0 && <div className="no-sessions">No previous sessions yet</div>}
              {sessions.map((sess) => (
                <div key={sess.id} className="session-item" onClick={() => loadSession(sess)}>
                  <div className="session-disease">{sess.disease}</div>
                  <div className="session-meta">{sess.date} · {sess.messages?.length || 0} messages</div>
                </div>
              ))}
            </div>
            {savedPapers.length > 0 && (
              <div className="sidebar-section">
                <div className="section-label">Saved Papers ({savedPapers.length})</div>
                {savedPapers.slice(0, 5).map((p, i) => (
                  <a key={i} href={p.url} target="_blank" rel="noreferrer" className="saved-paper-item">
                    <div className="saved-title">{p.title?.slice(0, 50)}…</div>
                    <div className="saved-meta">{p.source} · {p.year}</div>
                  </a>
                ))}
              </div>
            )}
            <div className="sidebar-bottom">
              <button className="icon-btn full" onClick={() => setDarkMode(!darkMode)}>
                {darkMode ? "☀️ Light Mode" : "🌙 Dark Mode"}
              </button>
            </div>
          </div>

          {/* Home Main */}
          <div className="home-main">
            <div className="home-hero">
              <h1>Medical Research,<br /><span className="highlight">Powered by AI</span></h1>
              <p className="hero-sub">Structured, research-backed insights from PubMed, OpenAlex and ClinicalTrials.gov — powered by LLaMA 3</p>
            </div>
            <div className="home-form">
              <input className="input large" placeholder="Your name (optional)" value={patientName} onChange={(e) => setPatientName(e.target.value)} />
                <input className="input large" placeholder="Disease or condition *  e.g. Alzheimer's disease" value={disease} onChange={(e) => setDisease(e.target.value)} onKeyDown={(e) => e.key === "Enter" && startSession()} />
                <input className="input large" placeholder="Age (optional) — improves trial matching" value={age} onChange={(e) => setAge(e.target.value)} />
                <div className="gender-select">
                  <button className={`gender-btn ${gender === "Male" ? "active" : ""}`} onClick={() => setGender(gender === "Male" ? "" : "Male")}>Male</button>
                  <button className={`gender-btn ${gender === "Female" ? "active" : ""}`} onClick={() => setGender(gender === "Female" ? "" : "Female")}>Female</button>
                  <button className={`gender-btn ${gender === "Other" ? "active" : ""}`} onClick={() => setGender(gender === "Other" ? "" : "Other")}>Other</button>
              </div>
              <input className="input large" placeholder="Other conditions (optional) e.g. diabetes, hypertension" value={otherConditions} onChange={(e) => setOtherConditions(e.target.value)} />
              <input className="input large" placeholder="Location (optional) — for nearby clinical trials" value={location} onChange={(e) => setLocation(e.target.value)} />
              <button className="start-btn" onClick={startSession}>Start Research Session →</button>
            </div>
            <div className="quick-starts">
              <div className="qs-label">Quick start</div>
              <div className="qs-chips">
                {["Alzheimer's disease", "Lung cancer", "Type 2 diabetes", "Parkinson's disease", "Heart disease"].map((d) => (
                  <button key={d} className="qs-chip" onClick={() => setDisease(d)}>{d}</button>
                ))}
              </div>
            </div>
            <div className="home-stats">
              <div className="stat-box"><div className="stat-num">3</div><div className="stat-label">Data Sources</div></div>
              <div className="stat-box"><div className="stat-num">300+</div><div className="stat-label">Papers Retrieved</div></div>
              <div className="stat-box"><div className="stat-num">AI</div><div className="stat-label">LLaMA 3 Local</div></div>
              <div className="stat-box"><div className="stat-num">∞</div><div className="stat-label">Follow-up Questions</div></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════
  // CHAT SCREEN
  // ══════════════════════════════════════════════
  return (
    <div className="app">
      <div className="chat-layout">
        {/* Sidebar */}
        {sidebarOpen && (
          <div className="sidebar">
            <div className="sidebar-header">
              <div className="logo">🔬 Curalink</div>
            </div>
            <button className="back-btn" onClick={goHome}>← New Session</button>
            <div className="sidebar-tabs">
              <button className={`tab-btn ${activeTab === "chat" ? "active" : ""}`} onClick={() => setActiveTab("chat")}>History</button>
              <button className={`tab-btn ${activeTab === "saved" ? "active" : ""}`} onClick={() => setActiveTab("saved")}>Saved ({savedPapers.length})</button>
            </div>
            {activeTab === "chat" && (
              <div className="sidebar-section">
                {sessions.length === 0 && <div className="no-sessions">No previous sessions</div>}
                {sessions.map((sess) => (
                  <div key={sess.id} className="session-item" onClick={() => loadSession(sess)}>
                    <div className="session-disease">{sess.disease}</div>
                    <div className="session-meta">{sess.date}</div>
                  </div>
                ))}
              </div>
            )}
            {activeTab === "saved" && (
              <div className="sidebar-section">
                {savedPapers.length === 0 && <div className="no-sessions">No saved papers yet. Click ☆ on any paper.</div>}
                {savedPapers.map((p, i) => (
                  <a key={i} href={p.url} target="_blank" rel="noreferrer" className="saved-paper-item">
                    <div className="saved-title">{p.title?.slice(0, 60)}…</div>
                    <div className="saved-meta">{p.source} · {p.year}</div>
                  </a>
                ))}
              </div>
            )}
            <div className="sidebar-bottom">
              <button className="icon-btn full" onClick={() => setDarkMode(!darkMode)}>
                {darkMode ? "☀️ Light Mode" : "🌙 Dark Mode"}
              </button>
            </div>
          </div>
        )}

        {/* Chat Main */}
        <div className="chat-main">
          {/* Top Bar */}
          <div className="chat-topbar">
            <button className="icon-btn" onClick={() => setSidebarOpen(!sidebarOpen)}>☰</button>
            <div className="chat-title">
              <span className="disease-tag">{disease}</span>
              {patientName && <span className="patient-tag">· {patientName}</span>}
            </div>
            <div className="topbar-actions">
              <button className="icon-btn" onClick={exportPDF} title="Export as PDF">📄 PDF</button>
              <button className="icon-btn" onClick={exportText} title="Export as text">↓ TXT</button>
              <button className="icon-btn" onClick={() => setDarkMode(!darkMode)}>{darkMode ? "☀️" : "🌙"}</button>
              <button className="icon-btn" onClick={goHome}>🏠 Home</button>
            </div>
          </div>

          {/* Messages */}
          <div className="chat-window">
            {messages.length === 0 && (
              <div className="empty-state">
                <div className="empty-icon">🔬</div>
                <h2>Research session started</h2>
                <p>Disease: <strong>{disease}</strong></p>
                <p style={{ marginTop: 8 }}>Ask anything or pick a suggestion:</p>
                <div className="suggestions">
                  {["Latest treatments", "Active clinical trials", "Key researchers", "Prevention strategies", "Side effects"].map((s) => (
                    <button key={s} className="suggestion-chip" onClick={() => sendQuery(s)}>{s}</button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`message ${msg.type}`}>
                {msg.type === "user" && <div className="user-bubble">{msg.text}</div>}
                {msg.type === "assistant" && (
                  <div className="assistant-response">
                    <div className="query-badge">
                      🔍 <em>{msg.expandedQuery}</em>
                      &nbsp;·&nbsp; {msg.meta?.totalPubsRetrieved} papers scanned
                      &nbsp;·&nbsp; top {msg.meta?.papersShown} shown
                      &nbsp;·&nbsp; {msg.meta?.totalTrialsRetrieved} trials found
                    </div>
                    <div className="ai-summary">
                      <div className="ai-header">
                        <span>🤖 AI Analysis</span>
                        <span className="ai-badge">LLaMA 3 · Local</span>
                      </div>
                      <TypingText text={msg.ai} />
                    </div>
                    {msg.papers?.length > 0 && (
                      <div className="section">
                        <div className="section-header">
                          <h3>📚 Research Publications ({msg.papers.length})</h3>
                          <span className="section-sources">PubMed + OpenAlex</span>
                        </div>
                        <div className="cards-grid">
                          {msg.papers.map((p, j) => (
                            <PaperCard key={j} paper={p} saved={isPaperSaved(p)} onSave={toggleSave} />
                          ))}
                        </div>
                      </div>
                    )}
                    {msg.trials?.length > 0 && (
                      <div className="section">
                        <div className="section-header">
                          <h3>🧪 Clinical Trials ({msg.trials.length})</h3>
                          <span className="section-sources">ClinicalTrials.gov</span>
                        </div>
                        <div className="cards-grid">
                          {msg.trials.map((t, j) => <TrialCard key={j} trial={t} />)}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {msg.type === "error" && <div className="error-bubble">⚠️ {msg.text}</div>}
              </div>
            ))}

            {loading && (
              <div className="loading">
                <div className="loading-dots"><span></span><span></span><span></span></div>
                <span>Searching PubMed, OpenAlex, ClinicalTrials.gov…</span>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input Bar */}
          <div className="input-bar">
            <div className="input-wrap">
              <input
                className="chat-input"
                placeholder={`Ask anything about ${disease}…`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKey}
              />
              <button className={`voice-btn ${listening ? "listening" : ""}`} onClick={startListening} title="Voice input">
                {listening ? "🔴" : "🎤"}
              </button>
              <button className="send-btn" onClick={() => sendQuery()} disabled={loading}>
                {loading ? "…" : "→"}
              </button>
            </div>
            <div className="input-chips">
              {["Clinical trials", "Latest research", "Side effects", "Prevention", "Top researchers"].map((s) => (
                <button key={s} className="input-chip" onClick={() => sendQuery(s)}>{s}</button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}