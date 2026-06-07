import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "@/components/providers";
import { BrandingApplier } from "@/components/branding-applier";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "FINOS v5.0",
  description: "Unified Financial Intelligence Platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/*
         * Blocking script — runs synchronously before first paint.
         * Sets data-pane and --finos-accent from localStorage so there is
         * zero flash of wrong pane colour on page load / refresh.
         * Also migrates the legacy "finos-appearance" key to "finos-pane".
         */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{
var lg=localStorage.getItem('finos-appearance');
if(lg&&!localStorage.getItem('finos-pane'))localStorage.setItem('finos-pane',lg==='light'?'light':'dark');
if(lg)localStorage.removeItem('finos-appearance');
var p=localStorage.getItem('finos-pane')||'dark';
document.documentElement.setAttribute('data-pane',p==='light'?'light':'dark');
var A={blue:'#4088f4',green:'#27AE60',red:'#EB5757',orange:'#F2994A',purple:'#9B51E0'};
var k=localStorage.getItem('finos-accent-color')||'blue';
document.documentElement.style.setProperty('--finos-accent',A[k]||A.blue);
}catch(e){}})();`,
          }}
        />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <Providers>
          <BrandingApplier />
          {children}
        </Providers>
      </body>
    </html>
  );
}
