import Link from "next/link";

export default function NotFoundPage() {
  return (
    <main className="offlineShell">
      <div className="tensorMark">T</div>
      <h1>Страница не найдена</h1>
      <p>
        Такой страницы в TENSORRA нет или её адрес был изменён.
      </p>
      <Link href="/">На главную</Link>
    </main>
  );
}
