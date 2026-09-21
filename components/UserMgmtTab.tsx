
import React from 'react';
import { SignupRequest, UserRole } from '../types';
import { sessionService } from '../services/sessionService';

interface UserMgmtTabProps {
  requests: SignupRequest[];
  onRefresh: () => void;
}

export default function UserMgmtTab({ requests, onRefresh }: UserMgmtTabProps) {
  
  const handleAction = async (uid: string, role: UserRole) => {
    if (!confirm(`Approve user as ${role}?`)) return;
    try {
      await sessionService.approveUser(uid, role);
      alert("User Approved.");
      onRefresh();
    } catch (e: any) {
      alert("Error: " + e.message);
    }
  };

  return (
    <div className="space-y-8 animate-reveal">
       <div className="flex justify-between items-center">
          <h3 className="text-2xl font-black uppercase tracking-tighter">Access Control</h3>
          <button onClick={onRefresh} className="px-4 py-2 bg-white/5 rounded-lg text-[9px] font-black uppercase"><i className="fa-solid fa-rotate mr-2"></i> Refresh</button>
       </div>
       
       <div className="space-y-4">
          {requests.length === 0 ? (
             <div className="py-20 text-center opacity-30 uppercase text-[10px] font-black tracking-widest">All caught up</div>
          ) : (
             requests.map(req => (
                <div key={req.id} className={`glass-panel p-6 rounded-3xl border ${req.codeDetected ? 'border-cyan-500/30 bg-cyan-500/5' : 'border-white/5'} flex flex-col md:flex-row items-center justify-between gap-6`}>
                   <div className="space-y-2">
                      <div className="flex items-center gap-3">
                         <span className="text-sm font-black">{req.email}</span>
                         {req.codeDetected && <span className="px-2 py-0.5 bg-cyan-600 text-[8px] font-black uppercase rounded">Secret Code</span>}
                      </div>
                      <p className="text-xs text-slate-400 italic">"{req.reason}"</p>
                      <p className="text-[9px] font-black text-slate-600 uppercase">Requested: {new Date(req.createdAt).toLocaleString()}</p>
                   </div>
                   <div className="flex gap-2">
                      <button onClick={() => handleAction(req.id, 'training')} className="px-4 py-2 bg-white text-black rounded-xl text-[9px] font-black uppercase tracking-widest hover:scale-105 transition-all">Training</button>
                      <button onClick={() => handleAction(req.id, 'devops')} className="px-4 py-2 bg-cyan-600 text-white rounded-xl text-[9px] font-black uppercase tracking-widest hover:scale-105 transition-all">DevOps</button>
                      <button className="px-4 py-2 bg-red-500/10 text-red-500 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-red-500 hover:text-white transition-all">Reject</button>
                   </div>
                </div>
             ))
          )}
       </div>
    </div>
  );
}
