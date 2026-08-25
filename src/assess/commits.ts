/**
 * Layer 3: commit-message analysis — conventional-commit breaking markers
 * (`!`, `BREAKING CHANGE:` footers) plus keyword heuristics for
 * non-conventional messages. Used when release notes are absent.
 */

export interface CommitSignal {
  sha: string;
  message: string;
  ctype: string;
  scope: string | null;
  is_breaking: boolean;
  confidence: number;
}

const BREAKING_KEYWORDS = ["remove ", "drop ", "deprecate ", "rename ", "no longer ", "breaking"];

export function analyzeCommits(commits: Array<{ sha: string; message: string }>): CommitSignal[] {
  const signals: CommitSignal[] = [];
  for (const commit of commits) {
    const msg = commit.message;
    const sha = commit.sha.slice(0, 7);
    const conv = msg.match(/^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)/);
    if (conv) {
      const [, ctype, scope, bang] = conv;
      const isBreaking = bang === "!" || msg.includes("BREAKING CHANGE:");
      signals.push({
        sha,
        message: msg,
        ctype,
        scope: scope || null,
        is_breaking: isBreaking,
        confidence: isBreaking ? 0.9 : 0.5,
      });
      continue;
    }
    for (const kw of BREAKING_KEYWORDS) {
      if (msg.toLowerCase().includes(kw)) {
        signals.push({
          sha,
          message: msg,
          ctype: "unknown",
          scope: null,
          is_breaking: true,
          confidence: 0.6,
        });
        break;
      }
    }
  }
  return signals;
}
