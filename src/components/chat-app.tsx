"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { ThinkingMode } from "@/lib/tensorra/model-router";
import {
  planDefinition,
  type TensorraPlanId,
} from "@/lib/tensorra/plans";
import InstallAppButton from "./install-app-button";
import MessageContent from "./message-content";
import { exportAnswerToPdf } from "@/lib/tensorra/pdf-export";

type Chat = {
  id: string;
  title: string;
  mode: ThinkingMode;
  pinned_at: string | null;
  created_at: string;
  updated_at: string;
};

type ResearchSource = { title: string; url: string; score?: number };
type ChatAttachment = { kind: "image" | "document"; filename: string; document_id?: string };

type Message = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  model_name?: string | null;
  created_at?: string;
  metadata?: {
    sources?: ResearchSource[];
    vision?: boolean;
    image_filename?: string;
    attachments?: ChatAttachment[];
    requested_mode?: ThinkingMode;
    effective_mode?: ThinkingMode;
    reasoning_effort?: "low" | "medium" | "high";
    verified?: boolean;
    fallback?: boolean;
    retried?: boolean;
    complexity_score?: number | null;
    planner_used?: boolean;
    verifier_used?: boolean;
    verifier_revised?: boolean;
    export_format?: "pdf" | null;
  } | null;
};

type Memory = {
  id: string;
  content: string;
  category: string;
  importance: number;
  created_at: string;
};

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
  { id: "auto", label: "Авто", hint: "TENSORRA сама выбирает глубину" },
  { id: "fast", label: "Быстро", hint: "20B · низкая глубина рассуждения" },
  { id: "balanced", label: "Баланс", hint: "20B · средняя глубина рассуждения" },
  { id: "deep", label: "Глубоко", hint: "120B · углублённый анализ" },
  { id: "max", label: "Максимум", hint: "120B · максимальная глубина и проверка" },
];

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const DOCUMENT_TYPES = new Set(["application/pdf", "text/plain", "text/markdown", "application/json"]);

function isImageFile(file: File) {
  return IMAGE_TYPES.has(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name);
}

function isDocumentFile(file: File) {
  return DOCUMENT_TYPES.has(file.type) || /\.(pdf|txt|md|json)$/i.test(file.name);
}

function sortChats(items: Chat[]) {
  return [...items].sort((a, b) => {
    if (a.pinned_at && !b.pinned_at) return -1;
    if (!a.pinned_at && b.pinned_at) return 1;
    if (a.pinned_at && b.pinned_at) {
      return new Date(b.pinned_at).getTime() - new Date(a.pinned_at).getTime();
    }
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });
}

function memoryCategoryLabel(category: string) {
  const labels: Record<string, string> = {
    explicit: "Сохранено вручную",
    fact: "Факт",
    preference: "Предпочтение",
    goal: "Цель",
    constraint: "Ограничение",
  };
  return labels[category] ?? category;
}


function thinkingModeLabel(mode?: string | null) {
  return MODES.find((item) => item.id === mode)?.label ?? null;
}

function modelLabel(model?: string | null) {
  if (!model) return null;
  const normalized = model.toLocaleLowerCase();
  if (normalized.includes("120b")) return "120B";
  if (normalized.includes("20b")) return "20B";
  if (normalized.includes("qwen")) return "Vision";
  if (normalized.includes("policy-gate")) return "Policy";
  return null;
}

export default function ChatApp() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [panel, setPanel] = useState<"none" | "memory">("none");
  const [thinkingMode, setThinkingMode] = useState<ThinkingMode>("auto");
  const [allowTraining, setAllowTraining] = useState(false);
  const [accountPlan, setAccountPlan] = useState<TensorraPlanId>("free");
  const [subscriptionStatus, setSubscriptionStatus] = useState("active");
  const [feedback, setFeedback] = useState<Record<string, -1 | 1>>({});
  const [correctionFor, setCorrectionFor] = useState<string | null>(null);
  const [correctionText, setCorrectionText] = useState("");
  const [listening, setListening] = useState(false);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [pendingAttachment, setPendingAttachment] = useState<File | null>(null);
  const [notice, setNotice] = useState("");
  const [chatMenuId, setChatMenuId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const attachInput = useRef<HTMLInputElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const thinkingModeRef = useRef<ThinkingMode>("auto");
  const activeRequestRef = useRef<AbortController | null>(null);

  const loadChats = useCallback(async () => {
    const { data, error } = await supabase
      .from("chats")
      .select("id,title,mode,pinned_at,created_at,updated_at")
      .order("pinned_at", { ascending: false, nullsFirst: false })
      .order("updated_at", { ascending: false })
      .limit(100);

    if (!error) setChats(sortChats((data ?? []) as Chat[]));
  }, [supabase]);

  const loadMessages = useCallback(async (chatId: string) => {
    const { data, error } = await supabase
      .from("messages")
      .select("id,role,content,model_name,created_at,metadata")
      .eq("chat_id", chatId)
      .in("role", ["user", "assistant"])
      .order("created_at", { ascending: true });

    if (!error) setMessages((data ?? []) as Message[]);
  }, [supabase]);

  const loadMemories = useCallback(async () => {
    const { data } = await supabase
      .from("memories")
      .select("id,content,category,importance,created_at")
      .order("importance", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(150);

    setMemories((data ?? []) as Memory[]);
  }, [supabase]);

  useEffect(() => {
    void loadChats();

    void (async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;

      const [{ data: profile }, { data: subscription }] = await Promise.all([
        supabase
          .from("profiles")
          .select("allow_training")
          .eq("id", userData.user.id)
          .maybeSingle(),
        supabase
          .from("subscriptions")
          .select("plan,status")
          .eq("user_id", userData.user.id)
          .maybeSingle(),
      ]);

      if (profile) setAllowTraining(Boolean(profile.allow_training));
      if (subscription) {
        const resolved = planDefinition(subscription.plan);
        setAccountPlan(resolved.id);
        setSubscriptionStatus(subscription.status || "active");
      }
    })();
  }, [loadChats, supabase]);

  useEffect(() => {
    if (activeChatId) {
      const chat = chats.find((item) => item.id === activeChatId);
      if (chat?.mode) {
        thinkingModeRef.current = chat.mode;
        setThinkingMode(chat.mode);
      }
      if (!loading) void loadMessages(activeChatId);
    } else if (!loading) {
      setMessages([]);
    }
  }, [activeChatId, chats, loadMessages, loading]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function ensureChat(mode: ThinkingMode) {
    if (activeChatId) return activeChatId;

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) throw new Error("Сессия истекла. Войди в аккаунт снова.");

    const { data, error } = await supabase
      .from("chats")
      .insert({
        user_id: userData.user.id,
        title: "Новый чат",
        mode,
      })
      .select("id")
      .single();

    if (error) throw error;

    setActiveChatId(data.id);
    await loadChats();
    return data.id as string;
  }

  async function changeThinkingMode(mode: ThinkingMode) {
    thinkingModeRef.current = mode;
    setThinkingMode(mode);
    if (!activeChatId) return;

    const { error } = await supabase
      .from("chats")
      .update({ mode })
      .eq("id", activeChatId);

    if (!error) {
      setChats((current) =>
        current.map((chat) =>
          chat.id === activeChatId ? { ...chat, mode } : chat,
        ),
      );
    }
  }

  async function renameChat(chat: Chat) {
    const nextTitle = window.prompt("Новое название чата:", chat.title)?.trim();
    setChatMenuId(null);
    if (!nextTitle || nextTitle === chat.title) return;

    const { error } = await supabase
      .from("chats")
      .update({ title: nextTitle.slice(0, 120) })
      .eq("id", chat.id);

    if (error) {
      setNotice("Не удалось переименовать чат.");
      return;
    }

    setChats((current) =>
      current.map((item) =>
        item.id === chat.id ? { ...item, title: nextTitle.slice(0, 120) } : item,
      ),
    );
  }

  async function togglePinChat(chat: Chat) {
    setChatMenuId(null);
    const pinnedAt = chat.pinned_at ? null : new Date().toISOString();

    const { error } = await supabase
      .from("chats")
      .update({ pinned_at: pinnedAt })
      .eq("id", chat.id);

    if (error) {
      setNotice("Не удалось изменить закрепление чата.");
      return;
    }

    setChats((current) =>
      sortChats(
        current.map((item) =>
          item.id === chat.id ? { ...item, pinned_at: pinnedAt } : item,
        ),
      ),
    );
  }

  async function deleteChat(chat: Chat) {
    setChatMenuId(null);
    const confirmed = window.confirm(
      `Удалить чат «${chat.title}»? Это действие нельзя отменить.`,
    );
    if (!confirmed) return;

    const response = await fetch(
      `/api/chats?id=${encodeURIComponent(chat.id)}`,
      { method: "DELETE" },
    );

    if (!response.ok) {
      setNotice(
        await readError(response, "Не удалось удалить чат."),
      );
      return;
    }

    setChats((current) => current.filter((item) => item.id !== chat.id));

    if (activeChatId === chat.id) {
      setActiveChatId(null);
      setMessages([]);
      setPendingAttachment(null);
    }
  }

  function selectAttachment(file: File) {
    if (!isImageFile(file) && !isDocumentFile(file)) {
      setNotice("Поддерживаются PDF, TXT, Markdown, JSON, JPG, PNG и WebP.");
      return;
    }

    const maxSize = isImageFile(file) ? 8 * 1024 * 1024 : 15 * 1024 * 1024;
    if (file.size <= 0 || file.size > maxSize) {
      setNotice(
        isImageFile(file)
          ? "Размер изображения не должен превышать 8 МБ."
          : "Размер документа не должен превышать 15 МБ.",
      );
      return;
    }

    setPendingAttachment(file);
    setNotice("");
  }

  async function readError(response: Response, fallback: string) {
    const raw = await response.text().catch(() => "");

    if (response.status === 401) {
      window.location.assign("/login");
      return "Сессия истекла. Выполняю переход на страницу входа.";
    }

    if (!raw) return fallback;

    try {
      const parsed = JSON.parse(raw) as { error?: string };
      return parsed.error || fallback;
    } catch {
      const looksLikeHtml = /^\s*</.test(raw);
      return looksLikeHtml
        ? fallback
        : raw.slice(0, 700);
    }
  }

  async function readJsonObject<T extends object>(
    response: Response,
    fallback: string,
  ): Promise<T> {
    const raw = await response.text().catch(() => "");

    if (response.status === 401) {
      window.location.assign("/login");
      throw new Error("Сессия истекла. Выполняю переход на страницу входа.");
    }

    if (!raw) throw new Error(fallback);

    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new Error(
        /^\s*</.test(raw)
          ? fallback
          : `${fallback} Сервер вернул некорректный ответ.`,
      );
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();

    const attachment = pendingAttachment;
    const text = input.trim();
    const requestedMode = thinkingModeRef.current;
    if ((!text && !attachment) || loading) return;

    const image = attachment && isImageFile(attachment) ? attachment : null;
    const document = attachment && isDocumentFile(attachment) ? attachment : null;

    const prompt = text || (
      image
        ? "Разбери это изображение и объясни всё важное."
        : "Прочитай этот документ, разберись в нём и выдели самое важное."
    );

    const optimisticAttachment: ChatAttachment | undefined = attachment
      ? { kind: image ? "image" : "document", filename: attachment.name }
      : undefined;

    setInput("");
    if (composerInputRef.current) composerInputRef.current.style.height = "auto";
    const requestController = new AbortController();
    activeRequestRef.current = requestController;

    setLoading(true);
    setNotice("");

    setMessages((current) => [
      ...current,
      {
        role: "user",
        content: prompt,
        metadata: optimisticAttachment
          ? { attachments: [optimisticAttachment] }
          : null,
      },
      { role: "assistant", content: "" },
    ]);

    try {
      const chatId = await ensureChat(requestedMode);
      let response: Response;

      if (image) {
        const form = new FormData();
        form.append("chatId", chatId);
        form.append("message", prompt);
        form.append("requestedMode", requestedMode);
        form.append("image", image);
        response = await fetch("/api/vision", {
          method: "POST",
          body: form,
          signal: requestController.signal,
        });
      } else {
        let documentIds: string[] = [];

        if (document) {
          const form = new FormData();
          form.append("chatId", chatId);
          form.append("file", document);

          const upload = await fetch("/api/documents", {
            method: "POST",
            body: form,
            signal: requestController.signal,
          });

          if (!upload.ok) {
            throw new Error(
              await readError(upload, "Не удалось загрузить документ."),
            );
          }

          const data = await readJsonObject<{
            document?: { id?: string };
          }>(
            upload,
            "TENSORRA не смогла прочитать ответ сервера после загрузки документа.",
          );

          const documentId = data.document?.id;
          if (!documentId) {
            throw new Error("TENSORRA не смогла привязать документ к чату.");
          }

          documentIds = [documentId];
        }

        response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chatId,
            message: prompt,
            documentIds,
            requestedMode,
          }),
          signal: requestController.signal,
        });
      }

      if (!response.ok) {
        throw new Error(await readError(response, "Не удалось получить ответ TENSORRA."));
      }
      if (!response.body) {
        throw new Error("Поток ответа недоступен.");
      }

      const effectiveMode = response.headers.get("X-Tensorra-Mode") as ThinkingMode | null;
      const responseModel = response.headers.get("X-Tensorra-Model");
      const fellBack = response.headers.get("X-Tensorra-Fallback") === "1";
      const retried = response.headers.get("X-Tensorra-Retry") === "1";
      const complexityHeader = response.headers.get("X-Tensorra-Complexity");
      const complexityScore = complexityHeader === null
        ? null
        : Number(complexityHeader);
      const plannerUsed = response.headers.get("X-Tensorra-Planner") === "1";
      const verified = response.headers.get("X-Tensorra-Verified") === "1";
      const verifierRevised = response.headers.get("X-Tensorra-Revised") === "1";
      const exportFormat = response.headers.get("X-Tensorra-Export") === "pdf"
        ? "pdf"
        : null;

      setMessages((current) => {
        const copy = [...current];
        const last = copy[copy.length - 1];
        if (last?.role === "assistant") {
          copy[copy.length - 1] = {
            ...last,
            model_name: responseModel,
            metadata: {
              ...(last.metadata ?? {}),
              requested_mode: requestedMode,
              effective_mode: effectiveMode ?? requestedMode,
              fallback: fellBack,
              retried,
              complexity_score: Number.isFinite(complexityScore)
                ? complexityScore
                : null,
              planner_used: plannerUsed,
              verified,
              verifier_used: verified || verifierRevised,
              verifier_revised: verifierRevised,
              export_format: exportFormat,
            },
          };
        }
        return copy;
      });

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

          if (last?.role === "assistant") {
            copy[copy.length - 1] = {
              ...last,
              content: last.content + chunk,
            };
          }

          return copy;
        });
      }

      setPendingAttachment(null);
      await loadChats();
      await loadMessages(chatId);
    } catch (error) {
      const aborted =
        error instanceof DOMException && error.name === "AbortError";

      setMessages((current) => {
        const copy = [...current];
        const last = copy[copy.length - 1];

        if (last?.role === "assistant") {
          if (aborted) {
            copy[copy.length - 1] = {
              ...last,
              content: last.content
                ? `${last.content}\n\n⏹ Генерация остановлена.`
                : "⏹ Генерация остановлена.",
            };
          } else {
            const textError = error instanceof Error
              ? error.message
              : "Произошла неизвестная ошибка.";

            copy[copy.length - 1] = {
              ...last,
              content: last.content
                ? `${last.content}\n\n⚠️ Ответ прервался: ${textError}`
                : `⚠️ ${textError}`,
            };
          }
        }

        return copy;
      });
    } finally {
      if (activeRequestRef.current === requestController) {
        activeRequestRef.current = null;
      }
      setLoading(false);
    }
  }

  function stopGeneration() {
    activeRequestRef.current?.abort();
  }

  function startVoiceInput() {
    if (typeof window === "undefined") return;

    const speechWindow = window as typeof window & {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };

    const Recognition =
      speechWindow.SpeechRecognition ??
      speechWindow.webkitSpeechRecognition;

    if (!Recognition) {
      setNotice("Голосовой ввод не поддерживается этим браузером.");
      return;
    }

    if (listening && speechRecognitionRef.current) {
      speechRecognitionRef.current.stop();
      return;
    }

    const recognition = new Recognition();
    recognition.lang = "ru-RU";
    recognition.interimResults = true;
    recognition.continuous = false;

    const base = input.trim();

    recognition.onresult = (event) => {
      let transcript = "";

      for (let i = 0; i < event.results.length; i += 1) {
        transcript += event.results[i]?.[0]?.transcript ?? "";
      }

      setInput(
        [base, transcript.trim()]
          .filter(Boolean)
          .join(base ? " " : ""),
      );
    };

    recognition.onend = () => {
      setListening(false);
      speechRecognitionRef.current = null;
    };

    recognition.onerror = () => {
      setListening(false);
      speechRecognitionRef.current = null;
      setNotice("Голосовой ввод остановлен. Проверь разрешение на микрофон.");
    };

    speechRecognitionRef.current = recognition;
    setListening(true);
    setNotice("");
    recognition.start();
  }

  function speakAnswer(text: string) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setNotice("Озвучивание не поддерживается этим браузером.");
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 12000));
    utterance.lang = "ru-RU";
    window.speechSynthesis.speak(utterance);
  }

  async function deleteMemory(id: string) {
    const { error } = await supabase
      .from("memories")
      .delete()
      .eq("id", id);

    if (!error) {
      setMemories((current) =>
        current.filter((item) => item.id !== id),
      );
    }
  }

  async function toggleTraining() {
    const next = !allowTraining;
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    const { error } = await supabase
      .from("profiles")
      .update({ allow_training: next })
      .eq("id", userData.user.id);

    if (!error) setAllowTraining(next);
  }

  async function copyMessage(content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setNotice("Ответ скопирован.");
    } catch {
      setNotice("Не удалось скопировать ответ.");
    }
  }

  async function exportMessagePdf(message: Message) {
    try {
      const activeTitle = chats.find((chat) => chat.id === activeChatId)?.title;
      await exportAnswerToPdf({
        content: message.content,
        title: activeTitle && activeTitle !== "Новый чат"
          ? activeTitle
          : "Материал TENSORRA",
      });
    } catch {
      setNotice("Не удалось сформировать PDF. Попробуй ещё раз.");
    }
  }

  async function rateMessage(message: Message, rating: -1 | 1) {
    if (!message.id) return;

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    const { error } = await supabase.from("message_feedback").upsert({
      user_id: userData.user.id,
      message_id: message.id,
      rating,
      mode: message.metadata?.effective_mode ?? (
        thinkingMode === "auto" ? null : thinkingMode
      ),
      model_name: message.model_name ?? null,
      eligible_for_training: allowTraining,
    }, { onConflict: "user_id,message_id" });

    if (!error) {
      setFeedback((current) => ({
        ...current,
        [message.id!]: rating,
      }));

      if (rating === -1) {
        setCorrectionFor(message.id);
        setCorrectionText("");
      } else if (correctionFor === message.id) {
        setCorrectionFor(null);
        setCorrectionText("");
      }
    }
  }

  async function saveCorrection(message: Message) {
    if (!message.id) return;
    const correction = correctionText.trim();
    if (!correction) {
      setCorrectionFor(null);
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    const { error } = await supabase
      .from("message_feedback")
      .update({
        correction: correction.slice(0, 12000),
        eligible_for_training: allowTraining,
      })
      .eq("user_id", userData.user.id)
      .eq("message_id", message.id);

    if (error) {
      setNotice("Не удалось сохранить исправление ответа.");
      return;
    }

    setCorrectionFor(null);
    setCorrectionText("");
    setNotice(
      allowTraining
        ? "Исправление сохранено и может помочь обучению TENSORRA."
        : "Исправление сохранено. Для обучения оно не используется без твоего разрешения.",
    );
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  function openMemory() {
    setPanel("memory");
    void loadMemories();
    setSidebarOpen(false);
  }

  const menuChat = chatMenuId
    ? chats.find((chat) => chat.id === chatMenuId) ?? null
    : null;

  return (
    <main className="appShell">
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="brandRow">
          <div className="tensorMark">T</div>
          <div className="brandText">
            <strong>TENSORRA</strong>
            <span>v0.22 · adaptive intelligence</span>
          </div>
          <button
            className="iconButton mobileOnly"
            onClick={() => setSidebarOpen(false)}
            aria-label="Закрыть боковую панель"
          >
            <svg className="uiIcon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M7 7l10 10M17 7 7 17" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <button
          className="newChatButton"
          onClick={() => {
            setActiveChatId(null);
            setMessages([]);
            setPendingAttachment(null);
            setSidebarOpen(false);
          }}
        >
          <svg className="uiIcon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
          <span>Новый чат</span>
        </button>

        <div className="sideActions">
          <button onClick={openMemory}>
            <span className="sideActionLead">
              <svg className="uiIcon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M8 7.5a4 4 0 0 1 7.2-2.4A3.7 3.7 0 0 1 18 8.7c0 .5-.1 1-.3 1.4A4 4 0 0 1 17 18H8a4 4 0 0 1-1.4-7.7A4 4 0 0 1 8 7.5Z" stroke="currentColor" strokeWidth="1.55"/>
                <path d="M9.5 9.2c.7-.7 1.7-1.1 2.7-1.1 1.2 0 2.2.5 2.9 1.3M9.7 14.6c.7.7 1.6 1.1 2.6 1.1 1.1 0 2-.4 2.7-1.2" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round"/>
              </svg>
              <span>Память</span>
            </span>
          </button>
        </div>

        <div className="chatList">
          {chats.map((chat) => (
            <div className="chatRow" key={chat.id}>
              <button
                className={`chatItem ${activeChatId === chat.id ? "active" : ""}`}
                onClick={() => {
                  setActiveChatId(chat.id);
                  setPendingAttachment(null);
                  setSidebarOpen(false);
                }}
                title={chat.title}
              >
                {chat.pinned_at ? <span className="pinMark">◆</span> : null}
                <span className="chatTitleText">{chat.title}</span>
              </button>

              <button
                className="chatMenuButton"
                aria-label="Меню чата"
                onClick={(event) => {
                  event.stopPropagation();
                  setChatMenuId((current) =>
                    current === chat.id ? null : chat.id,
                  );
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="6" cy="12" r="1.65" fill="currentColor" />
                  <circle cx="12" cy="12" r="1.65" fill="currentColor" />
                  <circle cx="18" cy="12" r="1.65" fill="currentColor" />
                </svg>
              </button>

            </div>
          ))}
        </div>

        <div className="sidebarFooter">
          <div className="memoryHint">
            <span className="dot" /> Память · файлы · веб · код — автоматически
          </div>

          <div className="accountPlanBadge" title="Текущий уровень доступа">
            <span>{planDefinition(accountPlan).shortLabel}</span>
            <strong>Core v1</strong>
          </div>

          <button
            className={`trainingToggle ${allowTraining ? "active" : ""}`}
            onClick={() => void toggleTraining()}
          >
            <span>{allowTraining ? "✓" : "○"}</span>
            Использовать мои оценки для улучшения TENSORRA
          </button>

          <InstallAppButton compact />
          <button className="ghostButton" onClick={signOut}>
            Выйти
          </button>
        </div>
      </aside>

      {menuChat ? (
        <div
          className="chatActionLayer"
          role="presentation"
          onClick={() => setChatMenuId(null)}
        >
          <section
            className="chatActionSheet"
            role="dialog"
            aria-modal="true"
            aria-label={`Действия с чатом «${menuChat.title}»`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="chatActionHandle" />
            <div className="chatActionHead">
              <span>Действия с чатом</span>
              <strong>{menuChat.title}</strong>
            </div>

            <button onClick={() => void togglePinChat(menuChat)}>
              <span className="chatActionIcon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M8 4h8l-1.2 5 3.2 3v1H6v-1l3.2-3L8 4Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
                  <path d="M12 13v7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                </svg>
              </span>
              <span>
                <strong>{menuChat.pinned_at ? "Открепить" : "Закрепить"}</strong>
                <small>
                  {menuChat.pinned_at
                    ? "Вернуть чат в общий список"
                    : "Оставить чат вверху списка"}
                </small>
              </span>
            </button>

            <button onClick={() => void renameChat(menuChat)}>
              <span className="chatActionIcon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M5 19h3.2L18.4 8.8a2.1 2.1 0 0 0-3-3L5.2 16 5 19Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
                  <path d="m13.8 7.4 2.8 2.8" stroke="currentColor" strokeWidth="1.6"/>
                </svg>
              </span>
              <span>
                <strong>Переименовать</strong>
                <small>Задать короткое название чата</small>
              </span>
            </button>

            <button
              className="danger"
              onClick={() => void deleteChat(menuChat)}
            >
              <span className="chatActionIcon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M7 8h10m-8.5 0 .7 11h5.6l.7-11M9.5 8V5.8h5V8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </span>
              <span>
                <strong>Удалить</strong>
                <small>Удалить чат и его историю</small>
              </span>
            </button>

            <button
              className="chatActionCancel"
              onClick={() => setChatMenuId(null)}
            >
              Отмена
            </button>
          </section>
        </div>
      ) : null}

      {sidebarOpen ? (
        <button
          className="scrim"
          aria-label="Закрыть боковую панель"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <section className="workspace">
        <header className="topbar">
          <button
            className="iconButton mobileOnly"
            onClick={() => setSidebarOpen(true)}
            aria-label="Открыть боковую панель"
          >
            <svg className="uiIcon menuIcon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M5 7.5h14M5 12h14M5 16.5h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
            </svg>
          </button>

          <div>
            <strong>TENSORRA</strong>
            <span className="statusText">{MODES.find((mode) => mode.id === thinkingMode)?.hint}</span>
          </div>

          <div className="modeSwitcher" aria-label="Режим мышления">
            {MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                className={`modeButton ${thinkingMode === mode.id ? "active" : ""}`}
                title={mode.hint}
                onClick={() => void changeThinkingMode(mode.id)}
                disabled={loading}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </header>

        <div className="conversation">
          {messages.length === 0 ? (
            <section className="hero">
              <div className="heroMark">T</div>
              <p className="eyebrow">TENSORRA</p>
              <h1>Что будем решать?</h1>
              <p className="heroSub">
                Задай вопрос, прикрепи файл или выбери нужную глубину мышления.
                Память, веб, вычисления и анализ файлов подключатся автоматически.
              </p>

              <div className="heroWorkbench">
                <div className="suggestions">
                  <button
                    onClick={() =>
                      setInput("Какие важные события в сфере ИИ произошли сегодня?")
                    }
                  >
                    <span className="suggestionKicker">WEB</span>
                    <strong>Найти свежие данные</strong>
                    <small>Актуальные источники и проверка фактов</small>
                  </button>
                  <button
                    onClick={() =>
                      setInput("Разбери эту проблему глубоко и предложи план действий.")
                    }
                  >
                    <span className="suggestionKicker">REASON</span>
                    <strong>Разобрать сложную задачу</strong>
                    <small>Planner, глубокий анализ и вывод</small>
                  </button>
                  <button
                    className="wideSuggestion"
                    onClick={() => attachInput.current?.click()}
                  >
                    <span className="suggestionKicker">FILES</span>
                    <strong>Прикрепить PDF или изображение</strong>
                    <small>RAG, Vision и работа с содержимым файла</small>
                  </button>
                </div>

                <aside className="coreStatusCard" aria-label="Состояние ядра TENSORRA">
                  <div className="coreStatusHead">
                    <div>
                      <span className="coreLive"><i /> CORE V1</span>
                      <strong>Ядро готово к задаче</strong>
                    </div>
                    <span className="corePlan">{planDefinition(accountPlan).shortLabel}</span>
                  </div>

                  <div className="coreStatusGrid">
                    <div>
                      <span>Режим</span>
                      <strong>{MODES.find((mode) => mode.id === thinkingMode)?.label}</strong>
                    </div>
                    <div>
                      <span>Память</span>
                      <strong>Приоритетная</strong>
                    </div>
                    <div>
                      <span>Инструменты</span>
                      <strong>Автовыбор</strong>
                    </div>
                    <div>
                      <span>Verifier</span>
                      <strong>{thinkingMode === "max" ? "Включён" : "По режиму"}</strong>
                    </div>
                  </div>

                  <div className="corePipeline" aria-hidden="true">
                    <span>Router</span><i>→</i>
                    <span>Planner</span><i>→</i>
                    <span>Model</span><i>→</i>
                    <span>Verify</span>
                  </div>

                  <p>
                    {subscriptionStatus === "active"
                      ? "Память, файлы, веб и вычисления подключаются только когда нужны."
                      : "Доступ к функциям зависит от состояния подписки."}
                  </p>
                </aside>
              </div>
            </section>
          ) : (
            <div className="messageColumn">
              {messages.map((message, index) => (
                <article
                  className={`messageRow ${message.role}`}
                  key={message.id ?? `${message.role}-${index}`}
                >
                  <div className="messageAvatar">
                    {message.role === "assistant" ? "T" : "Вы"}
                  </div>

                  <div>
                    <div className="messageLabel">
                      <span>{message.role === "assistant" ? "TENSORRA" : "ВЫ"}</span>
                      {message.role === "assistant" && message.metadata?.effective_mode ? (
                        <span
                          className="responseMode"
                          title={[
                            message.metadata.requested_mode === "auto"
                              ? "Режим выбран ядром автоматически"
                              : "Режим выбран вручную",
                            typeof message.metadata.complexity_score === "number"
                              ? `оценка сложности: ${message.metadata.complexity_score}`
                              : "",
                            message.metadata.planner_used ? "planner: включён" : "",
                            message.metadata.verified ? "verifier: пройден" : "",
                            message.metadata.verifier_revised ? "verifier: ответ исправлен" : "",
                            message.metadata.retried ? "провайдер: повторный запрос" : "",
                          ].filter(Boolean).join(" · ")}
                        >
                          {message.metadata.requested_mode === "auto" ? "Авто→" : ""}
                          {thinkingModeLabel(message.metadata.effective_mode)}
                          {modelLabel(message.model_name) ? ` · ${modelLabel(message.model_name)}` : ""}
                          {message.metadata.verified ? " · ✓" : ""}
                          {message.metadata.fallback ? " · резерв" : ""}
                        </span>
                      ) : null}
                    </div>

                    {message.metadata?.attachments?.length ? (
                      <div className="messageAttachments">
                        {message.metadata.attachments.map(
                          (attachment, attachmentIndex) => (
                            <span
                              key={`${attachment.filename}-${attachmentIndex}`}
                            >
                              {attachment.kind === "image" ? "▧" : "▣"}{" "}
                              {attachment.filename}
                            </span>
                          ),
                        )}
                      </div>
                    ) : null}

                    <div
                      className={`messageContent ${
                        message.role === "assistant" &&
                        loading &&
                        index === messages.length - 1 &&
                        !message.content
                          ? "thinking"
                          : ""
                      }`}
                    >
                      {message.content ? (
                        message.role === "assistant" ? (
                          <MessageContent content={message.content} />
                        ) : (
                          message.content
                        )
                      ) : (
                        message.role === "assistant" ? "Думаю" : ""
                      )}
                    </div>

                    {message.role === "assistant" &&
                    message.metadata?.sources?.length ? (
                      <div className="sourceList">
                        {message.metadata.sources
                          .slice(0, 8)
                          .map((source, sourceIndex) => (
                            <a
                              key={source.url}
                              href={source.url}
                              target="_blank"
                              rel="noreferrer"
                              title={source.url}
                            >
                              <span>{sourceIndex + 1}</span>
                              <strong>{source.title}</strong>
                            </a>
                          ))}
                      </div>
                    ) : null}

                    {message.role === "assistant" && message.id ? (
                      <>
                        <div className="feedbackRow">
                          <button
                            className={
                              feedback[message.id] === 1 ? "active" : ""
                            }
                            onClick={() => void rateMessage(message, 1)}
                          >
                            ↑ Хорошо
                          </button>
                          <button
                            className={
                              feedback[message.id] === -1 ? "active" : ""
                            }
                            onClick={() => void rateMessage(message, -1)}
                          >
                            ↓ Плохо
                          </button>
                          <button onClick={() => void copyMessage(message.content)}>
                            ⧉ Копировать
                          </button>
                          <button onClick={() => speakAnswer(message.content)}>
                            ◌ Озвучить
                          </button>
                          {message.metadata?.export_format === "pdf" ? (
                            <button
                              className="exportPdfButton"
                              onClick={() => void exportMessagePdf(message)}
                            >
                              ↓ Скачать PDF
                            </button>
                          ) : null}
                        </div>

                        {correctionFor === message.id ? (
                          <div className="correctionCard">
                            <div className="correctionHead">
                              <div>
                                <strong>Что стоило ответить лучше?</strong>
                                <span>
                                  Это помогает улучшать качество. В обучение попадёт
                                  только при включённом разрешении.
                                </span>
                              </div>
                              <button
                                type="button"
                                aria-label="Закрыть"
                                onClick={() => {
                                  setCorrectionFor(null);
                                  setCorrectionText("");
                                }}
                              >
                                ×
                              </button>
                            </div>

                            <textarea
                              value={correctionText}
                              onChange={(event) => setCorrectionText(event.target.value)}
                              placeholder="Напиши правильный ответ, недостающий факт или что именно было не так…"
                              rows={3}
                            />

                            <div className="correctionActions">
                              <button
                                type="button"
                                className="correctionSave"
                                onClick={() => void saveCorrection(message)}
                                disabled={!correctionText.trim()}
                              >
                                Сохранить исправление
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setCorrectionFor(null);
                                  setCorrectionText("");
                                }}
                              >
                                Не сейчас
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </article>
              ))}

              <div ref={endRef} />
            </div>
          )}
        </div>

        <div className="composerWrap">
          {notice ? (
            <div className="composerNotice">{notice}</div>
          ) : null}

          {pendingAttachment ? (
            <div className="imageChip">
              <span>
                {isImageFile(pendingAttachment) ? "▧" : "▣"}{" "}
                {pendingAttachment.name}
              </span>
              <button
                type="button"
                onClick={() => setPendingAttachment(null)}
                aria-label="Убрать вложение"
              >
                ×
              </button>
            </div>
          ) : null}

          <div className="toolStrip">
            <button
              type="button"
              onClick={() => attachInput.current?.click()}
              disabled={loading}
            >
              <svg className="uiIcon toolIcon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="m8.5 12.7 5.8-5.8a3.2 3.2 0 0 1 4.5 4.5l-7.1 7.1a4.5 4.5 0 1 1-6.4-6.4l7.2-7.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span>Прикрепить</span>
            </button>

            <button
              className={listening ? "active" : ""}
              type="button"
              onClick={startVoiceInput}
            >
              {listening ? (
                <>
                  <svg className="uiIcon toolIcon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect x="7.5" y="7.5" width="9" height="9" rx="2.2" fill="currentColor"/>
                  </svg>
                  <span>Остановить</span>
                </>
              ) : (
                <>
                  <svg className="uiIcon toolIcon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect x="9" y="4.5" width="6" height="10" rx="3" stroke="currentColor" strokeWidth="1.6"/>
                    <path d="M6.8 11.6a5.2 5.2 0 0 0 10.4 0M12 16.8v2.7M9.5 19.5h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                  </svg>
                  <span>Голос</span>
                </>
              )}
            </button>

            <input
              ref={attachInput}
              hidden
              type="file"
              accept="application/pdf,text/plain,text/markdown,application/json,.md,.txt,.json,image/jpeg,image/png,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) selectAttachment(file);
                event.currentTarget.value = "";
              }}
            />
          </div>

          <form className="composer" onSubmit={send}>
            <textarea
              ref={composerInputRef}
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                event.currentTarget.style.height = "auto";
                event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 180)}px`;
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder={
                pendingAttachment
                  ? "Что сделать с этим файлом?"
                  : "Спросите TENSORRA о чём угодно…"
              }
              rows={1}
            />

            {loading ? (
              <button
                className="sendButton stopButton"
                type="button"
                onClick={stopGeneration}
                aria-label="Остановить генерацию"
                title="Остановить генерацию"
              >
                <svg
                  className="stopIcon"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <rect x="7.5" y="7.5" width="9" height="9" rx="2.3" />
                </svg>
              </button>
            ) : (
              <button
                className="sendButton"
                type="submit"
                disabled={!input.trim() && !pendingAttachment}
                aria-label="Отправить"
              >
                <svg className="sendIcon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 18V6M7.5 10.5 12 6l4.5 4.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
          </form>

          <div className="composerNote">
            TENSORRA сама решает, когда использовать память, файлы, интернет,
            вычисления и анализ изображений.
          </div>
        </div>
      </section>

      {panel === "memory" ? (
        <div className="rightPanel">
          <div className="panelHead">
            <div>
              <p className="eyebrow">TENSORRA</p>
              <h2>Память</h2>
            </div>
            <button
              className="iconButton"
              onClick={() => setPanel("none")}
              aria-label="Закрыть память"
            >
              ×
            </button>
          </div>

          <div className="panelList">
            {memories.length ? (
              memories.map((memory) => (
                <div className="panelItem" key={memory.id}>
                  <div>
                    <strong>{memoryCategoryLabel(memory.category)}</strong>
                    <p>{memory.content}</p>
                    <span>важность: {memory.importance}/10</span>
                  </div>
                  <button onClick={() => void deleteMemory(memory.id)}>
                    Удалить
                  </button>
                </div>
              ))
            ) : (
              <p className="panelEmpty">
                Долговременной памяти пока нет. TENSORRA будет сохранять только
                полезные факты, цели и предпочтения.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </main>
  );
}
