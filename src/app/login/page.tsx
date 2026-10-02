"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";

function translateAuthError(message: string) {
  const lower = message.toLocaleLowerCase();

  if (lower.includes("invalid login credentials")) {
    return "Неверная электронная почта или пароль.";
  }
  if (lower.includes("email not confirmed")) {
    return "Сначала подтвердите электронную почту по ссылке из письма.";
  }
  if (lower.includes("user already registered")) {
    return "Аккаунт с такой электронной почтой уже существует.";
  }
  if (lower.includes("password should be at least")) {
    return "Пароль слишком короткий.";
  }
  if (lower.includes("signup is disabled")) {
    return "Регистрация сейчас отключена.";
  }
  if (lower.includes("rate limit")) {
    return "Слишком много попыток. Подождите немного и попробуйте снова.";
  }

  return "Не удалось выполнить вход. Проверьте данные и попробуйте снова.";
}

export default function LoginPage() {
  const [supabase] = useState(() => createClient());
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setStatus("");

    try {
      if (mode === "login") {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (!data.session) {
          throw new Error("Сессия не была создана после входа.");
        }

        // Hard navigation is intentional: it guarantees that the auth cookies
        // written by @supabase/ssr are present on the first server request to /app.
        window.location.assign("/app");
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;

        if (data.session) {
          window.location.assign("/app");
        } else {
          setStatus("Аккаунт создан. Подтвердите электронную почту по ссылке из письма, затем войдите.");
        }
      }
    } catch (error) {
      setStatus(
        error instanceof Error
          ? translateAuthError(error.message)
          : "Не удалось выполнить авторизацию.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="authShell">
      <section className="authCard">
        <div className="authBrand">
          <div className="tensorMark">T</div>
          <div>
            <strong>TENSORRA</strong>
            <span>ИИ-пространство</span>
          </div>
        </div>

        <div className="authCopy">
          <p className="eyebrow">
            {mode === "login" ? "С ВОЗВРАЩЕНИЕМ" : "НОВЫЙ АККАУНТ"}
          </p>
          <h1>
            {mode === "login"
              ? "Войти в TENSORRA"
              : "Создать аккаунт TENSORRA"}
          </h1>
          <p>Один аккаунт для чатов, памяти, файлов и будущих ИИ-агентов.</p>
        </div>

        <form className="authForm" onSubmit={submit}>
          <label>
            Электронная почта
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </label>

          <label>
            Пароль
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
            />
          </label>

          <button className="primaryButton" disabled={loading} type="submit">
            {loading
              ? "Подождите…"
              : mode === "login"
                ? "Войти"
                : "Создать аккаунт"}
          </button>
        </form>

        {status ? <p className="authStatus">{status}</p> : null}

        <button
          className="textButton"
          onClick={() => setMode(mode === "login" ? "signup" : "login")}
        >
          {mode === "login"
            ? "Нет аккаунта? Зарегистрироваться"
            : "Уже есть аккаунт? Войти"}
        </button>
      </section>
    </main>
  );
}
