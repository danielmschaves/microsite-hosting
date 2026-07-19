import type { Metadata } from "next";
import { Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const ui = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-ui-family",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono-family",
  display: "swap",
});

export const metadata: Metadata = {
  title: "MicroBuild — private, self-expiring HTML hosting",
  description: "Ship an HTML file. Get a private, SSO-gated link that expires.",
};

// Applies the persisted theme before first paint to avoid a flash.
const themeScript = `
(function(){try{var t=localStorage.getItem('mb-theme');
document.documentElement.dataset.theme=(t==='light'||t==='dark')?t:'dark';}
catch(e){document.documentElement.dataset.theme='dark';}})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${ui.variable} ${mono.variable}`} data-theme="dark">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
