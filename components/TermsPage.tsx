
import React from 'react';
import { Language } from '../types';
import { translations } from '../translations';

const TERMS_CONTENT: Record<Language, { title: string; version: string; sections: { head: string; body: string }[]; footer: string }> = {
  en: {
    title: "Terms of Service",
    version: "Simplified View v4.8",
    sections: [
      { head: "01. Agreement", body: "By using Orin Chat, you agree to these simple rules designed to keep the platform safe and functional for everyone." },
      { head: "02. Fair Use", body: "Use this workspace for research, creativity, and professional work. Do not use it to generate spam, illegal content, or anything that harms others." },
      { head: "03. AI Accuracy Warning", body: "AI can make mistakes. Always double-check important facts, especially for medical, legal, or financial decisions." },
      { head: "04. You Own Your Creations", body: "The text and images you create here belong to you. You are free to use them for your personal or commercial projects without extra fees." },
      { head: "05. Our Liability", body: "We try our best to keep Orin running perfectly, but we aren't responsible if the service goes down or makes a calculation error." },
      { head: "06. Account Security", body: "Keep your login details safe. If you bring your own API keys, you are responsible for their usage and security." },
      { head: "07. Legal Disputes", body: "These terms are governed by the laws of Sri Lanka. Any disputes shall be handled within the jurisdiction of Sri Lankan courts." }
    ],
    footer: "JN Productions Global Terms Protocol"
  },
  si: {
    title: "භාවිත කොන්දේසි",
    version: "සරල දසුන v4.8",
    sections: [
      { head: "01. එකඟතාවය", body: "ඔරින් AI භාවිතා කිරීමෙන් ඔබ මෙම මූලික නීති වලට එකඟ වේ. මෙම කොන්දේසි කාලයෙන් කාලයට යාවත්කාලීන විය හැක." },
      { head: "02. නිවැරදි භාවිතය", body: "මෙම පද්ධතිය අධ්‍යාපනික සහ නිර්මාණාත්මක වැඩ සඳහා පමණක් භාවිතා කරන්න. නීති විරෝධී හෝ අන් අයට හානිකර දේ නිර්මාණය කිරීම තහනම්ය." },
      { head: "03. AI පිළිතුරු ගැන", body: "කෘතිම බුද්ධිය සමහර විට වැරදි පිළිතුරු දිය හැක (Hallucinations). වැදගත් තීරණ ගැනීමට පෙර තොරතුරු නැවත පරීක්ෂා කරගන්න." },
      { head: "04. නිර්මාණ වල අයිතිය", body: "ඔබ ඔරින් සමඟ නිර්මාණය කරන සියලුම පින්තූර සහ ලිපි වල අයිතිය ඔබ සතුය. ඔබට ඒවා ඕනෑම වැඩකට භාවිතා කළ හැක." },
      { head: "05. වගකීම", body: "තාක්ෂණික දෝෂ නිසා සිදුවන යම් අලාභයක් සඳහා අපට වගකීමක් දැරිය නොහැක. අපි සේවාව ලබා දෙන්නේ 'පවතින පරිදි' (As-is) ය." },
      { head: "06. නීතිය", body: "මෙම කොන්දේසි ශ්‍රී ලංකාවේ නීතියට යටත් වේ. යම් ගැටලුවක් මතු වුවහොත් එය ශ්‍රී ලංකා අධිකරණ බල සීමාව යටතේ විසඳා ගත යුතුය." }
    ],
    footer: "JN Productions Global සේවා ගිවිසුම"
  },
  ta: {
    title: "சேவை விதிமுறைகள்",
    version: "எளிய பார்வை v4.8",
    sections: [
      { head: "01. ஒப்புதல்", body: "ஓரின் AI ஐப் பயன்படுத்துவதன் மூலம் அனைவருக்கும் தளம் பாதுகாப்பானதாகவும் செயல்பாட்டிலும் இருக்க எளிய விதிகளுக்கு நீங்கள் ஒப்புக்கொள்கிறீர்கள்." },
      { head: "02. நியாயமான பயன்பாடு", body: "ஆராய்ச்சி, படைப்பாற்றல் மற்றும் தொழில்முறை பணிக்கு இந்த பணியிடத்தைப் பயன்படுத்துங்கள். ஸ்பேம், சட்டவிரோத உள்ளடக்கம் அல்லது மற்றவர்களுக்கு தீங்கு விளைவிக்கும் எதையும் உருவாக்க பயன்படுத்த வேண்டாம்." },
      { head: "03. AI துல்லியம் எச்சரிக்கை", body: "AI தவறுகள் செய்யலாம். மருத்துவம், சட்டம் அல்லது நிதி முடிவுகளுக்கு முக்கியமான உண்மைகளை எப்போதும் இருமுறை சரிபார்க்கவும்." },
      { head: "04. உங்கள் படைப்புகள் உங்களுடையவை", body: "நீங்கள் இங்கே உருவாக்கும் உரை மற்றும் படங்கள் உங்களுக்கு சொந்தம். கூடுதல் கட்டணம் இல்லாமல் தனிப்பட்ட அல்லது வணிக திட்டங்களுக்கு பயன்படுத்த உங்களுக்கு சுதந்திரம் உண்டு." },
      { head: "05. எங்கள் பொறுப்பு", body: "ஓரின் சரியாக இயங்க நாங்கள் முயற்சிக்கிறோம், ஆனால் சேவை நிறுத்தப்பட்டால் அல்லது கணக்கீட்டு பிழை ஏற்பட்டால் நாங்கள் பொறுப்பல்ல." },
      { head: "06. கணக்கு பாதுகாப்பு", body: "உங்கள் உள்நுழைவு விவரங்களை பாதுகாப்பாக வைத்திருங்கள். உங்கள் சொந்த API விசைகளை கொண்டு வந்தால், அவற்றின் பயன்பாடு மற்றும் பாதுகாப்புக்கு நீங்கள் பொறுப்பு." },
      { head: "07. சட்ட வழக்குகள்", body: "இந்த விதிமுறைகள் இலங்கை சட்டங்களால் நிர்வகிக்கப்படுகின்றன. எந்த தகராறுகளும் இலங்கை நீதிமன்றங்களின் அதிகார எல்லைக்குள் கையாளப்பட வேண்டும்." }
    ],
    footer: "JN Productions Global சேவை ஒப்பந்தம்"
  }
};

const TermsPage: React.FC<{ onClose: () => void; lang: Language }> = ({ onClose, lang }) => {
  const content = TERMS_CONTENT[lang];
  const t = translations[lang];
  const fontClass = lang === 'si' ? 'sinhala-text' : lang === 'ta' ? 'tamil-text' : '';

  return (
    <div className="h-full w-full overflow-y-auto custom-scrollbar bg-slate-50 dark:bg-slate-950 animate-reveal">
      <div className="max-w-4xl mx-auto space-y-12 pb-32 px-6 pt-12 text-slate-900 dark:text-slate-100">
        <header className="flex items-center justify-between border-b border-black/5 dark:border-white/5 pb-8">
          <div className="flex items-center gap-4">
             <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-white/5 flex items-center justify-center text-slate-400">
                <i className="fa-solid fa-file-contract text-xl"></i>
             </div>
             <div>
               <h2 className="text-3xl font-black text-slate-900 dark:text-white tracking-tighter uppercase">{content.title}</h2>
               <p className="text-[10px] font-black text-cyan-600 dark:text-cyan-400 uppercase tracking-[0.4em] opacity-60">{content.version}</p>
             </div>
          </div>
          <button 
            onClick={onClose} 
            className="w-10 h-10 rounded-xl glass-panel flex items-center justify-center text-slate-500 hover:text-red-500 hover:rotate-90 transition-all shadow-sm"
          >
            <i className="fa-solid fa-xmark"></i>
          </button>
        </header>

        <div className="space-y-12">
          {content.sections.map((s, i) => (
            <section key={i} className="animate-reveal space-y-4" style={{ animationDelay: `${i * 0.05}s` }}>
              <div className="flex items-center gap-3">
                 <div className="w-1.5 h-6 bg-cyan-600 rounded-full"></div>
                 <h3 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight">{s.head}</h3>
              </div>
              <p className={`text-slate-600 dark:text-slate-400 font-medium leading-relaxed indent-4 ${fontClass}`}>{s.body}</p>
            </section>
          ))}

          <footer className="pt-16 border-t border-black/5 dark:border-white/5 text-center space-y-4 opacity-40">
            <div className="w-12 h-1 bg-slate-200 dark:bg-slate-800 mx-auto rounded-full mb-4"></div>
            <p className="text-[10px] font-black uppercase tracking-[0.4em]">{content.footer}</p>
            <p className="text-[8px] font-bold uppercase tracking-widest text-slate-400">{t.lastUpdatedFeb2026}</p>
          </footer>
        </div>
      </div>
    </div>
  );
};

export default TermsPage;
