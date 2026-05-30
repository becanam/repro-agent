/* global React, window, PIPELINE, FILE_TREE, DEPENDENCIES, HYPERPARAMS, ENV_SPEC, DOCKERFILE, RUN_PROCEDURE, RISKS, BRANCHES, PAPER, SUGGESTIONS */
const { useState: useStateP } = React;
const { Icon: Ic, Tag: Tg, Btn: Bt, Panel: Pn, CopyBtn: Cpy } = window;

// =================== PIPELINE TRACKER ===================
function PipelineTracker({ progress }) {
  return (
    <div className="pipe">
      {PIPELINE.map((s, i) => {
        const st = i < progress ? "done" : i === progress ? "active" : "wait";
        return (
          <React.Fragment key={s.id}>
            {i > 0 && <div className={"pconn" + (i <= progress ? " done" : "")} />}
            <div className={"pstep " + st}>
              <div className={"pnum s-" + st}>
                {st === "done" ? <Ic name="check" size={13} sw={2.4} />
                  : st === "active" ? <Ic name="loader" size={13} sw={2.4} cls="spin" />
                    : i + 1}
              </div>
              <div className="pmeta">
                <div className="pname">{s.name}</div>
                <div className="pstat">
                  {st === "done" ? "Complete" : st === "active" ? "Running…" : "Queued"}
                </div>
              </div>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// =================== REPO ANALYSIS ===================
function RepoAnalysis({ analysisData }) {
  const fileTree = analysisData?.file_tree || FILE_TREE;
  const dependencies = analysisData?.dependencies || DEPENDENCIES;
  const hyperparams = analysisData?.hyperparams || HYPERPARAMS;

  return (
    <div className="fade-in section-gap" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      <Pn title="File tree" icon="layers" right={<Tg kind="accent" icon="check">parsed</Tg>}>
        <div className="tree">
          {fileTree.map((n, i) => (
            <div key={i} style={{ paddingLeft: n.indent * 18 }}>
              <span className={"t-" + n.t}>
                {n.t === "dir" ? "▸ " : n.t === "note" ? "✕ " : "  "}{n.txt}
              </span>
              {n.tag && <span className="t-tag">{n.tag}</span>}
            </div>
          ))}
        </div>
      </Pn>

      <div className="section-gap">
        <Pn title="Dependencies" icon="package2" sub={dependencies.length + " resolved"}>
          {dependencies.map((d, i) => (
            <div className="kv" key={i}>
              <span className="kv-k"><span className="mono">{d.name}</span></span>
              <span className="flex gap8">
                <span className="mono-chip">{d.ver}</span>
                {d.inferred && <Tg kind="warn">inferred</Tg>}
              </span>
            </div>
          ))}
        </Pn>
      </div>

      <div style={{ gridColumn: "1 / -1" }}>
        <Pn title="Hyperparameters" icon="sliders" sub="extracted from config + paper">
          {hyperparams.map((h, i) => {
            const missing = h.val === "—" || h.val === "not set" || h.val === "missing";
            return (
              <div className="hp-row" key={i}>
                <span className="hp-name">{h.name}</span>
                <span className="hp-val" style={missing ? { color: "var(--risk)" } : null}>{h.val}</span>
                <span>{h.src === "missing"
                  ? <Tg kind="risk" icon="alert">missing</Tg>
                  : <span className="mono-chip">{h.src}</span>}</span>
              </div>
            );
          })}
        </Pn>
      </div>
    </div>
  );
}

// =================== DOCKERFILE ===================
function DockerfileView({ analysisData }) {
  // Use real dockerfile from analysis, or fall back to mock
  const rawDockerfile = analysisData?.dockerfile;
  const stats = analysisData?.docker_stats || null;

  // Build display lines from raw string if available
  let displayLines;
  let copyText;
  if (rawDockerfile) {
    copyText = rawDockerfile;
    displayLines = rawDockerfile.split("\n").map((line, i) => {
      const isComment = line.startsWith("#");
      const kwMatch = !isComment && line.match(/^([A-Z]+)(\s.*)?$/);
      if (line === "") return { t: "blank", key: i };
      if (isComment) return { c2: line, key: i };
      if (kwMatch) return { k: kwMatch[1], rest: kwMatch[2] || "", key: i };
      return { plain: line, key: i };
    });
  } else {
    copyText = DOCKERFILE.map(l => l.t === "blank" ? "" : l.c2 ? l.c2 : (l.k ? l.k + l.rest : l.plain)).join("\n");
    displayLines = DOCKERFILE.map((l, i) => ({ ...l, key: i }));
  }

  const baseImage = stats?.base_image || analysisData?.env_spec?.find(e => e.k === "CUDA")
    ? `cuda:${analysisData?.env_spec?.find(e => e.k === "CUDA")?.v}.0`
    : "cuda:11.8.0";
  const sizeGb = stats?.estimated_size_gb || 6.8;
  const buildMin = stats?.build_time_min || 7;

  return (
    <div className="fade-in">
      <Pn title={<span>Dockerfile <span className="mono-chip" style={{ marginLeft: 6 }}>auto-generated</span></span>}
        icon="cube"
        right={<span className="flex gap8"><Tg kind="ok" icon="check">builds clean</Tg><Cpy getText={() => copyText} /></span>}
        pad={false}>
        <div className="code" style={{ border: "none", borderRadius: 0 }}>
          <div className="code-body" style={{ background: "#fbfbfc" }}>
            {displayLines.map((l) => {
              if (l.t === "blank") return <span className="cl" key={l.key}>{" "}</span>;
              if (l.c2) return <span className="cl cc" key={l.key}>{l.c2}</span>;
              if (l.k) return <span className="cl" key={l.key}><span className="ck">{l.k}</span>{l.rest}</span>;
              return <span className="cl" key={l.key}>{l.plain}</span>;
            })}
          </div>
        </div>
      </Pn>
      <div style={{ marginTop: 14 }}>
        <Pn title="Build target" icon="cpu">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
            <Stat k="Base image" v={baseImage} sub="cudnn-devel" />
            <Stat k="Est. image size" v={`${sizeGb} GB`} sub="layered" />
            <Stat k="Build time" v={`~${buildMin} min`} sub="cold cache" />
          </div>
        </Pn>
      </div>
    </div>
  );
}

function Stat({ k, v, sub }) {
  return (
    <div style={{ padding: "2px 0" }}>
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 5 }}>{k}</div>
      <div className="mono" style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.02em" }}>{v}</div>
      <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 2 }}>{sub}</div>
    </div>
  );
}

// =================== RUN PROCEDURE ===================
function RunProcedureView({ analysisData }) {
  const procedure = analysisData?.run_procedure || RUN_PROCEDURE;
  return (
    <div className="fade-in">
      <Pn title="Run procedure" icon="terminal" sub="driven by paper's reported config"
        right={<Tg kind="accent" icon="spark">paper-grounded</Tg>}>
        {procedure.map((s, i) => (
          <div className="run-step" key={i}>
            <div className="run-idx">{i + 1}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 580, letterSpacing: "-0.01em" }}>{s.title}</div>
              <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 3, lineHeight: 1.5 }}>{s.desc}</div>
              <div className="run-cmd"><span className="prompt">$</span><span>{s.cmd}</span></div>
            </div>
          </div>
        ))}
      </Pn>
    </div>
  );
}

// =================== RISKS ===================
function RisksView({ analysisData }) {
  const risks = analysisData?.risks || RISKS;
  const sevIcon = { high: "alert", medium: "shield", low: "check" };
  const sevTag = { high: "risk", medium: "warn", low: "ok" };

  const highCount = risks.filter(r => r.sev === "high").length;
  const medCount = risks.filter(r => r.sev === "medium").length;
  const lowCount = risks.filter(r => r.sev === "low").length;

  return (
    <div className="fade-in">
      <div className="flex gap8" style={{ marginBottom: 13 }}>
        {highCount > 0 && <Tg kind="risk" icon="alert">{highCount} high</Tg>}
        {medCount > 0 && <Tg kind="warn" icon="shield">{medCount} medium</Tg>}
        {lowCount > 0 && <Tg kind="ok" icon="check">{lowCount} low</Tg>}
        <span className="muted" style={{ fontSize: 12, marginLeft: 4 }}>· auto-detected from paper ↔ repo gaps</span>
      </div>
      {risks.map((r, i) => (
        <div className="risk-card" key={i}>
          <div className="risk-top">
            <div className={"risk-sev sev-" + (r.sev === "high" ? "high" : r.sev === "medium" ? "med" : "low")}>
              <Ic name={sevIcon[r.sev] || "shield"} size={18} sw={1.9} />
            </div>
            <div className="risk-body">
              <div className="flex between gap10">
                <div className="risk-name">{r.name}</div>
                <Tg kind={sevTag[r.sev] || "neutral"}>{r.sev}</Tg>
              </div>
              <div className="risk-desc">{r.desc}</div>
            </div>
          </div>
          <div className="risk-fix">
            <Ic name="spark" size={14} sw={1.9} style={{ marginTop: 1, flexShrink: 0 }} />
            <span><b style={{ fontWeight: 600 }}>Mitigation</b> · {r.fix}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// =================== LEFT RAIL ===================
function LeftRail({ branch, setBranch, progress, analysisData }) {
  const paper = analysisData?.paper || PAPER;
  const envSpec = analysisData?.env_spec || ENV_SPEC;

  // Build branches list: always include current branch
  const branches = [
    { id: "main", name: "main", meta: `${analysisData?.risks?.length || 5} risks`, ic: "branch" },
    { id: "cuda-fix", name: "cuda-fix", meta: "pin CUDA version", ic: "cube" },
    { id: "cpu-fallback", name: "cpu-fallback", meta: "no GPU · eval only", ic: "cpu" },
  ];

  return (
    <div className="rail">
      <div className="rail-sec">
        <div className="rail-label">Reproduction</div>
        <div style={{ padding: "2px 4px 6px" }}>
          <div style={{ fontSize: 13.5, fontWeight: 580, lineHeight: 1.35, letterSpacing: "-0.01em" }}>{paper.title}</div>
          {paper.authors && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 5 }}>{paper.authors}</div>}
          <div className="flex gap8" style={{ marginTop: 9, flexWrap: "wrap" }}>
            {paper.venue && <Tg kind="neutral">{paper.venue}</Tg>}
            {paper.arxiv && <span className="mono-chip">arXiv:{paper.arxiv}</span>}
            {!paper.venue && !paper.arxiv && <Tg kind="neutral">ML Paper</Tg>}
          </div>
          <a className="flex gap8" href={`https://github.com/${paper.repo}`} target="_blank" rel="noreferrer"
            style={{ marginTop: 10, fontSize: 12, color: "var(--accent-ink)", fontFamily: "var(--mono)", textDecoration: "none" }}>
            <Ic name="github" size={14} sw={1.8} />{paper.repo}
            <Ic name="ext" size={11} sw={2} style={{ opacity: .6 }} />
          </a>
        </div>
      </div>

      <div style={{ borderTop: "1px solid var(--border)" }} />

      <div className="rail-sec">
        <div className="rail-label">Environment spec
          <Tg kind="accent">inferred</Tg>
        </div>
        <div style={{ padding: "2px 4px" }}>
          {envSpec.map((e, i) => (
            <div className="env-row" key={i}>
              <span className="env-k">{e.k}</span>
              <span className="flex gap8">
                <span className={"env-v" + (e.infer ? " infer" : "")}>{e.v}</span>
                {e.infer && <span title="inferred" className="dot" style={{ background: "var(--accent)" }} />}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ borderTop: "1px solid var(--border)" }} />

      <div className="rail-sec" style={{ paddingBottom: 16 }}>
        <div className="rail-label">Session branches
          <button className="flex" style={{ color: "var(--faint)" }} title="New branch"
            onClick={() => {
              const name = prompt("New branch name:");
              if (name) setBranch(name);
            }}>
            <Ic name="plus" size={14} sw={2.2} />
          </button>
        </div>
        {branches.map(b => (
          <div key={b.id} className={"branch" + (branch === b.id ? " on" : "")} onClick={() => setBranch(b.id)}>
            <div className="branch-ic"><Ic name={b.ic} size={14} sw={1.8} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="branch-name">{b.name}</div>
              <div className="branch-meta">{b.meta}</div>
            </div>
            {branch === b.id && <span className="dot dot-run live" />}
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { PipelineTracker, RepoAnalysis, DockerfileView, RunProcedureView, RisksView, LeftRail });
