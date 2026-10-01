"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { ThinkingMode } from "@/lib/tensorra/model-router";
import InstallAppButton from "./install-app-button";

type Chat = { id: string; title: string; mode: ThinkingMode; created_at: string; updated_at: string };
type ResearchSource = { title: string; url: string; score?: number };
type Message = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  model_name?: string | null;
  created_at?: string;
  metadata?: { sources?: ResearchSource[] } | null;
};
type Memory = { id: string; content: string; category: string; importance: number; created_at: string };
type Document = { id: string; filename: string; status: string; size_bytes: number | null; created_at: string };
type SpeechRecognitionResultLike = { isFinal: boolean; 0?: { transcript?: string } };
type SpeechRecognitionEventLike = { results: ArrayLike<SpeechRecognitionResultLike> };
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const MODES: Array<{ id: ThinkingMode; label: string; hint: string }> = [
  { id: "auto", label: "Auto", hint: "TENSORRA chooses the depth" },
  { id: "fast", label: "Fast", hint: "20B · low reasoning" },
  { id: "balanced", label: "Balanced", hint: "20B · medium reasoning" },
  { id: "deep", label: "Deep", hint: "120B · medium reasoning" },
  { id: "max", label: "Max", hint: "120B · high + verification" },
];

export default function ChatApp() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [panel, setPanel] = useState<"none" | "memory" | "files">("none");
  const [thinkingMode, setThinkingMode] = useState<ThinkingMode>("auto");
  const [allowTraining, setAllowTraining] = useState(false);
  const [feedback, setFeedback] = useState<Record<string, -1 | 1>>({});
  const [webTool, setWebTool] = useState(true);
  const [codeTool, setCodeTool] = useState(true);
  const [researchMode, setResearchMode] = useState(false);
  const [listening, setListening] = useState(false);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const loadChats = useCallback(async () => {
    const { data, error } = await supabase.from("chats").select("id,title,mode,created_at,updated_at").order("updated_at", { ascending: false }).limit(100);
    if (!error) setChats((data ?? []) as Chat[]);
  }, [supabase]);

  const loadMessages = useCallback(async (chatId: string) => {
    const { data, error } = await supabase.from("messages").select("id,role,content,model_name,created_at,metadata").eq("chat_id", chatId).in("role", ["user", "assistant"]).order("created_at", { ascending: true });
    if (!error) setMessages((data ?? []) as Message[]);
  }, [supabase]);

  const loadMemories = useCallback(async () => {
    const { data } = await supabase.from("memories").select("id,content,category,importance,created_at").order("importance", { ascending: false }).order("created_at", { ascending: false }).limit(150);
    setMemories((data ?? []) as Memory[]);
  }, [supabase]);

  const loadDocuments = useCallback(async () => {
    const { data } = await supabase.from("documents").select("id,filename,status,size_bytes,created_at").order("created_at", { ascending: false }).limit(100);
    setDocuments((data ?? []) as Document[]);
  }, [supabase]);

  useEffect(() => {
    void loadChats();
    void loadDocuments();
    void (async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;
      const { data } = await supabase.from("profiles").select("allow_training").eq("id", userData.user.id).maybeSingle();
      if (data) setAllowTraining(Boolean(data.allow_training));
    })();
  }, [loadChats, loadDocuments, supabase]);

  useEffect(() => {
    if (activeChatId) {
      const chat = chats.find((item) => item.id === activeChatId);
      if (chat?.mode) setThinkingMode(chat.mode);
      if (!loading) void loadMessages(activeChatId);
    } else if (!loading) setMessages([]);
  }, [activeChatId, chats, loadMessages, loading]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  async function ensureChat() {
    if (activeChatId) return activeChatId;
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) throw new Error("Session expired");
    const { data, error } = await supabase.from("chats").insert({ user_id: userData.user.id, title: "New chat", mode: thinkingMode }).select("id").single();
    if (error) throw error;
    setActiveChatId(data.id);
    await loadChats();
    return data.id as string;
  }

  async function changeThinkingMode(mode: ThinkingMode) {
    setThinkingMode(mode);
    if (!activeChatId) return;
    const { error } = await supabase.from("chats").update({ mode }).eq("id", activeChatId);
    if (!error) setChats((current) => current.map((chat) => chat.id === activeChatId ? { ...chat, mode } : chat));
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    setInput(""); setLoading(true); setNotice("");
    setMessages((current) => [...current, { role: "user", content: text }, { role: "assistant", content: "" }]);

    try {
      const chatId = await ensureChat();
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, message: text, tools: { web: webTool, code: codeTool }, research: researchMode }),
      });
      if (!response.ok) throw new Error((await response.text()) || "TENSORRA request failed");
      if (!response.body) throw new Error("Streaming response is unavailable");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (!chunk) continue;
        setMessages((current) => {
          const copy = [...current];
          const last = copy[copy.length - 1];
          if (last?.role === "assistant") copy[copy.length - 1] = { ...last, content: last.content + chunk };
          return copy;
        });
      }
      await loadChats();
      await loadMessages(chatId);
    } catch (error) {
      const textError = error instanceof Error ? error.message : "Unexpected error";
      setMessages((current) => {
        const copy = [...current];
        const last = copy[copy.length - 1];
        if (last?.role === "assistant") copy[copy.length - 1] = { ...last, content: `Error: ${textError}` };
        return copy;
      });
    } finally { setLoading(false); }
  }

  function startVoiceInput() {
    if (typeof window === "undefined") return;
    const speechWindow = window as typeof window & {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setNotice("Voice input is not supported in this browser yet.");
      return;
    }
    if (listening && speechRecognitionRef.current) {
      speechRecognitionRef.current.stop();
      return;
    }

    const recognition = new Recognition();
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;
    const base = input.trim();
    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i += 1) {
        transcript += event.results[i]?.[0]?.transcript ?? "";
      }
      setInput([base, transcript.trim()].filter(Boolean).join(base ? " " : ""));
    };
    recognition.onend = () => { setListening(false); speechRecognitionRef.current = null; };
    recognition.onerror = () => {
      setListening(false);
      speechRecognitionRef.current = null;
      setNotice("Voice input stopped. Check microphone permission and try again.");
    };
    speechRecognitionRef.current = recognition;
    setListening(true);
    setNotice("");
    recognition.start();
  }

  function speakAnswer(text: string) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setNotice("Read-aloud is not supported in this browser.");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 12000));
    utterance.lang = navigator.language || "en-US";
    window.speechSynthesis.speak(utterance);
  }

  async function uploadFile(file: File) {
    setUploading(true); setNotice("");
    try {
      const form = new FormData(); form.append("file", file);
      const response = await fetch("/api/documents", { method: "POST", body: form });
      const raw = await response.text();
      let data: { error?: string } = {};
      if (raw) {
        try {
          data = JSON.parse(raw) as { error?: string };
        } catch {
          if (!response.ok) throw new Error(raw.slice(0, 500) || `Upload failed (${response.status})`);
        }
      }
      if (!response.ok) throw new Error(data.error ?? `Upload failed (${response.status})`);
      setNotice(`${file.name} added to TENSORRA knowledge.`);
      await loadDocuments();
      setPanel("files");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Upload failed"); }
    finally { setUploading(false); if (fileInput.current) fileInput.current.value = ""; }
  }

  async function deleteDocument(id: string) {
    const response = await fetch(`/api/documents?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (response.ok) await loadDocuments();
  }

  async function deleteMemory(id: string) {
    const { error } = await supabase.from("memories").delete().eq("id", id);
    if (!error) setMemories((current) => current.filter((item) => item.id !== id));
  }

  async function toggleTraining() {
    const next = !allowTraining;
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    const { error } = await supabase.from("profiles").update({ allow_training: next }).eq("id", userData.user.id);
    if (!error) setAllowTraining(next);
  }

  async function rateMessage(message: Message, rating: -1 | 1) {
    if (!message.id) return;
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;
    const { error } = await supabase.from("message_feedback").upsert({
      user_id: userData.user.id,
      message_id: message.id,
      rating,
      mode: thinkingMode === "auto" ? null : thinkingMode,
      model_name: message.model_name ?? null,
      eligible_for_training: allowTraining,
    }, { onConflict: "user_id,message_id" });
    if (!error) setFeedback((current) => ({ ...current, [message.id!]: rating }));
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login"); router.refresh();
  }

  function openMemory() { setPanel("memory"); void loadMemories(); setSidebarOpen(false); }
  function openFiles() { setPanel("files"); void loadDocuments(); setSidebarOpen(false); }

  return (
    <main className="appShell">
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="brandRow">
          <div className="tensorMark">T</div>
          <div className="brandText"><strong>TENSORRA</strong><span>v0.5 · research + voice</span></div>
          <button className="iconButton mobileOnly" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar">×</button>
        </div>

        <button className="newChatButton" onClick={() => { setActiveChatId(null); setMessages([]); setSidebarOpen(false); }}><span>＋</span> New chat</button>
        <div className="sideActions">
          <button onClick={openMemory}>◈ Memory <span>{memories.length || ""}</span></button>
          <button onClick={openFiles}>▣ Knowledge <span>{documents.filter((d) => d.status === "ready").length || ""}</span></button>
        </div>

        <div className="chatList">
          {chats.map((chat) => (
            <button key={chat.id} className={`chatItem ${activeChatId === chat.id ? "active" : ""}`} onClick={() => { setActiveChatId(chat.id); setSidebarOpen(false); }}>
              <span>{chat.title}</span>
            </button>
          ))}
        </div>

        <div className="sidebarFooter">
          <div className="memoryHint"><span className="dot" /> Memory + private RAG active</div>
          <button className={`trainingToggle ${allowTraining ? "active" : ""}`} onClick={() => void toggleTraining()}><span>{allowTraining ? "✓" : "○"}</span> Use my rated chats to improve TENSORRA</button>
          <InstallAppButton compact />
          <button className="ghostButton" onClick={signOut}>Sign out</button>
        </div>
      </aside>

      {sidebarOpen ? <button className="scrim" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)} /> : null}

      <section className="workspace">
        <header className="topbar">
          <button className="iconButton mobileOnly" onClick={() => setSidebarOpen(true)} aria-label="Open sidebar">☰</button>
          <div><strong>TENSORRA</strong><span className="statusText">reasoning · memory · tools</span></div>
          <div className="modeSwitcher" aria-label="Thinking mode">
            {MODES.map((mode) => <button key={mode.id} type="button" className={`modeButton ${thinkingMode === mode.id ? "active" : ""}`} title={mode.hint} onClick={() => void changeThinkingMode(mode.id)} disabled={loading}>{mode.label}</button>)}
          </div>
        </header>

        <div className="conversation">
          {messages.length === 0 ? (
            <section className="hero">
              <div className="heroMark">T</div>
              <p className="eyebrow">TENSORRA CORE</p>
              <h1>One AI. The depth you need.</h1>
              <p className="heroSub">Reasoning, web search, Python execution, private documents and long-term memory in one workspace.</p>
              <div className="suggestions">
                <button onClick={() => setInput("Research the latest developments in AI and explain what actually matters.")}>Research something current</button>
                <button onClick={() => setInput("Analyze this problem deeply, challenge my assumptions and give me a plan.")}>Think through a hard problem</button>
                <button onClick={() => fileInput.current?.click()}>Add a PDF to knowledge</button>
              </div>
            </section>
          ) : (
            <div className="messageColumn">
              {messages.map((message, index) => (
                <article className={`messageRow ${message.role}`} key={message.id ?? `${message.role}-${index}`}>
                  <div className="messageAvatar">{message.role === "assistant" ? "T" : "You"}</div>
                  <div>
                    <div className="messageLabel">{message.role === "assistant" ? "TENSORRA" : "YOU"}</div>
                    <div className={`messageContent ${message.role === "assistant" && loading && index === messages.length - 1 && !message.content ? "thinking" : ""}`}>{message.content || (message.role === "assistant" ? "Thinking" : "")}</div>
                    {message.role === "assistant" && message.metadata?.sources?.length ? (
                      <div className="sourceList">
                        {message.metadata.sources.slice(0, 8).map((source, sourceIndex) => (
                          <a key={source.url} href={source.url} target="_blank" rel="noreferrer" title={source.url}>
                            <span>{sourceIndex + 1}</span>
                            <strong>{source.title}</strong>
                          </a>
                        ))}
                      </div>
                    ) : null}
                    {message.role === "assistant" && message.id ? <div className="feedbackRow">
                      <button className={feedback[message.id] === 1 ? "active" : ""} onClick={() => void rateMessage(message, 1)}>↑ Good</button>
                      <button className={feedback[message.id] === -1 ? "active" : ""} onClick={() => void rateMessage(message, -1)}>↓ Bad</button>
                      <button onClick={() => speakAnswer(message.content)}>◌ Listen</button>
                    </div> : null}
                  </div>
                </article>
              ))}
              <div ref={endRef} />
            </div>
          )}
        </div>

        <div className="composerWrap">
          {notice ? <div className="composerNotice">{notice}</div> : null}
          <div className="toolStrip">
            <button className={researchMode ? "active" : ""} onClick={() => setResearchMode((v) => !v)}>◉ Research</button>
            <button className={webTool || researchMode ? "active" : ""} onClick={() => setWebTool((v) => !v)} disabled={researchMode}>◎ Web</button>
            <button className={codeTool ? "active" : ""} onClick={() => setCodeTool((v) => !v)}>⌘ Code</button>
            <button className={listening ? "active" : ""} onClick={startVoiceInput}>{listening ? "■ Stop" : "◌ Voice"}</button>
            <button onClick={() => fileInput.current?.click()} disabled={uploading}>{uploading ? "Uploading…" : "+ File"}</button>
            <input ref={fileInput} hidden type="file" accept="application/pdf,text/plain,text/markdown,application/json,.md" onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadFile(file); }} />
          </div>
          <form className="composer" onSubmit={send}>
            <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} placeholder="Ask TENSORRA anything…" rows={1} />
            <button className="sendButton" type="submit" disabled={!input.trim() || loading}>↑</button>
          </form>
          <div className="composerNote">Auto chooses reasoning depth. Research forces Max + Web + verification. Voice uses browser speech APIs.</div>
        </div>
      </section>

      {panel !== "none" ? <div className="rightPanel">
        <div className="panelHead"><div><p className="eyebrow">TENSORRA</p><h2>{panel === "memory" ? "Memory" : "Knowledge"}</h2></div><button className="iconButton" onClick={() => setPanel("none")}>×</button></div>
        {panel === "memory" ? <div className="panelList">
          {memories.length ? memories.map((memory) => <div className="panelItem" key={memory.id}><div><strong>{memory.category}</strong><p>{memory.content}</p><span>importance {memory.importance}/10</span></div><button onClick={() => void deleteMemory(memory.id)}>Delete</button></div>) : <p className="panelEmpty">No durable memories yet. TENSORRA will save useful long-term context automatically.</p>}
        </div> : <div className="panelList">
          <button className="panelUpload" onClick={() => fileInput.current?.click()}>＋ Add PDF / text file</button>
          {documents.length ? documents.map((doc) => <div className="panelItem" key={doc.id}><div><strong>{doc.filename}</strong><p>{doc.status}</p><span>{doc.size_bytes ? `${Math.round(doc.size_bytes / 1024)} KB` : ""}</span></div><button onClick={() => void deleteDocument(doc.id)}>Delete</button></div>) : <p className="panelEmpty">Upload documents and TENSORRA will retrieve relevant passages while answering.</p>}
        </div>}
      </div> : null}
    </main>
  );
}
