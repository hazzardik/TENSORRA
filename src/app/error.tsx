"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="offlineShell">
      <div className="tensorMark">T</div>
      <h1>Что-то пошло не так</h1>
      <p>
        TENSORRA столкнулась с ошибкой интерфейса. Попробуйте перезапустить
        страницу — ваши чаты сохраняются отдельно.
      </p>
      <button className="primaryButton" onClick={() => reset()}>
        Повторить
      </button>
      <a href="/">На главную</a>
    </main>
  );
}
