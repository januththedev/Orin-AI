
import React, { useState } from 'react';
import { sessionService } from '../services/sessionService';

export default function TrainingTab() {
  const [imageUrl, setImageUrl] = useState('');
  const [ocrResult, setOcrResult] = useState<{ rawText: string; blocks: any[] } | null>(null);
  const [processing, setProcessing] = useState(false);
  const [lang, setLang] = useState<'en' | 'si'>('en');

  const runOCR = async () => {
    if (!imageUrl.trim()) return;
    setProcessing(true);
    try {
      const result = await sessionService.processOCR(imageUrl, lang);
      setOcrResult(result);
    } catch (err: any) {
      alert("OCR Processing Failed: " + err.message);
    }
    setProcessing(false);
  };

  return (
    <div className="space-y-8 animate-reveal">
      <div className="flex justify-between items-center">
         <h3 className="text-2xl font-black uppercase tracking-tighter">Exam Training Data</h3>
         <div className="flex gap-2">
            <select value={lang} onChange={e => setLang(e.target.value as any)} className="bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-xs font-bold uppercase">
               <option value="en">English (Tesseract)</option>
               <option value="si">Sinhala (Tesseract)</option>
            </select>
         </div>
      </div>

      <div className="glass-panel p-8 rounded-[32px] border border-white/5 space-y-6">
         <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Source Image URL</label>
            <div className="flex gap-3">
               <input 
                  type="text" 
                  value={imageUrl} 
                  onChange={e => setImageUrl(e.target.value)} 
                  placeholder="https://storage.googleapis.com/..." 
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:border-cyan-500 outline-none"
               />
               <button 
                  onClick={runOCR} 
                  disabled={processing}
                  className="px-6 bg-cyan-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-cyan-500 disabled:opacity-50"
               >
                  {processing ? "Scanning..." : "Process OCR"}
               </button>
            </div>
         </div>

         {ocrResult && (
            <div className="grid grid-cols-2 gap-6 pt-4 border-t border-white/5">
               <div className="space-y-2">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-emerald-500">Raw Extraction</h4>
                  <pre className="p-4 bg-black/30 rounded-xl text-xs font-mono text-slate-300 h-64 overflow-y-auto whitespace-pre-wrap border border-white/5">
                     {ocrResult.rawText}
                  </pre>
               </div>
               <div className="space-y-2">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-violet-500">Structured Blocks</h4>
                  <div className="h-64 overflow-y-auto space-y-2 pr-2">
                     {ocrResult.blocks.map((b, i) => (
                        <div key={i} className="p-3 bg-white/5 rounded-lg border border-white/5 hover:border-violet-500/30 transition-colors">
                           <div className="flex justify-between mb-1">
                              <span className="text-[9px] font-bold text-slate-500">ID: {b.id}</span>
                              <span className="text-[9px] font-bold text-emerald-500">{(b.prob * 100).toFixed(0)}%</span>
                           </div>
                           <p className="text-xs text-slate-300">{b.text}</p>
                        </div>
                     ))}
                  </div>
               </div>
            </div>
         )}
      </div>
    </div>
  );
}
