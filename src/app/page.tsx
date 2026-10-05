import Link from "next/link";
import InstallAppButton from "@/components/install-app-button";

export default function LandingPage() {
  return (
    <main className="landingShell">
      <nav className="landingNav">
        <Link className="landingBrand" href="/">
          <span className="tensorMark">T</span>
          <strong>TENSORRA</strong>
        </Link>

        <div className="landingNavActions">
          <Link href="/login">Войти</Link>
          <Link className="navPrimary" href="/login">Открыть TENSORRA</Link>
        </div>
      </nav>

      <section className="landingHero">
        <div className="landingGlow" />
        <p className="eyebrow">ИИ · ПАМЯТЬ · РАССУЖДЕНИЕ</p>
        <h1>
          Один ИИ. Разная глубина
          <br />
          для разных задач.
        </h1>
        <p className="landingLead">
          Быстрый ответ, глубокий разбор или максимальная проверка — TENSORRA
          маршрутизирует задачу через собственное ядро, подключая память, веб,
          вычисления, файлы и проверку ответа только когда это действительно нужно.
        </p>

        <div className="landingCtas">
          <Link className="heroPrimary" href="/login">Начать работу</Link>
          <InstallAppButton />
        </div>

        <div className="heroStatus">
          <span><i /> Автовыбор глубины</span>
          <span><i /> Умный веб-поиск</span>
          <span><i /> Чтение и экспорт PDF</span>
          <span><i /> На разных устройствах</span>
        </div>
      </section>

      <section className="featureGrid">
        <article>
          <span className="featureIndex">01</span>
          <h2>Глубина мышления</h2>
          <p>
            Авто, Быстро, Баланс, Глубоко и Максимум. TENSORRA сама подбирает
            модель и объём рассуждений под задачу.
          </p>
        </article>

        <article>
          <span className="featureIndex">02</span>
          <h2>Инструменты автоматически</h2>
          <p>
            Если нужны свежие данные, вычисления или проверка фактов, TENSORRA
            сама подключает веб-поиск или выполнение кода.
          </p>
        </article>

        <article>
          <span className="featureIndex">03</span>
          <h2>Файлы и готовые артефакты</h2>
          <p>
            Прикрепляйте PDF, текст и изображения. TENSORRA разбирает содержимое,
            а документные ответы можно экспортировать в готовый PDF прямо из чата.
          </p>
        </article>

        <article>
          <span className="featureIndex">04</span>
          <h2>Долговременная память</h2>
          <p>
            Полезные цели, предпочтения и постоянные ограничения могут
            сохраняться между чатами и использоваться только когда это уместно.
          </p>
        </article>
      </section>

      <section className="architectureBand">
        <div>
          <p className="eyebrow">ЯДРО TENSORRA</p>
          <h2>Не просто модель. Ядро планирует, подключает инструменты и проверяет ответ.</h2>
        </div>

        <div className="architectureFlow">
          <span>Router</span><b>→</b>
          <span>Planner</span><b>→</b>
          <span>Память + Tools</span><b>→</b>
          <span>Model</span><b>→</b>
          <span>Verify</span>
        </div>
      </section>

      <footer className="landingFooter">
        <span>© 2026 TENSORRA</span>
        <span>Веб · iOS · Android · Компьютер</span>
      </footer>
    </main>
  );
}
