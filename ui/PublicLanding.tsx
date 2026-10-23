import React, { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  ArrowUp,
  Plus,
  ArrowRight,
  Check,
  BookOpen,
  Brain,
  MessageSquare,
  Menu,
  X,
  Sparkles,
  Pencil,
  ChevronRight,
  PanelLeft,
} from "lucide-react";
import "./landing.css";

interface Props {
  onStart: (prompt?: string) => void;
  onSignIn: () => void;
}
function OrinLogo({ className = "" }: { className?: string }) {
  return <img className={`lp-brand-logo ${className}`} src="/favicon.svg" alt="" aria-hidden="true" />;
}

const examples = [
  {
    label: "Make a plan",
    icon: Brain,
    prompt: "I have an idea. Where do I even start?",
    title: "Let’s give it a little shape.",
    intro:
      "You don’t need the whole picture yet. A good starting point is enough.",
    steps: [
      "What do you want to make?",
      "Who would it make life better for?",
      "What’s one small thing we can try?",
    ],
    followup:
      "Help me turn an idea into a practical first plan. Ask me what I want to make.",
  },
  {
    label: "Find the words",
    icon: Pencil,
    prompt: "Help me say this in a way that feels like me.",
    title: "Your voice. A clearer version.",
    intro:
      "Let’s make the message sound natural, thoughtful, and unmistakably yours.",
    steps: [
      "Tell me who you’re writing to.",
      "Share the idea, even if it’s a little messy.",
      "We’ll find the right words together.",
    ],
    followup:
      "Help me write something that sounds natural and like me. Ask me who it is for and what I want to say.",
  },
  {
    label: "Understand more",
    icon: BookOpen,
    prompt: "Can you make a complicated idea feel simple?",
    title: "Of course. Let’s untangle it.",
    intro:
      "We can start with the big picture, add a familiar example, then go a little deeper.",
    steps: [
      "Start with what you already know.",
      "Connect it to an everyday example.",
      "Ask the next question that comes to mind.",
    ],
    followup:
      "Explain a complicated concept in a simple way. First ask me which topic I want to understand.",
  },
];
const faqs = [
  {
    q: "What can I do with Orin?",
    a: "Explore an idea, work through a question, write something, or get help with code. Start with a rough thought and keep the conversation going until it becomes useful.",
  },
  {
    q: "Can I use my own language?",
    a: "Yes. You can ask and receive answers in English, Sinhala, and Tamil. Orin can match the language of your message, or you can choose a response language in your settings.",
  },
  {
    q: "Will my conversations be saved?",
    a: "When you sign in, your conversations are saved to your account. You can search your history and return to the conversation on another device.",
  },
  {
    q: "What does Thinking do?",
    a: "Thinking selects a model configured for deeper reasoning and gives it more room to work. Leave it off for everyday questions, or turn it on when you want to work through something more involved.",
  },
  {
    q: "Can I check the sources?",
    a: "When relevant published knowledge is available, Orin can include references. Open a source to see the passage behind the answer. AI can still make mistakes, so check important information.",
  },
];

export default function PublicLanding({ onStart, onSignIn }: Props) {
  const [selected, setSelected] = useState(0),
    [openFaq, setOpenFaq] = useState<number | null>(0),
    [menu, setMenu] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const example = examples[selected];
  useEffect(() => {
    const root = scroll.current;
    if (
      !root ||
      matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !("IntersectionObserver" in window)
    )
      return;
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.setAttribute("data-visible", "true");
            observer.unobserve(entry.target);
          }
        }),
      { root, threshold: 0.12 },
    );
    root.querySelectorAll(".lp-reveal").forEach((element) => {
      element.setAttribute("data-visible", "false");
      observer.observe(element);
    });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const go = (id: string) => {
    setMenu(false);
    document.getElementById(id)?.scrollIntoView({
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "start",
    });
  };
  return (
    <div className="orin-landing" ref={scroll}>
      <a
        className="lp-skip"
        href="#lp-main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("lp-main")?.focus();
        }}
      >
        Skip to content
      </a>
      <header className="lp-header">
        <a
          className="lp-wordmark"
          href="#home"
          aria-label="Orin home"
          onClick={(event) => {
            event.preventDefault();
            scroll.current?.scrollTo({ top: 0, behavior: "smooth" });
          }}
        >
          <OrinLogo />
          <span>
            orin<span className="lp-logo-dot">.</span>
          </span>
        </a>
        <nav className="lp-desktop-nav" aria-label="Main navigation">
          <button onClick={() => go("lp-experience")}>The experience</button>
          <button onClick={() => go("lp-features")}>A little more Orin</button>
          <button onClick={() => go("lp-questions")}>Good questions</button>
        </nav>
        <div className="lp-header-actions">
          <button className="lp-signin" onClick={onSignIn}>
            Sign in
          </button>
          <button
            className="lp-button lp-dark lp-header-cta"
            onClick={() => onStart()}
          >
            Meet your thinking space
            <ArrowUpRight size={15} />
          </button>
          <button
            className="lp-menu-button"
            aria-label={menu ? "Close menu" : "Open menu"}
            aria-expanded={menu}
            aria-controls="lp-mobile-nav"
            onClick={() => setMenu((value) => !value)}
          >
            {menu ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </header>
      {menu && (
        <nav
          className="lp-mobile-nav"
          id="lp-mobile-nav"
          aria-label="Mobile navigation"
        >
          <button onClick={() => go("lp-experience")}>
            The experience
            <ArrowUpRight size={16} />
          </button>
          <button onClick={() => go("lp-features")}>
            A little more Orin
            <ArrowUpRight size={16} />
          </button>
          <button onClick={() => go("lp-questions")}>
            Good questions
            <ArrowUpRight size={16} />
          </button>
          <button
            onClick={() => {
              setMenu(false);
              onSignIn();
            }}
          >
            Sign in
            <ArrowUpRight size={16} />
          </button>
        </nav>
      )}
      <main id="lp-main" tabIndex={-1}>
        <section className="lp-hero lp-container">
          <div className="lp-hero-copy">
            <div className="lp-eyebrow">
              <span className="lp-status-dot" />
              YOUR IDEAS, IN GOOD COMPANY
            </div>
            <h1>
              A little clarity.
              <br />A lot more
              <br />
              <em>possible.</em>
              <span className="lp-heading-flower">
                <OrinLogo />
              </span>
            </h1>
            <p>
              A question. A half-formed thought. That thing
              <br className="lp-desktop-break" /> you can’t quite put into
              words.
              <br />
              <strong>There’s a place for it here.</strong>
            </p>
            <div className="lp-hero-actions">
              <button
                className="lp-button lp-dark lp-main-cta"
                onClick={() => onStart()}
              >
                Find your starting point
                <ArrowUpRight size={18} />
              </button>
              <button
                className="lp-watch-link"
                onClick={() => go("lp-experience")}
              >
                Take a little look
                <span>
                  <ArrowRight size={15} />
                </span>
              </button>
            </div>
            <div className="lp-language-note">
              <span>Made for the way you think.</span>
              <span className="lp-small-dot" />
              EN<span className="lp-language-divider">/</span>
              <span lang="si">සිංහල</span>
              <span className="lp-language-divider">/</span>
              <span lang="ta">தமிழ்</span>
            </div>
          </div>
          <div
            className="lp-hero-visual"
            aria-label="An example of an Orin conversation"
          >
            <div className="lp-orbit" aria-hidden="true">
              <svg viewBox="0 0 650 650">
                <ellipse
                  cx="325"
                  cy="325"
                  rx="300"
                  ry="218"
                  transform="rotate(-35 325 325)"
                />
                <ellipse
                  cx="325"
                  cy="325"
                  rx="300"
                  ry="218"
                  transform="rotate(35 325 325)"
                />
              </svg>
              <span className="lp-orbit-dot" />
            </div>
            <div className="lp-product-window">
              <div className="lp-window-top">
                <div>
                  <span />
                  <span />
                  <span />
                </div>
                <span>Somewhere to begin</span>
                <PanelLeft size={13} />
              </div>
              <div className="lp-window-body">
                <aside className="lp-preview-sidebar" aria-hidden="true">
                  <OrinLogo />
                  <Plus size={15} />
                  <MessageSquare size={14} />
                  <span />
                  <span />
                  <span />
                  <i>J</i>
                </aside>
                <div className="lp-preview-chat">
                  <div className="lp-example-label">
                    <span />
                    AN EXAMPLE CONVERSATION
                  </div>
                  <div className="lp-example-user" key={`question-${selected}`}>
                    {example.prompt}
                  </div>
                  <div className="lp-example-answer" key={`answer-${selected}`}>
                    <OrinLogo />
                    <div>
                      <h2>{example.title}</h2>
                      <p>{example.intro}</p>
                      <ol>
                        {example.steps.map((step, index) => (
                          <li key={step}>
                            <span>{index + 1}</span>
                            {step}
                          </li>
                        ))}
                      </ol>
                      <div className="lp-answer-line">
                        Small steps. Real momentum.<span>↗</span>
                      </div>
                    </div>
                  </div>
                  <div className="lp-preview-composer">
                    <span>Let’s make something of it…</span>
                    <div>
                      <Plus size={14} />
                      <span>
                        <Brain size={12} />
                        Thinking
                      </span>
                      <i>
                        <ArrowUp size={14} />
                      </i>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="lp-sticky-note" aria-hidden="true">
              <svg viewBox="0 0 120 35">
                <path d="M5 22C30 3 73 6 102 23M91 14l12 10-15 2" />
              </svg>
              <span>
                Start anywhere.
                <br />
                <em>We’ll figure it out.</em>
              </span>
              <span className="lp-note-star">✳</span>
            </div>
            <span className="lp-visual-caption">
              A little back-and-forth can go a long way.
            </span>
          </div>
        </section>
        <section
          className="lp-use-strip lp-container"
          aria-label="Ways to begin"
        >
          <span>ONE SPACE. SO MANY STARTING POINTS.</span>
          <div>
            <Pencil size={15} />
            Find the words
          </div>
          <i />
          <div>
            <Brain size={16} />
            Untangle a thought
          </div>
          <i />
          <div>
            <BookOpen size={15} />
            Understand more
          </div>
          <i />
          <div>
            <Sparkles size={15} />
            Make something new
          </div>
        </section>
        <section
          id="lp-experience"
          className="lp-experience lp-container lp-reveal"
        >
          <div className="lp-section-intro">
            <div className="lp-eyebrow">
              <span className="lp-section-index">01 /</span>NO PERFECT PROMPT
              REQUIRED
            </div>
            <h2>
              Bring the messy thought.
              <br />
              <em>We’ll start there.</em>
            </h2>
            <p>
              You don’t need to know exactly what to ask.
              <br />
              Pick a direction. Let the conversation find its shape.
            </p>
          </div>
          <div className="lp-experience-content">
            <div
              className="lp-example-tabs"
              role="tablist"
              aria-label="Explore an example"
            >
              {examples.map((item, index) => (
                <button
                  key={item.label}
                  id={`lp-tab-${index}`}
                  role="tab"
                  aria-selected={selected === index}
                  aria-controls="lp-example-panel"
                  className={selected === index ? "selected" : ""}
                  onClick={() => setSelected(index)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "ArrowRight" ||
                      event.key === "ArrowLeft"
                    ) {
                      event.preventDefault();
                      const next =
                        (index +
                          (event.key === "ArrowRight" ? 1 : -1) +
                          examples.length) %
                        examples.length;
                      setSelected(next);
                      document.getElementById(`lp-tab-${next}`)?.focus();
                    }
                  }}
                >
                  <item.icon size={17} />
                  {item.label}
                  <ArrowUpRight size={15} />
                </button>
              ))}
            </div>
            <div
              className="lp-example-panel"
              id="lp-example-panel"
              role="tabpanel"
              aria-labelledby={`lp-tab-${selected}`}
            >
              <span className="lp-example-kicker">
                A STARTING POINT, JUST FOR YOU
              </span>
              <h3>{example.prompt}</h3>
              <p>{example.intro}</p>
              <button
                className="lp-text-link"
                onClick={() => onStart(example.followup)}
              >
                Start with this
                <ArrowUpRight size={16} />
              </button>
              <span className="lp-panel-number" aria-hidden="true">
                0{selected + 1}
              </span>
            </div>
          </div>
        </section>
        <section
          id="lp-features"
          className="lp-features lp-container lp-reveal"
        >
          <div className="lp-features-heading">
            <div>
              <div className="lp-eyebrow">
                <span className="lp-section-index">02 /</span>LESS FRICTION.
                MORE POSSIBILITY.
              </div>
              <h2>Thoughtful by nature.</h2>
            </div>
            <p>
              A few little things that make
              <br />
              the thinking feel a little easier.
            </p>
          </div>
          <div className="lp-feature-grid">
            <article className="lp-feature-card lp-feature-sources">
              <div className="lp-feature-art lp-notes-art" aria-hidden="true">
                <div className="lp-paper lp-paper-back" />
                <div className="lp-paper lp-paper-front">
                  <BookOpen size={18} />
                  <span>A little more context.</span>
                  <i />
                  <i />
                  <i />
                  <div>
                    <b>1</b> A source worth opening <ArrowUpRight size={11} />
                  </div>
                </div>
                <span className="lp-art-spark">✳</span>
              </div>
              <span className="lp-card-index">CONTEXT THAT COUNTS</span>
              <h3>
                Go beyond
                <br />
                “because I said so.”
              </h3>
              <p>
                When reference knowledge is available, open the sources and see
                what’s behind an answer.
              </p>
            </article>
            <article className="lp-feature-card lp-feature-thinking">
              <div className="lp-feature-art lp-thought-art" aria-hidden="true">
                <div className="lp-thought-ring ring-one" />
                <div className="lp-thought-ring ring-two" />
                <div className="lp-thought-ring ring-three" />
                <span className="lp-thought-center">
                  <OrinLogo />
                </span>
                <div className="lp-art-thinking">
                  <Brain size={13} />
                  Thinking
                  <span>
                    <i />
                  </span>
                </div>
              </div>
              <span className="lp-card-index">ROOM FOR A SECOND THOUGHT</span>
              <h3>
                A quick answer.
                <br />
                Or a deeper look.
              </h3>
              <p>
                Keep things light for everyday questions. Turn Thinking on when
                there’s a little more to untangle.
              </p>
            </article>
            <article className="lp-feature-card lp-feature-history">
              <div className="lp-feature-art lp-history-art" aria-hidden="true">
                <span>YOUR CONVERSATIONS</span>
                <div>
                  <MessageSquare size={13} />
                  <span>That idea from yesterday</span>
                  <ChevronRight size={13} />
                </div>
                <div>
                  <MessageSquare size={13} />
                  <span>A new way to look at it</span>
                  <ChevronRight size={13} />
                </div>
                <div>
                  <MessageSquare size={13} />
                  <span>Something worth coming back to</span>
                  <ChevronRight size={13} />
                </div>
                <i className="lp-history-cursor">
                  <svg viewBox="0 0 24 28">
                    <path d="M3 2v20l5-5 4 8 4-2-4-8h8L3 2Z" />
                  </svg>
                </i>
              </div>
              <span className="lp-card-index">PICK UP THE THREAD</span>
              <h3>
                Good conversations
                <br />
                don’t have to end.
              </h3>
              <p>
                Sign in to keep your chats together. Return tomorrow, or on
                another device, and keep going.
              </p>
            </article>
          </div>
        </section>
        <section className="lp-language-section lp-reveal">
          <div className="lp-container lp-language-inner">
            <div>
              <div className="lp-eyebrow">
                <span className="lp-section-index">03 /</span>FEELS A LITTLE
                MORE LIKE YOU
              </div>
              <h2>
                Different words.
                <br />
                <em>Same possibility.</em>
              </h2>
              <p>
                English, Sinhala, or Tamil. Ask in the language
                <br className="lp-desktop-break" /> that feels natural, and keep
                the ideas flowing.
              </p>
              <button className="lp-button lp-light" onClick={() => onStart()}>
                Say hello to Orin
                <ArrowUpRight size={17} />
              </button>
            </div>
            <div
              className="lp-language-art"
              aria-label="Hello in English, Sinhala and Tamil"
            >
              <span className="lp-language-orbit orbit-a" />
              <span className="lp-language-orbit orbit-b" />
              <OrinLogo />
              <span className="lp-hello hello-en">Hello.</span>
              <span className="lp-hello hello-si" lang="si">
                ආයුබෝවන්.
              </span>
              <span className="lp-hello hello-ta" lang="ta">
                வணக்கம்.
              </span>
              <span className="lp-language-art-caption">
                A familiar voice. A fresh perspective.
              </span>
            </div>
          </div>
        </section>
        <section id="lp-questions" className="lp-faq lp-container lp-reveal">
          <div className="lp-section-intro">
            <div className="lp-eyebrow">
              <span className="lp-section-index">04 /</span>BEFORE WE GET
              STARTED
            </div>
            <h2>
              A few
              <br />
              <em>good questions.</em>
            </h2>
            <p>Curiosity looks good on you.</p>
            <OrinLogo />
          </div>
          <div className="lp-faq-list">
            {faqs.map((faq, index) => (
              <div
                className={`lp-faq-item ${openFaq === index ? "open" : ""}`}
                key={faq.q}
              >
                <h3>
                  <button
                    aria-expanded={openFaq === index}
                    aria-controls={`lp-faq-${index}`}
                    onClick={() => setOpenFaq(openFaq === index ? null : index)}
                  >
                    {faq.q}
                    <Plus size={19} />
                  </button>
                </h3>
                <div id={`lp-faq-${index}`} hidden={openFaq !== index}>
                  <p>{faq.a}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="lp-final lp-container lp-reveal">
          <span className="lp-final-line" />
          <OrinLogo />
          <p className="lp-eyebrow">THERE’S SOMETHING HERE FOR YOU.</p>
          <h2>
            Your next idea starts
            <br />
            with <em>a conversation.</em>
          </h2>
          <button
            className="lp-button lp-dark lp-main-cta"
            onClick={() => onStart()}
          >
            Let’s see where it goes
            <ArrowUpRight size={18} />
          </button>
          <p className="lp-final-note">
            No perfect question needed. Just a little curiosity.
          </p>
        </section>
      </main>
      <footer className="lp-footer lp-container">
        <a
          className="lp-wordmark"
          href="#home"
          onClick={(event) => {
            event.preventDefault();
            scroll.current?.scrollTo({ top: 0, behavior: "smooth" });
          }}
        >
          <OrinLogo />
          <span>
            orin<span className="lp-logo-dot">.</span>
          </span>
        </a>
        <p>
          Made for curious minds. Part of{" "}
          <a href="https://orinai.org" target="_blank" rel="noreferrer">
            OrinAI
            <ArrowUpRight size={11} />
          </a>
          .
        </p>
        <nav aria-label="Footer navigation">
          <a href="/admin">Admin</a>
          <a href="#privacy">Privacy</a>
          <a href="#terms">Terms</a>
          <button onClick={onSignIn}>
            Sign in
            <ArrowUpRight size={12} />
          </button>
        </nav>
        <span className="lp-footer-small">
          A little clarity goes a long way.
        </span>
      </footer>
    </div>
  );
}
