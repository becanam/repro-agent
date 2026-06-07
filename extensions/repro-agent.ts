/**
 * repro-agent Pi Extension
 *
 * Registers tools, commands, and events that extend Pi with
 * ML paper reproduction capabilities. Connects to the GitHub
 * and arXiv MCP servers and exposes a /repro slash command.
 */

import type { Extension, Tool, Command, McpServer } from "@pi-dev/sdk";

// ── MCP server declarations ──────────────────────────────────────────────────

const githubMcp: McpServer = {
  id: "github",
  command: "python3",
  args: ["-m", "mcp_tools.github_server"],
  env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN ?? "" },
  description: "Fetch GitHub repository metadata, README, file tree, and raw files",
};

const arxivMcp: McpServer = {
  id: "arxiv",
  command: "python3",
  args: ["-m", "mcp_tools.arxiv_server"],
  description: "Fetch arXiv paper abstracts and extract repository links",
};

// ── Tool definitions ─────────────────────────────────────────────────────────

const tools: Tool[] = [
  {
    name: "repro_analyze_repo",
    description:
      "Analyze a GitHub ML repository for reproduction: fetches README, requirements.txt, " +
      "and file tree; extracts dependencies, entry points, hyperparameters, and environment spec.",
    inputSchema: {
      type: "object",
      properties: {
        repo: {
          type: "string",
          description: "GitHub repo as owner/name or full URL",
        },
        branch: {
          type: "string",
          description: "Branch to analyze (default: HEAD)",
          default: "HEAD",
        },
      },
      required: ["repo"],
    },
    handler: async ({ repo, branch = "HEAD" }) => {
      const res = await fetch(`http://localhost:8000/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "github", value: repo, branch }),
      });
      if (!res.ok) throw new Error(`Analysis failed: ${res.statusText}`);
      return res.json();
    },
  },

  {
    name: "repro_generate_dockerfile",
    description:
      "Generate a pinned, reproducible Dockerfile from a repo analysis result. " +
      "Selects the correct CUDA base image, pins PyTorch, and injects determinism settings.",
    inputSchema: {
      type: "object",
      properties: {
        analysis: {
          type: "object",
          description: "Analysis result from repro_analyze_repo",
        },
        variant: {
          type: "string",
          enum: ["cuda", "cpu"],
          description: "Target variant: 'cuda' (default) or 'cpu' fallback",
          default: "cuda",
        },
      },
      required: ["analysis"],
    },
    handler: async ({ analysis, variant = "cuda" }) => {
      const res = await fetch(`http://localhost:8000/api/dockerfile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysis, variant }),
      });
      if (!res.ok) throw new Error(`Dockerfile generation failed: ${res.statusText}`);
      return res.json();
    },
  },

  {
    name: "repro_detect_risks",
    description:
      "Detect reproduction risks by comparing repository code against paper claims. " +
      "Returns a list of risks classified as high/medium/low with mitigations.",
    inputSchema: {
      type: "object",
      properties: {
        analysis: {
          type: "object",
          description: "Analysis result from repro_analyze_repo",
        },
        paper_text: {
          type: "string",
          description: "Extracted paper text (abstract + experiments section)",
        },
      },
      required: ["analysis"],
    },
    handler: async ({ analysis, paper_text = "" }) => {
      const res = await fetch(`http://localhost:8000/api/risks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysis, paper_text }),
      });
      if (!res.ok) throw new Error(`Risk detection failed: ${res.statusText}`);
      return res.json();
    },
  },

  {
    name: "repro_arxiv_lookup",
    description:
      "Look up an arXiv paper by ID or URL and extract the GitHub repository link " +
      "from the abstract or footnotes.",
    inputSchema: {
      type: "object",
      properties: {
        arxiv_id: {
          type: "string",
          description: "arXiv ID (e.g. 2403.09876) or full URL",
        },
      },
      required: ["arxiv_id"],
    },
    handler: async ({ arxiv_id }) => {
      const res = await fetch(`http://localhost:8000/api/arxiv`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ arxiv_id }),
      });
      if (!res.ok) throw new Error(`arXiv lookup failed: ${res.statusText}`);
      return res.json();
    },
  },
];

// ── Slash command ────────────────────────────────────────────────────────────

const reproCommand: Command = {
  name: "repro",
  description: "Reproduce an ML paper: /repro <github_url_or_arxiv_id>",
  handler: async ({ args, session }) => {
    const input = args.trim();
    if (!input) {
      return session.reply(
        "Usage: `/repro <github.com/owner/repo>` or `/repro arxiv:2403.09876`\n\n" +
          "Or open the Web UI at http://localhost:8000 for the full interface."
      );
    }

    await session.reply(`Starting reproduction pipeline for \`${input}\`…`);

    const source = input.startsWith("arxiv") || /^\d{4}\.\d{4,5}$/.test(input)
      ? "arxiv"
      : "github";

    const res = await fetch("http://localhost:8000/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, value: input }),
    });

    if (!res.ok) {
      return session.reply(`❌ Analysis failed: ${res.statusText}`);
    }

    const data = await res.json();
    const risks = (data.risks ?? []) as Array<{ sev: string; name: string }>;
    const highRisks = risks.filter((r) => r.sev === "high");

    const summary = [
      `✅ **Repo analyzed**: \`${data.paper?.repo}\``,
      `📦 **Dependencies**: ${data.dependencies?.length ?? 0} resolved`,
      `🐳 **Dockerfile**: generated (${data.stats?.base_image ?? "CUDA"})`,
      highRisks.length > 0
        ? `⚠️ **${highRisks.length} high-severity risks**: ${highRisks.map((r) => r.name).join(", ")}`
        : `✅ No high-severity risks detected`,
      `\n🌐 Open the Web UI for full details: http://localhost:8000`,
    ].join("\n");

    return session.reply(summary);
  },
};

// ── Extension export ─────────────────────────────────────────────────────────

const extension: Extension = {
  name: "repro-agent",
  version: "1.0.0",
  description: "ML Paper Reproduction Agent — from PDF to running container",
  mcpServers: [githubMcp, arxivMcp],
  tools,
  commands: [reproCommand],
  onLoad: async () => {
    console.log("[repro-agent] Extension loaded. Web UI: http://localhost:8000");
  },
};

export default extension;
