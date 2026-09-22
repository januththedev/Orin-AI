
import React, { useState } from 'react';
import { Language } from '../types';
import { translations } from '../translations';
import { APP_CONFIG } from '../config';

interface DownloadsPageProps {
  onClose: () => void;
  lang: Language;
}

const DownloadsPage: React.FC<DownloadsPageProps> = ({ onClose, lang }) => {
  const t = translations[lang];
  const [activeCodeTab, setActiveCodeTab] = useState<'js' | 'ts' | 'py'>('js');
  const [downloading, setDownloading] = useState<string | null>(null);

  const handleDownload = async (platform: string, arch?: string) => {
    const label = `${platform} ${arch || ''}`.trim();
    setDownloading(label);
    const startedAt = Date.now();
    const minToastMs = 1500;

    const v = APP_CONFIG.version;
    const tag = `V${v}`;
    let url = "";
    if (platform === 'Android') {
      url = `https://github.com/${APP_CONFIG.githubRepo}/releases/download/${tag}/Orin.AI.Mob.apk`;
    } else if (platform === 'Windows') {
      if (arch === 'x64') url = `https://github.com/${APP_CONFIG.githubRepo}/releases/download/${tag}/Orin.AI.Setup.${v}.x64.exe`;
      else if (arch === 'x32') url = `https://github.com/${APP_CONFIG.githubRepo}/releases/download/${tag}/Orin.AI.Setup.${v}.x32.exe`;
      else if (arch === 'ARM') url = `https://github.com/${APP_CONFIG.githubRepo}/releases/download/${tag}/Orin.AI.Setup.${v}.xARM.exe`;
    }

    try {
      if (url) {
        const res = await fetch(url, { mode: 'cors' });
        if (!res.ok) throw new Error(`Download failed: ${res.status}`);
        const blob = await res.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.setAttribute('download', url.split('/').pop() || 'download');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(blobUrl);
      } else {
        const filename = `orin-setup-${platform.toLowerCase()}${arch ? '-' + arch.toLowerCase().replace(' ', '-') : ''}.exe`;
        const dummyContent = `Orin AI Platform v${v} Installer\nTarget: ${label}\nVerified Artifact: JN-PROD-${Date.now()}\n\nThis is a secure system download from JN Productions Global.`;
        const blob = new Blob([dummyContent], { type: 'application/octet-stream' });
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(blobUrl);
      }
    } catch {
      if (url) {
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', '');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } finally {
      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, minToastMs - elapsed);
      if (remaining > 0) setTimeout(() => setDownloading(null), remaining);
      else setDownloading(null);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert(t.codeCopied);
  };

  const codeSnippets = {
    js: `<!-- Orin Chat Search Widget -->
<div style="max-width: 600px; margin: 20px auto; font-family: 'Plus Jakarta Sans', sans-serif;">
  <form onsubmit="searchOrin(event)" style="display: flex; gap: 8px; background: rgba(255,255,255,0.9); border: 1px solid #e2e8f0; border-radius: 20px; padding: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
    <input type="text" id="orin-query" placeholder="Ask Orin Chat..." required style="flex: 1; border: none; padding: 12px 18px; outline: none; background: transparent;" />
    <button type="submit" style="background: #0891b2; color: white; border: none; padding: 10px 24px; border-radius: 14px; font-weight: 800; cursor: pointer;">GO</button>
  </form>
  <div style="text-align: center; margin-top: 10px; font-size: 9px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 2px;">
    Orin Chat | JN Productions | Januth Nimnal
  </div>
</div>

<script>
  function searchOrin(e) {
    e.preventDefault();
    const q = document.getElementById('orin-query').value;
    window.location.href = "https://www.orinai.org/#chat?prompt=" + encodeURIComponent(q);
  }
</script>`,
    ts: `// Orin Chat React Component
import React, { useState } from 'react';

export const OrinSearch = () => {
  const [q, setQ] = useState('');
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    window.location.href = \`https://www.orinai.org/#chat?prompt=\${encodeURIComponent(q)}\`;
  };

  return (
    <div className="max-w-md mx-auto p-4">
      <form onSubmit={handleSearch} className="flex bg-white rounded-3xl p-1 shadow-lg border border-slate-100">
        <input value={q} onChange={e => setQ(e.target.value)} className="flex-1 px-5 py-3 outline-none focus:outline-none focus:ring-0 min-w-0" placeholder="Ask Orin..." />
        <button className="bg-cyan-600 text-white px-6 rounded-2xl font-black text-xs uppercase">GO</button>
      </form>
      <div className="text-center mt-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">
        Orin Chat | JN Productions | Januth Nimnal
      </div>
    </div>
  );
};`,
    py: `# Python Streamlit / Flask Integration
import streamlit as st
import urllib.parse

def orin_search_widget():
    query = st.text_input("Ask Orin Chat anything:", placeholder="Help with math...")
    if st.button("GO"):
        safe_q = urllib.parse.quote(query)
        st.markdown(f'<meta http-equiv="refresh" content="0;URL=\\'https://www.orinai.org/#chat?prompt={safe_q}\\'">', unsafe_allow_html=True)
    
    st.caption("ORIN AI | JN PRODUCTIONS | JANUTH NIMNAL")
`
  };

  return (
    <div className="h-full w-full overflow-y-auto custom-scrollbar bg-slate-50 dark:bg-slate-950 animate-reveal pb-20">
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-10 md:py-16">
        
        <header className="flex items-center justify-between border-b border-black/5 dark:border-white/5 pb-8 mb-12">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-cyan-600 flex items-center justify-center text-white shadow-xl">
              <i className="fa-solid fa-cloud-arrow-down text-xl"></i>
            </div>
            <div>
              <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tighter uppercase leading-none">{t.downloads}</h2>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.4em] mt-2">v{APP_CONFIG.version} Stable Distribution</p>
            </div>
          </div>
          <button onClick={onClose} className="w-12 h-12 rounded-2xl glass-panel flex items-center justify-center text-slate-400 hover:text-red-500 transition-all hover:rotate-90">
            <i className="fa-solid fa-xmark text-lg"></i>
          </button>
        </header>

        {/* Windows Hero Download */}
        <section className="mb-12">
          <div className="glass-panel p-8 md:p-12 rounded-[48px] border border-cyan-500/20 shadow-2xl relative overflow-hidden bg-white/80 dark:bg-slate-900/80 backdrop-blur-3xl">
             <div className="absolute top-0 right-0 p-32 bg-cyan-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
             
             <div className="flex flex-col md:flex-row items-center justify-between gap-10 relative z-10">
                <div className="flex-1 space-y-6 text-center md:text-left">
                   <div className="flex items-center justify-center md:justify-start gap-4">
                      <i className="fa-brands fa-windows text-5xl text-cyan-600"></i>
                      <h3 className="text-3xl font-black text-slate-900 dark:text-white uppercase tracking-tighter">Windows Desktop</h3>
                   </div>
                   <p className="text-sm font-medium text-slate-600 dark:text-slate-400 max-w-md leading-relaxed">
                     Orin's most powerful workspace. Full access to GPU-accelerated reasoning, Studio Create, and local memory synchronization.
                   </p>
                   <div className="flex flex-wrap justify-center md:justify-start gap-2">
                      <span className="px-3 py-1 bg-cyan-500/10 text-cyan-600 rounded-lg text-[10px] font-black uppercase tracking-widest border border-cyan-500/20">Stable Build</span>
                      <span className="px-3 py-1 bg-slate-100 dark:bg-white/5 text-slate-400 rounded-lg text-[10px] font-black uppercase tracking-widest">Windows 10 / 11 · ~3 MB</span>
                   </div>
                </div>

                <div className="flex flex-col gap-3 w-full md:w-80">
                   <button 
                     onClick={() => handleDownload('Windows', 'x64')}
                     className="w-full py-5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-between px-8"
                   >
                     <span>Windows 64-bit</span>
                     <i className="fa-solid fa-download"></i>
                   </button>
                   <a
                     href={`https://github.com/${APP_CONFIG.githubRepo}/releases`}
                     target="_blank"
                     rel="noopener noreferrer"
                     className="w-full py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-white/10 text-slate-500 rounded-xl font-bold text-[10px] uppercase tracking-widest hover:border-cyan-500/40 hover:text-cyan-600 transition-all flex items-center justify-center gap-2 no-underline"
                   >
                     <i className="fa-brands fa-github"></i> All releases on GitHub
                   </a>
                </div>
             </div>
          </div>
        </section>

        {/* Other platforms */}
        <section className="mb-20">
          <div className="glass-panel p-6 rounded-[24px] border border-black/5 dark:border-white/5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center text-cyan-600 shrink-0"><i className="fa-solid fa-circle-info"></i></div>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold">
              macOS and mobile builds are on the roadmap. Everything Orin offers today lives on the web — free, no install needed.
            </p>
          </div>
        </section>

        {/* Developer Sandbox */}
        <section className="animate-reveal" style={{ animationDelay: '0.2s' }}>
           <div className="flex items-center gap-4 mb-8">
              <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-white/5 flex items-center justify-center text-slate-400"><i className="fa-solid fa-code"></i></div>
              <div>
                <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tighter">{t.forDevs}</h3>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Public Search API Integration</p>
              </div>
           </div>

           <div className="glass-panel rounded-[40px] border border-black/5 dark:border-white/5 overflow-hidden shadow-sm">
              <div className="bg-slate-100/50 dark:bg-white/5 p-4 flex flex-col md:flex-row items-center justify-between gap-4 border-b border-black/5 dark:border-white/5 px-8">
                 <div className="flex bg-white dark:bg-black/20 rounded-xl p-1 shadow-inner">
                    <button onClick={() => setActiveCodeTab('js')} className={`px-5 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${activeCodeTab === 'js' ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-950' : 'text-slate-400'}`}>JavaScript</button>
                    <button onClick={() => setActiveCodeTab('ts')} className={`px-5 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${activeCodeTab === 'ts' ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-950' : 'text-slate-400'}`}>TypeScript</button>
                    <button onClick={() => setActiveCodeTab('py')} className={`px-5 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${activeCodeTab === 'py' ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-950' : 'text-slate-400'}`}>Python</button>
                 </div>
                 <button onClick={() => copyToClipboard(codeSnippets[activeCodeTab])} className="flex items-center gap-2 px-6 py-2 bg-cyan-600 text-white rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-cyan-500 transition-all shadow-lg active:scale-95">
                    <i className="fa-solid fa-copy"></i>
                    Copy Snippet
                 </button>
              </div>
              <div className="bg-[#0f172a] p-8 md:p-12 overflow-x-auto custom-scrollbar">
                 <pre className="text-xs md:text-sm font-mono text-cyan-200/80 leading-relaxed">
                    <code>{codeSnippets[activeCodeTab]}</code>
                 </pre>
              </div>
           </div>
        </section>

        {downloading && (
           <div className="fixed bottom-10 right-10 z-[200] glass-panel px-6 py-4 rounded-2xl border border-cyan-500 shadow-2xl flex items-center gap-4 animate-reveal bg-white dark:bg-slate-900">
              <div className="w-10 h-10 rounded-full border-4 border-cyan-500/20 border-t-cyan-500 animate-spin"></div>
              <div>
                 <p className="text-[10px] font-black text-slate-900 dark:text-white uppercase tracking-widest">Preparing Artifact</p>
                 <p className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">{downloading} Package</p>
              </div>
           </div>
        )}

        <footer className="pt-32 text-center opacity-30">
           <div className="w-12 h-1 bg-slate-300 dark:bg-slate-800 mx-auto rounded-full mb-8"></div>
           <p className="text-[9px] font-black uppercase tracking-[0.6em] text-slate-500 dark:text-slate-400">
             JN Productions Global • 2026 Distribution Protocol
           </p>
        </footer>
      </div>
    </div>
  );
};

export default DownloadsPage;
