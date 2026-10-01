import Link from "next/link";
export default function OfflinePage() {
  return <main className="offlineShell"><div className="tensorMark">T</div><h1>You’re offline.</h1><p>TENSORRA needs a connection for model inference. Your installed app shell is still available.</p><Link href="/">Try again</Link></main>;
}
