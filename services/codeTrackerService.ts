import { geminiService } from './geminiService';
import { githubReleasesService } from './githubReleasesService';

export interface CodeSnapshot {
  version: string;
  date: string;
  features: string[];
  body: string;
  htmlUrl: string;
}

export class CodeTrackerService {
  /** Get release history from GitHub. Use githubReleasesService for cache control (e.g. refresh). */
  async getHistory(): Promise<CodeSnapshot[]> {
    return githubReleasesService.getReleases(false);
  }

  /** Clear cached GitHub releases so next getHistory() fetches fresh data. */
  invalidateCache(): void {
    githubReleasesService.invalidateCache();
  }

  async generateReleaseNotes(version: string): Promise<string> {
    const history = await this.getHistory();
    const snapshot = history.find(s => s.version === version);
    if (!snapshot) return "Deployment logs for this version are currently archived.";

    const prompt = `You are a professional technical lead. Provide a concise 2-sentence executive summary of this GitHub release log for Orin Chat v${version}. Focus on institutional value and stability.
    Log: ${snapshot.body}`;

    try {
      // Internal summary generation should not consume the user's daily quota.
      const { text } = await geminiService.chat(prompt, { internal: true });
      return text || "Summary generation protocol failed.";
    } catch {
      return `Build ${version} focuses on critical path stability and synchronized neural workspace logic.`;
    }
  }
}

export const codeTrackerService = new CodeTrackerService();
