import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Debtrecover — N K Lodha & Co",
  description:
    "Assisted B2B debt recovery workflow: reminders, GST communications, MSME ODR filing, and payment confirmation.",
};

const themeInit = `(function(){try{var t=localStorage.getItem('dr-theme');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // The inline theme-init script below sets data-theme on this element
      // before React hydrates (that's the whole point -- no flash of the
      // wrong theme). React would otherwise warn/mismatch on hydration
      // because the server never rendered that attribute; this is the
      // documented escape hatch for exactly this pattern, scoped to the one
      // attribute the script touches.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
