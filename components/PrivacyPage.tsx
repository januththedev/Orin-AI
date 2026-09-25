
import React from 'react';
import { Language } from '../types';

const PRIVACY_CONTENT: Record<Language, { title: string; version: string; sections: { head: string; body: string }[]; footer: string }> = {
  en: {
    title: "Privacy Policy",
    version: "Simplified View v4.9",
    sections: [
      { head: "01. Account and conversation data", body: "When you sign in, Orin stores your account, private conversation history, settings, usage records, and deletion tombstones so the service can sync your work. Chat content is not placed in shared operational logs." },
      { head: "02. AI, search, and media providers", body: "Prompts and selected search context may be sent through Orin Router, Orin Tools, model, image, and speech providers. Provider policies are versioned and disclosed in the product. Private content is sent only after the required consent. Retrieved web text is untrusted evidence, never an instruction." },
      { head: "03. Secure sessions", body: "Browser sessions use server-side, revocable HttpOnly cookies and CSRF protection. Long-lived bearer tokens are not stored in browser local storage." },
      { head: "04. Essential browser storage", body: "Orin stores preferences, bounded conversation cache data, and secure session cookies. It does not use the session credential for advertising or cross-site tracking." },
      { head: "05. Delete your data", body: "You can remove a conversation or close your account. Connected clients purge cached data on the next sync, while server-side records and media are deleted through a retryable removal process." },
      { head: "06. Voice Data Privacy", body: "When you use Voice Mode, audio is converted to text in real-time. We never store or listen to your audio recordings." },
      { head: "07. Safety Standards", body: "We follow global safety standards to ensure Orin is safe for daily professional and personal use." },
      { head: "08. Refund & Return Policy", body: "Since Orin Chat provides instant access to digital neural services, payments are generally non-refundable once the service is utilized. However, if a technical failure prevents service delivery, please contact support within 7 days for a full refund resolution. You may cancel subscriptions at any time to prevent future billing charges." }
    ],
    footer: "JN Productions Global Privacy Statement"
  },
  si: {
    title: "පෞද්ගලිකත්ව ආරක්ෂාව",
    version: "සරල දසුන v4.9",
    sections: [
      { head: "01. ගිණුම් සහ සංවාද දත්ත", body: "ඔබ පිවිසින විට ඔරින් ගිණුම, පුද්ගලික සංවාද ඉතිහාසය, සැකසුම්, භාවිත ගණන සහ මකීමේ සලකුණු ගබඩා කරයි. කතාබහ අන්තර්ජාල ලොගවල නොපෙනේ." },
      { head: "02. AI, සෙවීම සහ මීඩිය සපයන්", body: "ඔබගේ ප්‍රශ්න සහ තෝරාගත් සෙවීම තොරතුරු ඔරින් රවුටර්, මෙවලත්, AI, රූප සහ ශබ්ධ ප්‍රතිචාර සපෝරා යවිය හැක. අවශ්‍ය පෞද්ගලික දත්ත යැමීමට පෙර ඔබගේ මුල්බිරිය අවශ්‍ය වේ." },
      { head: "03. ආරක්ෂිත සැසිසුම්", body: "බ්‍රවුසර සැසිසුම් සේවීම් පැති HttpOnly කුකීස්, CSRF ආරක්ෂාව සහ සේවීම් පැති අවලංගු කිරීම භාවිත කරයි." },
      { head: "04. අවශ්‍ය බ්‍රවුසර ගබඩාව", body: "ඔරින් ඔබේ අත්පැලිතුම්, සීමිත සංවාද කැචිච දත්ත සහ ආරක්ෂිත සැසිසුම් කුකීස් ගබඩා කරයි." },
      { head: "05. දත්ත මකීම", body: "ඔබට සංවාදයක් ඉවත් කළ හෝ ගිණුම වසා කළ හැක. සම්බන්ධ සේවීම් ඊළඟ සන්ධියේ දී ගොනු මකීමට පසු සේවීම් පැති දත්ත සහ මීඩිය නැවත උත්සාහ කිරීමෙන් මකනු ලැබේ." },
      { head: "06. හඬ විධාන", body: "ඔබ කතා කරන විට එම හඬ කෙලින්ම අකුරු බවට පත් කරන අතර, හඬ පටිගත කිරීම් කොහේවත් ගබඩා නොවේ." },
      { head: "07. මුදල් ආපසු ගෙවීමේ ප්‍රතිපත්තිය (Return Policy)", body: "මෙය ඩිජිටල් සේවාවක් බැවින්, සේවාව භාවිතා කිරීමෙන් පසු මුදල් ආපසු ගෙවීමක් (Refund) සිදු නොකෙරේ. නමුත් තාක්ෂණික දෝෂයක් නිසා සේවාව ලබා ගැනීමට නොහැකි වූ අවස්ථාවක දින 7ක් ඇතුලත අපව අමතන්න. දායකත්ව (Subscriptions) ඕනෑම වෙලාවක අවලංගු කළ හැකි අතර, එවිට ඊළඟ වාරිකය අය නොකෙරේ." }
    ],
    footer: "JN Productions Global ආරක්ෂණ ප්‍රතිපත්තිය"
  },
  ta: {
    title: "தனியுரிமைக் கொள்கை",
    version: "எளிய பார்வை v4.9",
    sections: [
      { head: "01. கணக்கு மற்றும் உரையாடல் தரவு", body: "நீங்கள் உள்நுழியும்போது ஓரின் உங்கள் கணக்கு, தனியான உரையாடல் வரலாறு, அமைப்புகள், பயன்பாட்டுக் கணக்கீடுகள் மற்றும் நீக்கல் குறியீடுகளைச் சேமிக்கிறது. உரையாடல் உள்ளடக்கம் பகிர்வு செயல்பாட்டுப் பதிவுகளில் இடம்பெறாது." },
      { head: "02. AI, தேடல் மற்றும் ஊடகம்", body: "உங்கள் கேள்விகள் மற்றும் தேர்ந்தெடுக்கப்பட்ட தேடல் சூழல் ஓரின் ரூட்டர், டூல்ஸ், AI, படம் மற்றும் குரல் வழங்கிகளுக்கு அனுப்பப்படலாம். தேவையான தனியுரிமை ஒப்புதலுக்குப் பின் தனியான உள்ளடகம் மட்டுமே அனுப்பப்படும்." },
      { head: "03. பாதுகாப்பான அமர்வுகள்", body: "உலாவி அமர்வுகள் சர்வர் பக்கத்தில் உள்ள HttpOnly குக்கீகள், CSRF பாதுகாப்பு மற்றும் ரத்துசெய்யக்கூடிய அமர்வுகளைப் பயன்படுத்துகின்றன." },
      { head: "04. அவசியமான உலாவி சேமிப்பு", body: "ஓரின் விருப்பங்கள், bounded உரையாடல் cache தரவு மற்றும் பாதுகாப்பான அமர்வு குக்கீகளைச் சேமிக்கிறது." },
      { head: "05. தரவை நீக்குதல்", body: "உரையாடலை அல்லது கணக்கை நீக்கலாம். இணக்கிய கிளைட்டுகள் அடுத்த sync இல் cache-ஐ அழிக்கும்; சர்வர் தரவு மற்றும் ஊடகம் retry செய்யக்கூடிய அழிப்பு செயல்முறையின் மூலம் நீக்கப்படும்." },
      { head: "06. குரல் தரவு தனியுரிமை", body: "குரல் முறையை பயன்படுத்தும்போது, ஆடியோ நேரடியாக உரையாக மாற்றப்படுகிறது. உங்கள் ஆடியோ பதிவுகளை நாங்கள் சேமிக்கவோ கேட்கவோ செய்ய மாட்டோம்." },
      { head: "07. பாதுகாப்பு தரநிலைகள்", body: "தினசரி தொழில்முறை மற்றும் தனிப்பட்ட பயன்பாட்டிற்கு ஓரின் பாதுகாப்பானது என்பதை உறுதிசெய்ய உலகளாவிய பாதுகாப்பு தரநிலைகளை பின்பற்றுகிறோம்." },
      { head: "08. பணத்திரும்பம் மற்றும் திருப்ப policy", body: "ஓரின் AI டிஜிட்டல் நரம்பு சேவைகளுக்கு உடனடி அணுகலை வழங்குவதால், சேவை பயன்படுத்தப்பட்ட பிறகு பணம் பொதுவாக திருப்பிச் செலுத்தப்படாது. இருப்பினும், தொழில்நுட்ப தோல்வி சேவை வழங்கலை தடுத்தால், முழு பணத்திரும்ப தீர்வுக்கு 7 நாட்களுக்குள் ஆதரவைத் தொடர்பு கொள்ளவும். எதிர்கால பில்லிங் கட்டணங்களை தடுக்க எந்த நேரத்திலும் சந்தாக்களை ரத்து செய்யலாம்." }
    ],
    footer: "JN Productions Global தனியுரிமை அறிக்கை"
  }
};

const PrivacyPage: React.FC<{ onClose: () => void; lang: Language }> = ({ onClose, lang }) => {
  const content = PRIVACY_CONTENT[lang];
  const fontClass = lang === 'si' ? 'sinhala-text' : lang === 'ta' ? 'tamil-text' : '';

  return (
    <div className="h-full w-full overflow-y-auto custom-scrollbar bg-slate-50 dark:bg-slate-950 animate-reveal">
      <div className="max-w-4xl mx-auto space-y-12 pb-32 px-6 pt-12 text-slate-900 dark:text-slate-100">
        <header className="flex items-center justify-between border-b border-black/5 dark:border-white/5 pb-8">
          <div className="space-y-1">
            <h2 className="text-3xl font-black text-slate-900 dark:text-white tracking-tighter uppercase">{content.title}</h2>
            <p className="text-[10px] font-black text-cyan-600 dark:text-cyan-400 uppercase tracking-[0.4em]">{content.version}</p>
          </div>
          <button 
            onClick={onClose} 
            className="w-10 h-10 rounded-xl glass-panel flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-white transition-all shadow-sm"
          >
            <i className="fa-solid fa-xmark"></i>
          </button>
        </header>

        <div className="space-y-10 text-slate-600 dark:text-slate-400 font-medium leading-relaxed">
          {content.sections.map((s, i) => (
            <section key={i} className="space-y-3 animate-reveal" style={{ animationDelay: `${i * 0.05}s` }}>
              <h3 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight">{s.head}</h3>
              <p className={fontClass}>{s.body}</p>
            </section>
          ))}

          <footer className="pt-16 border-t border-black/5 dark:border-white/5 text-center space-y-4 opacity-40">
             <p className="text-[10px] font-black uppercase tracking-[0.5em] text-slate-500">{content.footer}</p>
          </footer>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPage;
