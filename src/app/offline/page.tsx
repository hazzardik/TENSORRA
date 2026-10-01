import Link from "next/link";

export default function OfflinePage() {
  return (
    <main className="offlineShell">
      <div className="tensorMark">T</div>
      <h1>Нет подключения к интернету</h1>
      <p>
        Для работы моделей TENSORRA требуется интернет. Оболочка установленного
        приложения остаётся доступной.
      </p>
      <Link href="/">Попробовать снова</Link>
    </main>
  );
}
