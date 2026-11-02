import Script from 'next/script';
import './globals.css';
export const metadata = { title:'VisionAI Video', description:'Telegram AI Video Mini App' };
export default function RootLayout({children}){
  return <html lang="en"><body>
    <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
    {children}
  </body></html>;
}
