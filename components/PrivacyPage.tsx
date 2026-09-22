
import React from 'react';
import { Language } from '../types';

const PRIVACY_CONTENT: Record<Language, { title: string; version: string; sections: { head: string; body: string }[]; footer: string }> = {
  en: {
    title: "Privacy Policy",
    version: "Simplified View v4.9",
    sections: [
      { head: "01. Your Data Stays on Your Device", body: "We built Orin Chat with a 'Local-First' approach. Your chat history lives in your browser, not on our servers. Unless you explicitly sync, you are the only one holding your data." },
      { head: "02. How We Use AI Models", body: "We use Google's Gemini to power the intelligence. Your prompts are sent securely for processing and then immediately forgotten. We do not use your data to train AI models." },
      { head: "03. Secure Connection", body: "Everything sent between you and Orin is encrypted. No one can intercept your creative or professional work." },
      { head: "04. No Tracking Cookies", body: "We don't track you across the internet. We only use tiny storage bits to remember your dark mode setting and language preference." },
      { head: "05. Delete Your Data Anytime", body: "Want a fresh start? Just log out or clear your browser cache. Since we don't store your history, this permanently wipes everything instantly." },
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
      { head: "01. ඔබේ දත්ත, ඔබේ උපාංගයේ", body: "ඔරින් AI නිර්මාණය කර ඇත්තේ ඔබේ පෞද්ගලිකත්වය මුල් කරගෙනය. ඔබේ සංවාද අපගේ සර්වර් වල ගබඩා නොවේ. සියල්ල ඔබේ පරිගණකයේ හෝ දුරකථනයේ සුරක්ෂිතව පවතී." },
      { head: "02. AI භාවිතය", body: "අපි Google Gemini තාක්ෂණය භාවිතා කරමු. ඔබේ ප්‍රශ්න සැකසීමට පමණක් එම පද්ධති වෙත යවන අතර, එම දත්ත AI පුහුණු කිරීම සඳහා (Training) භාවිතා නොකරයි." },
      { head: "03. ආරක්ෂිත සම්බන්ධතාවය", body: "ඔබ සහ ඔරින් අතර සිදුවන සියලුම සම්බන්ධතා අන්තර්ජාල ආරක්ෂණ ක්‍රම (Encryption) මගින් සුරක්ෂිත කර ඇත." },
      { head: "04. අනවශ්‍ය කුකීස් නැත", body: "අපි ඔබව ලුහුබැඳීමට කුකීස් භාවිතා නොකරමු. ඔබේ භාෂාව සහ තේමාව මතක තබා ගැනීමට පමණක් කුඩා දත්ත ගොනු භාවිතා වේ." },
      { head: "05. දත්ත මකා දැමීම", body: "ඔබට ඕනෑම වෙලාවක 'Logout' වී හෝ බ්‍රවුසර දත්ත මැකීමෙන් සියල්ල ඉවත් කළ හැක. අප ළඟ ඔබේ කිසිදු පිටපතක් නැත." },
      { head: "06. හඬ විධාන", body: "ඔබ කතා කරන විට එම හඬ කෙලින්ම අකුරු බවට පත් කරන අතර, හඬ පටිගත කිරීම් කොහේවත් ගබඩා නොවේ." },
      { head: "07. මුදල් ආපසු ගෙවීමේ ප්‍රතිපත්තිය (Return Policy)", body: "මෙය ඩිජිටල් සේවාවක් බැවින්, සේවාව භාවිතා කිරීමෙන් පසු මුදල් ආපසු ගෙවීමක් (Refund) සිදු නොකෙරේ. නමුත් තාක්ෂණික දෝෂයක් නිසා සේවාව ලබා ගැනීමට නොහැකි වූ අවස්ථාවක දින 7ක් ඇතුලත අපව අමතන්න. දායකත්ව (Subscriptions) ඕනෑම වෙලාවක අවලංගු කළ හැකි අතර, එවිට ඊළඟ වාරිකය අය නොකෙරේ." }
    ],
    footer: "JN Productions Global ආරක්ෂණ ප්‍රතිපත්තිය"
  },
  ta: {
    title: "தனியுரிமைக் கொள்கை",
    version: "எளிய பார்வை v4.9",
    sections: [
      { head: "01. உங்கள் தரவு உங்கள் சாதனத்தில் இருக்கும்", body: "ஓரின் AI ஐ 'உள்ளூர்-முதல்' அணுகுமுறையுடன் கட்டமைத்தோம். உங்கள் அரட்டை வரலாறு எங்கள் சர்வர்களில் இல்லை, உங்கள் உலாவியில் உள்ளது. நீங்கள் வெளிப்படையாக ஒத்திசைக்காத வரை, உங்கள் தரவை வைத்திருப்பவர் நீங்கள் மட்டுமே." },
      { head: "02. AI மாதிரிகளை எவ்வாறு பயன்படுத்துகிறோம்", body: "நுண்ணறிவுக்கு Google இன் Gemini ஐ பயன்படுத்துகிறோம். உங்கள் கோரிக்கைகள் பாதுகாப்பாக செயலாக்கத்திற்கு அனுப்பப்பட்டு உடனடியாக மறக்கப்படுகின்றன. AI மாதிரிகளை பயிற்சி செய்ய உங்கள் தரவை பயன்படுத்துவதில்லை." },
      { head: "03. பாதுகாப்பான இணைப்பு", body: "உங்களுக்கும் ஓரினுக்கும் இடையில் அனுப்பப்படும் அனைத்தும் மறைகுறியாக்கப்பட்டுள்ளது. உங்கள் படைப்பு அல்லது தொழில்முறை பணியை யாரும் தடுக்க முடியாது." },
      { head: "04. கண்காணிப்பு குக்கீகள் இல்லை", body: "இணையம் முழுவதும் உங்களை கண்காணிக்கவில்லை. உங்கள் இருண்ட முறை மற்றும் மொழி விருப்பத்தை நினைவில் வைக்க சிறிய சேமிப்பு பிட்கள் மட்டுமே பயன்படுத்தப்படுகின்றன." },
      { head: "05. எந்த நேரத்திலும் உங்கள் தரவை நீக்குங்கள்", body: "புதிய தொடக்கம் விரும்புகிறீர்களா? வெளியேறு அல்லது உங்கள் உலாவி கேச் அழிக்கவும். எங்கள் வரலாற்றை சேமிக்காததால், இது உடனடியாக அனைத்தையும் நிரந்தரமாக அழிக்கிறது." },
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
