/* global React, ReactDOM, window, MOCK_SESSION, INITIAL_CHAT, SCRIPTED, SUGGESTIONS */
const { useState, useEffect, useRef } = React;
const { Icon, Tag, Btn } = window;

const API_BASE = window.REPRO_API_BASE || "";
const STORAGE_KEY = "repro_sessions";

// ── localStorage helpers ─────────────────────────────────────────────────────
function loadSessions() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
}
function saveSession(session) {
  const sessions = loadSessions().filter(s => s.id !== session.id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify([session, ...sessions].slice(0, 20)));
}
function deleteSession(id) {
  const sessions = loadSessions().filter(s => s.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

// ── API helpers ──────────────────────────────────────────────────────────────
async function apiAnalyze(source, value) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const r = await fetch(`${API_BASE}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, value }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!r.ok) throw new Error(`Analysis failed: ${r.statusText}`);
    return r.json();
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

async function apiChat(message, context) {
  const r = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, context }),
  });
  if (!r.ok) throw new Error(`Chat failed: ${r.statusText}`);
  return r.json();
}

async function apiUploadPdf(file) {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch(`${API_BASE}/api/upload-pdf`, { method: "POST", body: fd });
  if (!r.ok) throw new Error(`Upload failed: ${r.statusText}`);
  return r.json();
}

// ── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard({ onNew, onOpen }) {
  const [sessions, setSessions] = useState(loadSessions);

  const remove = (id, e) => {
    e.stopPropagation();
    deleteSession(id);
    setSessions(loadSessions());
  };

  const fmt = iso => {
    const d = new Date(iso);
    const diff = (Date.now() - d) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return d.toLocaleDateString();
  };

  return (
    <div className="dash">
      <div className="dash-top">
        <div className="brand">
          <span className="brand-mark"><Icon name="replay" size={16} sw={2.2} /></span>
          Reproduce
        </div>
        <Btn variant="pri" icon="plus" onClick={onNew}>New reproduction</Btn>
      </div>

      {sessions.length === 0 ? (
        <div className="dash-empty">
          <div className="dash-empty-ic"><Icon name="replay" size={32} sw={1.5} /></div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>No reproductions yet</div>
          <div style={{ fontSize: 13.5, color: "var(--muted)", marginBottom: 20 }}>
            Paste a GitHub URL, arXiv ID, or drop a paper PDF to generate your reproduction files.
          </div>
          <Btn variant="pri" icon="plus" onClick={onNew}>Start your first reproduction</Btn>
        </div>
      ) : (
        <div className="dash-grid">
          {sessions.map(s => {
            const high = (s.risks || []).filter(r => r.sev === "high").length;
            const med = (s.risks || []).filter(r => r.sev === "medium").length;
            return (
              <div key={s.id} className="sess-card" onClick={() => onOpen(s)}>
                <div className="sess-card-top">
                  <div className="sess-repo">
                    <Icon name="github" size={13} sw={1.8} style={{ color: "var(--muted)", flexShrink: 0 }} />
                    <span className="mono">{s.repo}</span>
                  </div>
                  <button className="sess-del" onClick={e => remove(s.id, e)} title="Delete">
                    <Icon name="x" size={14} sw={2} />
                  </button>
                </div>
                <div className="sess-title">{s.title || s.repo}</div>
                <div className="sess-meta">
                  {s.venue && <Tag kind="neutral">{s.venue}</Tag>}
                  {high > 0 && <Tag kind="risk" icon="alert">{high} high</Tag>}
                  {med > 0 && <Tag kind="warn">{med} medium</Tag>}
                  {high === 0 && med === 0 && <Tag kind="ok" icon="check">clean</Tag>}
                </div>
                <div className="sess-footer">
                  <span style={{ fontSize: 11.5, color: "var(--faint)" }}>{fmt(s.created_at)}</span>
                  <span className="sess-files">
                    {Object.keys(s.files || {}).length} files
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Input ────────────────────────────────────────────────────────────────────
const EXAMPLES = [
  { t: "Sparse MoE Routing for ViTs", s: "arXiv:2403.09876", src: "arxiv", val: "2403.09876" },
  { t: "FlashAttention-3", s: "arXiv:2407.08608", src: "arxiv", val: "2407.08608" },
  { t: "Mamba: Linear-Time Sequences", s: "arXiv:2312.00752", src: "arxiv", val: "2312.00752" },
  { t: "DPO: Direct Preference Opt.", s: "arXiv:2305.18290", src: "arxiv", val: "2305.18290" },
];

function InputView({ onStart, onBack }) {
  const [src, setSrc] = useState("github");
  const [repo, setRepo] = useState("");
  const [arxiv, setArxiv] = useState("");
  const [hasPdf, setHasPdf] = useState(false);
  const [pdfFile, setPdfFile] = useState(null);
  const [extractedRepo, setExtractedRepo] = useState("");
  const [uploading, setUploading] = useState(false);
  const [hot, setHot] = useState(false);

  const ready = (src === "github" && repo.trim()) || (src === "arxiv" && arxiv.trim()) || (src === "pdf" && hasPdf);

  const handleDrop = async file => {
    if (!file?.name.endsWith(".pdf")) return;
    setPdfFile(file); setHasPdf(true); setUploading(true);
    try {
      const data = await apiUploadPdf(file);
      setExtractedRepo(data.repo_url || "");
    } catch { setExtractedRepo(""); }
    setUploading(false);
  };

  const doStart = () => {
    if (src === "github") onStart("github", repo.trim());
    else if (src === "arxiv") onStart("arxiv", arxiv.trim());
    else onStart("pdf_extracted", extractedRepo || "");
  };

  return (
    <div className="input-page">
      <div className="input-topbar">
        <button className="back-btn" onClick={onBack}>
          <Icon name="chevR" size={14} sw={2} style={{ transform: "rotate(180deg)" }} /> Dashboard
        </button>
        <div className="brand" style={{ margin: "0 auto" }}>
          <span className="brand-mark"><Icon name="replay" size={16} sw={2.2} /></span>
          Reproduce
        </div>
        <div style={{ width: 100 }} />
      </div>

      <div className="land">
        <div className="land-inner">
          <span className="land-badge"><Icon name="replay" size={14} sw={2} /> Reproduction Agent · Pi SDK</span>
          <h1>Reproduce any ML paper,<br /><em>from link to runnable files.</em></h1>
          <p className="lead">Paste a GitHub repo, arXiv ID, or drop a PDF. The agent reads the code, infers the environment, and generates the files you actually need to run it.</p>

          <div className="src-tabs">
            {[["github", "github", "GitHub URL"], ["arxiv", "link", "arXiv / DOI"], ["pdf", "upload", "Paper PDF"]].map(([k, ic, lbl]) => (
              <button key={k} className={"src-tab" + (src === k ? " on" : "")} onClick={() => setSrc(k)}>
                <Icon name={ic} size={16} sw={1.8} />{lbl}
              </button>
            ))}
          </div>

          <div className="src-panel">
            {src === "github" && (
              <div>
                <div className="field">
                  <Icon name="github" size={18} sw={1.7} style={{ color: "var(--muted)" }} />
                  <input value={repo} onChange={e => setRepo(e.target.value)}
                    placeholder="github.com/owner/repo" autoFocus />
                  {repo && <Icon name="check" size={16} sw={2.4} style={{ color: "var(--ok)" }} />}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>
                  The simplest path — paste a repo and the agent starts from the README.
                </div>
              </div>
            )}
            {src === "arxiv" && (
              <div>
                <div className="field">
                  <Icon name="link" size={18} sw={1.7} style={{ color: "var(--muted)" }} />
                  <input value={arxiv} onChange={e => setArxiv(e.target.value)}
                    placeholder="arxiv.org/abs/2403.09876  or  2403.09876" autoFocus />
                  {arxiv && <Icon name="check" size={16} sw={2.4} style={{ color: "var(--ok)" }} />}
                </div>
              </div>
            )}
            {src === "pdf" && (
              <div>
                {!hasPdf ? (
                  <div className={"drop" + (hot ? " hot" : "")}
                    onClick={() => document.getElementById("pdf-input").click()}
                    onDragOver={e => { e.preventDefault(); setHot(true); }}
                    onDragLeave={() => setHot(false)}
                    onDrop={e => { e.preventDefault(); setHot(false); handleDrop(e.dataTransfer.files[0]); }}>
                    <input id="pdf-input" type="file" accept=".pdf" style={{ display: "none" }}
                      onChange={e => handleDrop(e.target.files[0])} />
                    <div className="drop-ic"><Icon name="upload" size={22} sw={1.7} /></div>
                    <div style={{ fontSize: 14.5, fontWeight: 560 }}>Drop a paper PDF here</div>
                    <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>arXiv · NeurIPS · ICML · ICLR</div>
                  </div>
                ) : (
                  <div>
                    <div className="pdf-file">
                      <div className="pdf-ic"><Icon name="file" size={18} sw={1.7} /></div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 560 }}>{pdfFile?.name}</div>
                        <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{uploading ? "Extracting repo link…" : (extractedRepo || "No repo found — enter URL manually")}</div>
                      </div>
                      <button className="flex" style={{ color: "var(--faint)" }} onClick={() => { setHasPdf(false); setPdfFile(null); }}>
                        <Icon name="x" size={16} sw={2} />
                      </button>
                    </div>
                    {!uploading && !extractedRepo && (
                      <div className="field" style={{ marginTop: 10 }}>
                        <Icon name="github" size={18} sw={1.7} style={{ color: "var(--muted)" }} />
                        <input placeholder="github.com/owner/repo (enter manually)"
                          onChange={e => setExtractedRepo(e.target.value)} autoFocus />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="land-foot">
              <span style={{ fontSize: 12, color: "var(--faint)" }} className="flex gap8">
                <Icon name="shield" size={14} sw={1.8} /> Read-only · nothing runs until you approve
              </span>
              <Btn variant="pri" iconR="chevR" disabled={!ready || uploading} onClick={doStart}>
                Generate files
              </Btn>
            </div>
          </div>

          <div style={{ marginTop: 22 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 10 }}>
              Or try an example
            </div>
            <div className="ex-grid">
              {EXAMPLES.map((e, i) => (
                <button key={i} className="ex-card" onClick={() => onStart(e.src, e.val)}>
                  <div className="ex-t">{e.t}</div>
                  <div className="ex-s">{e.s}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Analyzing ────────────────────────────────────────────────────────────────
const AZ_STEPS = [
  "Fetching repository & README",
  "Parsing dependencies & entry points",
  "Inferring environment (Python, CUDA)",
  "Generating Dockerfile & run script",
  "Detecting reproduction risks",
];

function AnalyzingView({ source, value, onDone }) {
  const [step, setStep] = useState(0);
  const [apiDone, setApiDone] = useState(false);
  const [apiResult, setApiResult] = useState(null);

  useEffect(() => {
    if (step < AZ_STEPS.length - 1) {
      const t = setTimeout(() => setStep(s => s + 1), 800);
      return () => clearTimeout(t);
    }
  }, [step]);

  useEffect(() => {
    apiAnalyze(source, value)
      .then(data => { setApiResult(data); setApiDone(true); })
      .catch(() => { setApiResult(null); setApiDone(true); });
  }, []);

  useEffect(() => {
    if (step >= AZ_STEPS.length - 1 && apiDone) {
      const t = setTimeout(() => onDone(apiResult), 400);
      return () => clearTimeout(t);
    }
  }, [step, apiDone]);

  return (
    <div className="analyzing">
      <div className="az-orb"><Icon name="replay" size={32} sw={2} cls="spin" /></div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.02em" }}>Generating reproduction files</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
          {value.replace("https://", "").replace("github.com/", "")}
        </div>
      </div>
      <div className="az-list">
        {AZ_STEPS.map((s, i) => {
          const done = i < step || (i === step && apiDone);
          const now = i === step && !apiDone;
          const cls = done ? "done" : now ? "now" : "";
          return (
            <div key={i} className={"az-item " + cls}>
              <span className="az-check">
                {done ? <Icon name="check" size={12} sw={2.6} />
                  : now ? <Icon name="loader" size={12} sw={2.4} cls="spin" />
                    : <span className="dot dot-wait" />}
              </span>
              {s}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── File Viewer ──────────────────────────────────────────────────────────────
const FILE_ICONS = {
  "Dockerfile": "cube",
  "reproduce.sh": "play",
  "requirements-pinned.txt": "package2",
  "REPRO_NOTES.md": "doc",
};

function FileViewer({ session, onBack }) {
  const files = session.files || {};
  const fileNames = Object.keys(files);
  const [active, setActive] = useState(fileNames[0] || "");
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(files[active] || "").catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const downloadAll = () => {
    fileNames.forEach(name => {
      const blob = new Blob([files[name]], { type: "text/plain" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
    });
  };

  const risks = session.risks || [];
  const highCount = risks.filter(r => r.sev === "high").length;

  return (
    <div className="app">
      {/* topbar */}
      <div className="topbar">
        <button className="back-btn" onClick={onBack} style={{ marginRight: 8 }}>
          <Icon name="chevR" size={14} sw={2} style={{ transform: "rotate(180deg)" }} />
        </button>
        <div className="brand">
          <span className="brand-mark"><Icon name="replay" size={16} sw={2.2} /></span>
          Reproduce
        </div>
        <span className="sep">/</span>
        <div className="crumb">
          <Icon name="github" size={14} sw={1.8} style={{ color: "var(--muted)" }} />
          <b className="mono" style={{ fontSize: 12.5 }}>{session.repo}</b>
        </div>
        <div className="spacer" />
        {highCount > 0 && <Tag kind="risk" icon="alert">{highCount} high risk{highCount > 1 ? "s" : ""}</Tag>}
        <Btn sm icon="ext" onClick={downloadAll}>Download all</Btn>
      </div>

      <div className="workzone">
        {/* left rail: file list + risks */}
        <div className="rail">
          <div className="rail-sec">
            <div className="rail-label">Reproduction files</div>
            {fileNames.map(name => (
              <button key={name} className={"file-item" + (active === name ? " on" : "")} onClick={() => setActive(name)}>
                <Icon name={FILE_ICONS[name] || "file"} size={15} sw={1.8} />
                <span className="file-name">{name}</span>
              </button>
            ))}
          </div>

          <div style={{ borderTop: "1px solid var(--border)" }} />

          <div className="rail-sec">
            <div className="rail-label">Environment</div>
            <div style={{ padding: "2px 4px" }}>
              {(session.env_spec || []).map((e, i) => (
                <div className="env-row" key={i}>
                  <span className="env-k">{e.k}</span>
                  <span className="env-v">{e.v}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ borderTop: "1px solid var(--border)" }} />

          <div className="rail-sec" style={{ paddingBottom: 16 }}>
            <div className="rail-label">Risks</div>
            {risks.map((r, i) => (
              <div key={i} className="risk-mini">
                <span className={"risk-dot sev-dot-" + (r.sev === "high" ? "high" : r.sev === "medium" ? "med" : "low")} />
                <span className="risk-mini-name">{r.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* center: file content */}
        <div className="center">
          <div className="center-scroll" style={{ padding: 0 }}>
            <div className="file-viewer-head">
              <div className="flex gap8" style={{ minWidth: 0 }}>
                <Icon name={FILE_ICONS[active] || "file"} size={15} sw={1.8} style={{ color: "var(--accent-ink)", flexShrink: 0 }} />
                <span style={{ fontSize: 13.5, fontWeight: 580, fontFamily: "var(--mono)" }}>{active}</span>
              </div>
              <div className="flex gap8">
                <Btn sm icon={copied ? "check" : "copy"} onClick={copy}>{copied ? "Copied" : "Copy"}</Btn>
                <Btn sm icon="ext" onClick={() => {
                  const blob = new Blob([files[active]], { type: "text/plain" });
                  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = active; a.click();
                }}>Download</Btn>
              </div>
            </div>
            <FileContent name={active} content={files[active] || ""} />
          </div>
        </div>

        {/* right: chat */}
        <ChatPanel session={session} />
      </div>
    </div>
  );
}

function FileContent({ name, content }) {
  const lines = content.split("\n");
  return (
    <div className="file-content">
      <div className="line-nums">
        {lines.map((_, i) => <span key={i}>{i + 1}</span>)}
      </div>
      <div className="line-code">
        {lines.map((line, i) => <span key={i} className={tokenClass(name, line)}>{line || " "}</span>)}
      </div>
    </div>
  );
}

function tokenClass(name, line) {
  if (name === "Dockerfile") {
    if (/^#/.test(line)) return "cc";
    if (/^(FROM|RUN|WORKDIR|ENV|COPY|ADD|ENTRYPOINT|CMD|EXPOSE|ARG|LABEL)\b/.test(line)) return "ck";
  }
  if (name.endsWith(".sh")) {
    if (/^#/.test(line)) return "cc";
    if (/^(echo|docker|set|export|IMAGE|DATA_DIR)/.test(line)) return "ck";
  }
  if (name.endsWith(".md")) {
    if (/^#{1,3} /.test(line)) return "cm-h";
    if (/^\|/.test(line)) return "cm-t";
    if (/^[-*] /.test(line)) return "cm-li";
  }
  return "";
}

// ── Chat ─────────────────────────────────────────────────────────────────────
function ChatPanel({ session }) {
  const context = { repo: session.repo, analysis: session };
  const [msgs, setMsgs] = useState(INITIAL_CHAT);
  const [typing, setTyping] = useState(false);
  const [val, setVal] = useState("");
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [msgs, typing]);

  const send = async (key, label) => {
    const text = label || val.trim();
    if (!text) return;
    setMsgs(m => [...m, { who: "user", text }]);
    setVal("");
    setTyping(true);
    try {
      const data = await apiChat(text, context);
      setTyping(false);
      setMsgs(m => [...m, { who: "agent", text: data.text }]);
    } catch {
      const reply = (key && SCRIPTED[key]) || SCRIPTED.fallback;
      setTimeout(() => {
        setTyping(false);
        setMsgs(m => [...m, { who: "agent", ...reply }]);
      }, 600);
    }
  };

  return (
    <div className="chat">
      <div className="chat-head">
        <div className="msg-av av-agent"><Icon name="spark" size={14} sw={1.9} /></div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Reproduction Agent</div>
          <div style={{ fontSize: 11, color: "var(--ok)" }} className="flex gap8">
            <span className="dot dot-ok" /> ready
          </div>
        </div>
      </div>

      <div className="chat-scroll" ref={scrollRef}>
        {msgs.map((m, i) => <Message key={i} m={m} />)}
        {typing && (
          <div className="msg">
            <div className="msg-av av-agent"><Icon name="spark" size={14} sw={1.9} /></div>
            <div className="msg-body"><div className="typing"><i /><i /><i /></div></div>
          </div>
        )}
      </div>

      <div className="chat-input">
        <div className="suggest">
          {SUGGESTIONS.map(s => (
            <button key={s.k} className="chip" onClick={() => send(s.k, s.label)}>{s.label}</button>
          ))}
        </div>
        <div className="composer">
          <textarea rows={1} value={val} placeholder="Ask about the files, risks, or how to run…"
            onChange={e => setVal(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(null); } }} />
          <button className="send-btn" disabled={!val.trim()} onClick={() => send(null)}>
            <Icon name="send" size={15} sw={1.9} />
          </button>
        </div>
      </div>
    </div>
  );
}

function Message({ m }) {
  const isUser = m.who === "user";
  return (
    <div className={"msg" + (isUser ? " msg-user" : "")}>
      <div className={"msg-av " + (isUser ? "av-user" : "av-agent")}>
        {isUser ? "You" : <Icon name="spark" size={14} sw={1.9} />}
      </div>
      <div className="msg-body">
        {!isUser && <div className="msg-name">Agent</div>}
        <div className="bubble" dangerouslySetInnerHTML={{ __html: m.text }} />
        {m.card && (
          <div className="bubble-card">
            <div className="bc-head"><Icon name="flask" size={12} sw={2} /> {m.card.head}</div>
            {m.card.rows.map((r, i) => (
              <div className="bc-row" key={i}>
                <span style={{ color: "var(--muted)" }}>{r.k}</span>
                <span className="flex gap10">
                  <span className="muted mono" style={{ fontSize: 11 }}>{r.a}→{r.b}</span>
                  <span className={r.pos ? "delta-pos" : "delta-neg"}>{r.d}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── App root ─────────────────────────────────────────────────────────────────
function App() {
  const [view, setView] = useState("dashboard"); // dashboard | input | analyzing | viewer
  const [inputSrc, setInputSrc] = useState("");
  const [inputVal, setInputVal] = useState("");
  const [session, setSession] = useState(null);

  const handleStart = (src, val) => {
    setInputSrc(src); setInputVal(val); setView("analyzing");
  };

  const handleAnalyzeDone = (data) => {
    // Build session from real data or fall through to mock
    const base = data || MOCK_SESSION;
    const sess = {
      id: (base.paper?.repo || base.repo || inputVal).replace(/[^a-z0-9]/gi, "-").toLowerCase() + "-" + Date.now(),
      repo: base.paper?.repo || base.repo || inputVal,
      title: base.paper?.title || base.title || "",
      venue: base.paper?.venue || base.venue || "",
      stars: base.paper?.stars || base.stars || "",
      headline: base.paper?.headline || base.headline || "",
      created_at: new Date().toISOString(),
      files: base.files || MOCK_SESSION.files,
      risks: base.risks || MOCK_SESSION.risks,
      env_spec: base.env_spec || MOCK_SESSION.env_spec,
    };
    saveSession(sess);
    setSession(sess);
    setView("viewer");
  };

  if (view === "dashboard") return <Dashboard onNew={() => setView("input")} onOpen={s => { setSession(s); setView("viewer"); }} />;
  if (view === "input") return <InputView onStart={handleStart} onBack={() => setView("dashboard")} />;
  if (view === "analyzing") return <AnalyzingView source={inputSrc} value={inputVal} onDone={handleAnalyzeDone} />;
  return <FileViewer session={session} onBack={() => setView("dashboard")} />;
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
