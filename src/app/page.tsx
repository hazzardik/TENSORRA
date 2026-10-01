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
          <Link className="navPrimary" href="/app">Открыть TENSORRA</Link>
        </div>
      </nav>

      <section className="landingHero">
        <div className="landingGlow" />
        <p className="eyebrow">ИИ · ПАМЯТЬ · РАССУЖДЕНИЕ</p>
        <h1>
          Интеллект, который подстраивается
          <br />
          под вашу задачу.
        </h1>
        <p className="landingLead">
          TENSORRA объединяет разные уровни рассуждения, автоматический поиск в интернете,
          вычисления, анализ изображений, работу с документами и долговременную память
          в одном ИИ-приложении.
        </p>

        <div className="landingCtas">
          <Link className="heroPrimary" href="/app">Начать работу</Link>
          <InstallAppButton />
        </div>

        <div className="heroStatus">
          <span><i /> Автовыбор глубины</span>
          <span><i /> Умный веб-поиск</span>
          <span><i /> Работа с PDF</span>
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
          <h2>Документы и изображения</h2>
          <p>
            Прикрепляйте PDF, текстовые файлы и изображения прямо к сообщению.
            TENSORRA сама определит тип файла и способ обработки.
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
          <h2>Один интерфейс. Умный роутер выбирает нужные возможности.</h2>
        </div>

        <div className="architectureFlow">
          <span>Интерфейс</span><b>→</b>
          <span>Роутер</span><b>→</b>
          <span>Контекст</span><b>→</b>
          <span>Инструменты</span><b>→</b>
          <span>Модели</span>
        </div>
      </section>

      <footer className="landingFooter">
        <span>© 2026 TENSORRA</span>
        <span>Веб · iOS · Android · Компьютер</span>
      </footer>
    </main>
  );
}
