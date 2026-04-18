const fs = require("fs");
const path = require("path");
const envFile = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
envFile.split("\n").forEach(line => {
  const [key, ...vals] = line.trim().split("=");
  if (key && vals.length) process.env[key.trim()] = vals.join("=").trim();
});
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const xml2js = require("xml2js");
const mongoose = require("mongoose");
const Groq = require("groq-sdk");

const app = express();
app.use(cors());
app.use(express.json());

// ─── Groq Client ──────────────────────────────────────────────────────────────
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ─── MongoDB ──────────────────────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/curalink")
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.log("MongoDB error:", err));

// ─── Session Schema ───────────────────────────────────────────────────────────
const sessionSchema = new mongoose.Schema({
  sessionId: String,
  messages: [{ role: String, content: String, timestamp: Date }],
  userContext: { disease: String, location: String, name: String },
  createdAt: { type: Date, default: Date.now },
});
const Session = mongoose.model("Session", sessionSchema);

// ─── Root ─────────────────────────────────────────────────────────────────────
app.get("/", (req, res) => res.send("Curalink Backend ✅"));

// ─── Query Expansion ──────────────────────────────────────────────────────────
function expandQuery(disease, query) {
  if (!query) return disease;
  if (query.toLowerCase().includes(disease.toLowerCase())) return query;
  return `${disease} ${query}`;
}

// ─── Scoring ──────────────────────────────────────────────────────────────────
function scorePublication(pub, disease, query) {
  let score = 0;
  const text = `${pub.title} ${pub.abstract}`.toLowerCase();
  const terms = `${disease} ${query}`.toLowerCase().split(" ");
  terms.forEach((t) => { if (t.length > 3 && text.includes(t)) score += 2; });
  terms.forEach((t) => { if (t.length > 3 && pub.title?.toLowerCase().includes(t)) score += 3; });
  const year = parseInt(pub.year) || 2000;
  score += Math.max(0, (year - 2015) * 0.5);
  return score;
}

// ─── PubMed ───────────────────────────────────────────────────────────────────
async function fetchPubMed(expandedQuery) {
  try {
    const searchRes = await axios.get(
      "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",
      { params: { db: "pubmed", term: expandedQuery, retmode: "json", retmax: 30, sort: "pub date" } }
    );
    const ids = searchRes.data.esearchresult.idlist;
    if (!ids || ids.length === 0) return [];

    await new Promise((r) => setTimeout(r, 300));

    const fetchRes = await axios.get(
      "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi",
      { params: { db: "pubmed", id: ids.slice(0, 20).join(","), retmode: "xml" } }
    );

    const parsed = await xml2js.parseStringPromise(fetchRes.data);
    const articles = parsed?.PubmedArticleSet?.PubmedArticle || [];

    return articles.map((a) => {
      const article = a.MedlineCitation?.[0]?.Article?.[0];
      const authors = article?.AuthorList?.[0]?.Author || [];
      const authorNames = authors.slice(0, 3)
        .map((au) => `${au.LastName?.[0] || ""} ${au.ForeName?.[0]?.[0] || ""}`.trim())
        .filter(Boolean);
      const pmid = a.MedlineCitation?.[0]?.PMID?.[0]?._ || a.MedlineCitation?.[0]?.PMID?.[0];
      return {
        title: article?.ArticleTitle?.[0] || "Untitled",
        abstract: article?.Abstract?.[0]?.AbstractText?.[0]?._ || article?.Abstract?.[0]?.AbstractText?.[0] || "No abstract available",
        authors: authorNames.join(", ") || "Unknown authors",
        year: article?.Journal?.[0]?.JournalIssue?.[0]?.PubDate?.[0]?.Year?.[0] || "N/A",
        source: "PubMed",
        url: pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : "#",
      };
    });
  } catch (err) {
    console.error("PubMed error:", err.message);
    return [];
  }
}

// ─── OpenAlex ─────────────────────────────────────────────────────────────────
async function fetchOpenAlex(expandedQuery) {
  try {
    const res = await axios.get("https://api.openalex.org/works", {
      params: {
        search: expandedQuery,
        "per-page": 25,
        page: 1,
        sort: "relevance_score:desc",
        filter: "from_publication_date:2018-01-01",
      },
    });

    return (res.data.results || []).map((p) => {
      let abstract = "No abstract available";
      if (p.abstract_inverted_index) {
        const wordPositions = [];
        for (const [word, positions] of Object.entries(p.abstract_inverted_index)) {
          positions.forEach((pos) => (wordPositions[pos] = word));
        }
        abstract = wordPositions.filter(Boolean).join(" ").slice(0, 400);
      }
      const authors = (p.authorships || []).slice(0, 3)
        .map((a) => a.author?.display_name || "").filter(Boolean);
      return {
        title: p.title || "Untitled",
        abstract,
        authors: authors.join(", ") || "Unknown authors",
        year: p.publication_year || "N/A",
        source: "OpenAlex",
        url: p.doi ? `https://doi.org/${p.doi}` : p.id || "#",
      };
    });
  } catch (err) {
    console.error("OpenAlex error:", err.message);
    return [];
  }
}
// ─── Patient Fit Score ────────────────────────────────────────────────────────
function calculateFitScore(trial, disease, query, location, patientProfile) {
  let score = 0;
  let reasons = [];
  let mismatches = [];

  const { age, gender, otherConditions } = patientProfile || {};
  const trialText = `${trial.title} ${trial.description} ${trial.eligibility}`.toLowerCase();

  // 1. Disease Match (40 points)
  const diseaseTerms = disease.toLowerCase().split(" ");
  const matchedTerms = diseaseTerms.filter(t => t.length > 3 && trialText.includes(t));
  if (matchedTerms.length > 0) {
    const diseaseScore = Math.min(40, Math.round((matchedTerms.length / diseaseTerms.length) * 40));
    score += diseaseScore;
    reasons.push(`Matches disease: ${disease}`);
  } else {
    mismatches.push("Disease may not match trial condition");
  }

  // 2. Recruiting Status (20 points)
  if (trial.status?.toUpperCase() === "RECRUITING") {
    score += 20;
    reasons.push("Actively recruiting patients");
  } else if (trial.status?.toUpperCase() === "NOT_YET_RECRUITING") {
    score += 10;
    reasons.push("Opening for recruitment soon");
  } else {
    mismatches.push(`Trial is ${trial.status} — not recruiting`);
  }

  // 3. Location Match (15 points)
  if (location && trial.location) {
    const locWords = location.toLowerCase().split(/[\s,]+/).filter(w => w.length > 3);
    const locMatched = locWords.some(w => trial.location.toLowerCase().includes(w));
    if (locMatched) {
      score += 15;
      reasons.push(`Location matches: ${trial.location}`);
    } else {
      score += 5;
      mismatches.push(`Trial location: ${trial.location}`);
    }
  } else {
    score += 8;
    reasons.push("Location not specified — trial may be remote");
  }

  // 4. Age Match (15 points) — NEW
  if (age && trial.eligibility) {
    const elig = trial.eligibility.toLowerCase();
    const ageNum = parseInt(age);

    // Extract age ranges from eligibility text
    const minAgeMatch = elig.match(/minimum age[:\s]+(\d+)|age[:\s]+(\d+)\s*(?:years|yr)/i);
    const maxAgeMatch = elig.match(/maximum age[:\s]+(\d+)|up to[:\s]+(\d+)\s*(?:years|yr)/i);
    const rangeMatch = elig.match(/(\d+)\s*(?:to|-)\s*(\d+)\s*years/i);

    if (rangeMatch) {
      const minAge = parseInt(rangeMatch[1]);
      const maxAge = parseInt(rangeMatch[2]);
      if (ageNum >= minAge && ageNum <= maxAge) {
        score += 15;
        reasons.push(`Age ${age} fits trial range (${minAge}-${maxAge} years)`);
      } else {
        mismatches.push(`Age ${age} outside trial range (${minAge}-${maxAge} years)`);
      }
    } else if (minAgeMatch) {
      const minAge = parseInt(minAgeMatch[1] || minAgeMatch[2]);
      if (ageNum >= minAge) {
        score += 10;
        reasons.push(`Age ${age} meets minimum age requirement (${minAge}+)`);
      } else {
        mismatches.push(`Age ${age} below minimum age (${minAge})`);
      }
    } else {
      score += 8;
      reasons.push("No specific age restriction found");
    }
  } else if (age) {
    score += 8;
    reasons.push("Age noted — verify eligibility directly");
  }

  // 5. Gender Match (10 points) — NEW
  if (gender && trial.eligibility) {
    const elig = trial.eligibility.toLowerCase();
    const genderLower = gender.toLowerCase();

    if (elig.includes("all genders") || elig.includes("male and female") ||
        elig.includes("both") || (!elig.includes("male only") && !elig.includes("female only") &&
        !elig.includes("men only") && !elig.includes("women only"))) {
      score += 10;
      reasons.push("Trial accepts all genders");
    } else if (
      (genderLower === "male" && (elig.includes("male only") || elig.includes("men only"))) ||
      (genderLower === "female" && (elig.includes("female only") || elig.includes("women only")))
    ) {
      score += 10;
      reasons.push(`Gender matches trial requirement (${gender})`);
    } else if (
      (genderLower === "male" && (elig.includes("female only") || elig.includes("women only"))) ||
      (genderLower === "female" && (elig.includes("male only") || elig.includes("men only")))
    ) {
      mismatches.push(`Trial may be restricted to other gender`);
    } else {
      score += 7;
      reasons.push("Gender eligibility not specified");
    }
  } else {
    score += 5;
  }

  // 6. Other Conditions Check (5 points) — NEW
  if (otherConditions && trial.eligibility) {
    const elig = trial.eligibility.toLowerCase();
    const conditions = otherConditions.toLowerCase().split(/[,;]+/).map(c => c.trim());
    const hasExclusion = conditions.some(c =>
      c.length > 3 && elig.includes(c) && elig.includes("exclud")
    );
    if (hasExclusion) {
      mismatches.push("Other conditions may affect eligibility");
    } else {
      score += 5;
      reasons.push("No obvious exclusions from other conditions");
    }
  } else {
    score += 3;
  }

  // 7. Phase Score (10 points)
  const phase = trial.phase?.toUpperCase() || "";
  if (phase.includes("3") || phase.includes("4")) {
    score += 10;
    reasons.push("Phase 3/4 — advanced clinical validation");
  } else if (phase.includes("2")) {
    score += 7;
    reasons.push("Phase 2 — promising results");
  } else if (phase.includes("1")) {
    score += 3;
    reasons.push("Phase 1 — early safety trial");
  } else {
    score += 5;
  }

  // 8. Contact Available (5 points)
  if (trial.contact && trial.contact !== "Contact via ClinicalTrials.gov") {
    score += 5;
    reasons.push("Direct contact information available");
  }

  // Cap at 100
  score = Math.min(100, Math.round(score));

  // Grade
  let grade, gradeColor;
  if (score >= 80) { grade = "Excellent Match"; gradeColor = "green"; }
  else if (score >= 60) { grade = "Good Match"; gradeColor = "blue"; }
  else if (score >= 40) { grade = "Possible Match"; gradeColor = "orange"; }
  else { grade = "Low Match"; gradeColor = "red"; }

  return { score, grade, gradeColor, reasons, mismatches };
}

// ─── Clinical Trials ──────────────────────────────────────────────────────────
async function fetchClinicalTrials(disease, query, location = "", patientProfile = {}) {
  try {
    const params = {
      "query.cond": `${disease} ${query}`.trim(),
      pageSize: 20,
      format: "json",
    };
    if (location) params["query.locn"] = location;

    const res = await axios.get("https://clinicaltrials.gov/api/v2/studies", { params });
    const studies = res.data.studies || [];

    return studies.map((study) => {
      const proto = study.protocolSection;
      const id = proto?.identificationModule;
      const status = proto?.statusModule;
      const desc = proto?.descriptionModule;
      const eligibility = proto?.eligibilityModule;
      const contacts = proto?.contactsLocationsModule;
      const firstLocation = contacts?.locations?.[0];
      const locationStr = firstLocation
        ? `${firstLocation.city || ""}, ${firstLocation.country || ""}`.trim().replace(/^,/, "")
        : "Multiple locations";

      const trial = {
        title: id?.briefTitle || "Untitled Trial",
        nctId: id?.nctId || "",
        status: status?.overallStatus || "Unknown",
        phase: proto?.designModule?.phases?.[0] || "N/A",
        description: desc?.briefSummary?.slice(0, 300) || "No description",
        eligibility: eligibility?.eligibilityCriteria?.slice(0, 400) || "See full listing",
        location: locationStr,
        contact: contacts?.centralContacts?.[0]?.name || contacts?.centralContacts?.[0]?.email || "Contact via ClinicalTrials.gov",
        url: id?.nctId ? `https://clinicaltrials.gov/study/${id.nctId}` : "#",
        startDate: status?.startDateStruct?.date || "N/A",
      };

      trial.fitScore = calculateFitScore(trial, disease, query, location, patientProfile);

      return trial;
    });
  } catch (err) {
    console.error("ClinicalTrials error:", err.message);
    return [];
  }
}
// ─── Main Query ───────────────────────────────────────────────────────────────
app.post("/query", async (req, res) => {
  const { disease, query, location = "", sessionId, patientName = "", age = "", gender = "", otherConditions = "" } = req.body;
  if (!disease) return res.status(400).json({ error: "Disease is required" });

  // Load or create session
  let session = sessionId ? await Session.findOne({ sessionId }) : null;
  if (!session) {
    session = new Session({
      sessionId: `sess_${Date.now()}`,
      messages: [],
      userContext: { disease, location, name: patientName },
    });
  }

  const effectiveDisease = disease || session.userContext.disease;
  const expandedQuery = expandQuery(effectiveDisease, query);

  // Parallel fetch from all 3 sources
  const [pubmedRaw, openalexRaw, trialsRaw] = await Promise.all([
    fetchPubMed(expandedQuery),
    fetchOpenAlex(expandedQuery),
    fetchClinicalTrials(effectiveDisease, query, location, { age, gender, otherConditions }),
  ]);

  // Merge + deduplicate
  const allPubs = [...pubmedRaw, ...openalexRaw];
  const seen = new Set();
  const uniquePubs = allPubs.filter((p) => {
    if (!p || !p.title || typeof p.title !== "string") return false;
    const key = p.title.toLowerCase().slice(0, 40);
    if (!key) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Score and rank
  const scoredPubs = uniquePubs
    .map((p) => ({ ...p, _score: scorePublication(p, effectiveDisease, query) }))
    .sort((a, b) => b._score - a._score);

  const topPapers = scoredPubs.slice(0, 8);
  const topTrials = trialsRaw.slice(0, 6);

  // Build prompt
  const recentHistory = session.messages.slice(-4)
    .map((m) => `${m.role}: ${m.content}`).join("\n");

  const pubSummaries = topPapers.slice(0, 4)
    .map((p, i) => `[${i + 1}] "${p.title}" (${p.year}): ${p.abstract?.slice(0, 100)}`)
    .join("\n");

  const trialSummaries = topTrials.slice(0, 2)
    .map((t, i) => `[T${i + 1}] "${t.title}" — ${t.status}`)
    .join("\n");

  // ── Groq AI (ultra fast) ──────────────────────────────────────────────────
  let aiSummary = "";
  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: `You are Curalink, an expert AI medical research assistant. Give structured, accurate, research-backed answers. Never hallucinate. Only cite studies provided. Disease context: ${effectiveDisease}.${patientName ? ` Patient: ${patientName}.` : ""}`,
        },
        {
          role: "user",
          content: `${recentHistory ? `Previous conversation:\n${recentHistory}\n\n` : ""}Question: "${query || `Tell me about ${effectiveDisease}`}"

Papers:
${pubSummaries}

Trials:
${trialSummaries}

Reply in this structure (be concise):
## Overview
[2 sentences about ${effectiveDisease}]

## Key Findings
[3 bullet points citing papers by number]

## Recommendation
[1 personalized sentence]`,
        },
      ],
      temperature: 0.3,
      max_tokens: 400,
    });
    aiSummary = completion.choices[0]?.message?.content || "No response generated";
  } catch (err) {
    console.error("Groq error:", err.message);
    aiSummary = "AI reasoning unavailable. Check your GROQ_API_KEY in .env file.";
  }

  // Save session
  session.messages.push({ role: "user", content: query || disease, timestamp: new Date() });
  session.messages.push({ role: "assistant", content: aiSummary.slice(0, 500), timestamp: new Date() });
  session.userContext = { disease: effectiveDisease, location, name: patientName };
  await session.save();

  res.json({
    sessionId: session.sessionId,
    query: expandedQuery,
    papers: topPapers,
    trials: topTrials,
    ai: aiSummary,
    meta: {
      totalPubsRetrieved: allPubs.length,
      totalTrialsRetrieved: trialsRaw.length,
      papersShown: topPapers.length,
      trialsShown: topTrials.length,
    },
  });
});

// ─── Get Session ──────────────────────────────────────────────────────────────
app.get("/session/:sessionId", async (req, res) => {
  const session = await Session.findOne({ sessionId: req.params.sessionId });
  if (!session) return res.status(404).json({ error: "Session not found" });
  res.json(session);
});

app.listen(process.env.PORT || 5000, () =>
  console.log(`Server running on http://localhost:${process.env.PORT || 5000}`)
);