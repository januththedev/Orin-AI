import packageJson from './package.json';

/** Single source of truth for app version: package.json. Used by Downloads, footer, etc. */
export const APP_CONFIG = {
  version: (packageJson as { version?: string }).version ?? '0.0.0',
  branding: "© 2026 JN Productions • Orin AI",
  isWhiteLabel: false,
  releaseYear: 2026,
  platformName: "Orin Chat",
  sloganEn: "From a Sri Lankan to Sri Lankans.",
  sloganSi: "ශ්‍රී ලාංකිකයෙකුගෙන් ශ්‍රී ලාංකිකයන්ට.",
  owner: "JN Productions",
  legalEntity: "JN Productions Global",
  deploymentLink: "https://www.orinai.org",
  githubRepo: "januththedev/Orin-AI-for-PC"  // Desktop app repo — downloads pull from its Releases (tag V{version})
};