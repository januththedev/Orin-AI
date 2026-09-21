
export type Language = 'en' | 'si' | 'ta';
export type UserTier = 'Free' | 'Basic' | 'Pro (BYO-Google)' | 'Verified Member';
export type UserRole = 'visitor' | 'training' | 'devops' | 'owner';

// Site-wide visual theme (independent of dark/light toggle)
export type UserThemeId = 'classic' | 'midnight' | 'aurora' | 'terminal' | 'paper' | 'ocean' | 'sunset' | 'neon';

export interface UserAccount {
  id: string;
  name: string;
  email: string;
  phone?: string;
  avatar?: string;
  tier: UserTier;
  plan?: string; // Firestore plan: free, starter, basic, basic_yearly, pro, pro_yearly
  role?: UserRole;
  approved?: boolean;
  token?: string;
  theme?: UserThemeId;
  dailyUsage: {
    text: number;
    images: number;
    videos: number;
  };
}

export interface GroundingLink {
  title: string;
  uri: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  type: 'text' | 'image' | 'video' | 'file';
  links?: GroundingLink[];
  imageUrl?: string;
  videoUrl?: string;
  fileName?: string;
  reasoning_details?: any;
  /** Reasoning trace from thinking mode — shown collapsed, expands on click. */
  thinking?: string;
  /** Model id that answered (from /api/models catalog). */
  model?: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  timestamp: Date;
  mode: WorkspaceMode;
  modesUsed?: WorkspaceMode[];
  /** Embedding vector for semantic search (Gemini Embedding 2). */
  embedding?: number[];
  /** Per-conversation: use Thinking Mode (slower, deeper reasoning). */
  thinkingMode?: boolean;
  /** Per-conversation: use Descriptive Mode (step-by-step explanations). */
  descriptiveMode?: boolean;
}

/** True if the conversation has at least one *real* user message (text or attachment). */
export function conversationHasUserMessage(c: Conversation): boolean {
  return (c.messages || []).some(m => {
    if (m.role !== 'user') return false;
    const hasText = typeof m.content === 'string' && m.content.trim().length > 0;
    const hasAttachment = !!(m.imageUrl || m.videoUrl || m.fileName);
    return hasText || hasAttachment;
  });
}

export type AspectRatio = "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "9:16" | "16:9" | "21:9";
export type ImageSize = "1K" | "2K" | "4K";

export interface HardwareStatus {
  mode: 'GPU' | 'CPU';
  label: string;
}

export type AppView = 'landing' | 'chat' | 'account' | 'privacy' | 'terms' | 'device-auth' | 'admin-portal' | 'voice' | 'translate' | 'downloads';
export type WorkspaceMode = 'chat';

// Graphing types for Maths / Graphs workspace
export type GraphType = 'function' | 'parametric' | 'polar' | 'data';

export interface GraphDomain {
  min: number;
  max: number;
}

export interface GraphDataSeries {
  id: string;
  label: string;
  x: number[];
  y: number[];
}

export interface GraphDefinition {
  id: string;
  type: GraphType;
  expressionLatex?: string; // for function/parametric/polar
  xDomain?: GraphDomain;
  yDomain?: GraphDomain;
  dataSeries?: GraphDataSeries[]; // for data / statistics plots
}

// Maths-only history items (separate from chat history)
export type MathHistoryKind = 'expression' | 'graph';

export interface MathHistoryItem {
  id: string;
  kind: MathHistoryKind;
  inputLatex: string;
  result?: string;
  graph?: GraphDefinition | null;
  createdAt: string; // ISO string
}

// Maths extraction & solving (AI-extracted, CAS-solved)
export type MathExtractType =
  | 'quadratic'
  | 'linear'
  | 'system'
  | 'calculus'
  | 'trigonometry'
  | 'matrix'
  | 'statistics'
  | 'unknown';

export type MathOperation =
  | 'solve'
  | 'simplify'
  | 'differentiate'
  | 'integrate'
  | 'factor'
  | 'expand';

export interface MathExtractResult {
  type: MathExtractType;
  expression: string | string[]; // string[] for systems
  latexExpression?: string;
  variable: string;
  operation?: MathOperation;
  extraValues?: Record<string, any>;
  confidence: number;
  unreadable: boolean;
}

export interface MathStep {
  label: string;
  expression: string;
  latexExpression: string;
}

export interface MathSolveResult {
  success: boolean;
  answers: string[];
  latexAnswers: string[];
  steps: MathStep[];
  method: string;
  error?: string;
}

export interface SiteMetrics {
  totalUsers: number;
  activeToday: number;
  aiRequests: number;
  serverStatus: 'online' | 'maintenance' | 'degraded';
  lastBackup: Date;
}

export interface SignupRequest {
  id: string;
  email: string;
  reason: string;
  codeDetected: boolean;
  requestedRole: UserRole;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: Date;
}

export interface ApiKeyDef {
  id: string;
  hash: string;
  note: string;
  createdAt: any;
  enabled: boolean;
}

export interface ExamPaper {
  id: string;
  title: string;
  year: number;
  subject: string;
  status: 'raw' | 'processed' | 'verified';
  uploadedBy: string;
}
