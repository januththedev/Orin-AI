
import React, { useEffect, useState } from 'react';
import { ApiKeyDef } from '../types';
import { sessionService } from '../services/sessionService';

export default function APIControls() {
  const [keys, setKeys] = useState<ApiKeyDef[]>([]);
  const [note, setNote] = useState('');
  const [newKey, setNewKey] = useState<string | null>(null);

  useEffect(() => {
    sessionService.getApiKeys().then(setKeys);
  }, [newKey]);

  const handleGenerate = async () => {
    if (!note) return alert("Add a note first.");
    try {
      const key = await sessionService.generateApiKey(note);
      setNewKey(key);
      setNote('');
    } catch (e: any) {
      alert("Generation failed: " + e.message);
    }
  };

  return (
    <div className="space-y-10 animate-reveal">
       <div className="flex justify-between items-center">
          <h3 className="text-2xl font-black uppercase tracking-tighter">API Infrastructure</h3>
       </div>

       {newKey && (
         <div className="p-6 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl space-y-2">
            <h4 className="text-emerald-500 font-black uppercase text-xs tracking-widest">New Key Generated</h4>
            <div className="flex items-center gap-4">
               <code className="bg-black/30 px-4 py-2 rounded-lg text-emerald-200 font-mono text-sm">{newKey}</code>
               <button onClick={() => { navigator.clipboard.writeText(newKey); setNewKey(null); }} className="text-xs font-bold text-white underline">Copy & Close</button>
            </div>
            <p className="text-[10px] text-emerald-500/60">This key will not be shown again.</p>
         </div>
       )}
       
       <div className="glass-panel p-8 rounded-[32px] border border-white/5 space-y-6">
          <div className="flex gap-4">
             <input 
               value={note}
               onChange={e => setNote(e.target.value)}
               placeholder="Key description (e.g. Mobile App v4)"
               className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:border-cyan-500 outline-none"
             />
             <button onClick={handleGenerate} className="px-6 bg-cyan-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-cyan-500">Generate Key</button>
          </div>

          <div className="space-y-4">
             {keys.map((k) => (
                <div key={k.id} className="flex items-center justify-between p-4 bg-white/5 rounded-xl border border-white/5">
                   <div className="space-y-1">
                      <p className="text-sm font-bold text-white">{k.note}</p>
                       <p className="text-[10px] font-mono text-slate-500">SHA256: {(k.hashPrefix || k.hash || '').substring(0, 12)}...</p>
                   </div>
                   <div className="flex items-center gap-3">
                      <span className={`px-2 py-1 rounded text-[9px] font-black uppercase ${k.enabled ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
                         {k.enabled ? 'Active' : 'Disabled'}
                      </span>
                   </div>
                </div>
             ))}
          </div>
       </div>
    </div>
  );
}
