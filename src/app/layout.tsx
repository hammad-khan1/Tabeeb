import type { Metadata } from "next";
import { Geist, Noto_Nastaliq_Urdu } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { LocaleProvider } from "@/components/providers/locale-provider";
import { getPreferredLocale } from "@/lib/user-preferences";
import { directionFor } from "@/lib/i18n";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const notoNastaliqUrdu = Noto_Nastaliq_Urdu({
  variable: "--font-urdu",
  subsets: ["arabic"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "Tabeeb - Personal Medical Document Vault",
  description: "AI-powered personal medical document vault that reads, understands, and reasons over your complete medical history.",
  icons: {
    icon: [
      { url: "/branding/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/branding/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/branding/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/favicon.ico" },
    ],
    apple: [
      { url: "/branding/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

/**
 * `lang` and `dir` come from the user's saved preference rather than being hardcoded
 * to English. Without this the Urdu font and the `.font-urdu` RTL utility were both
 * loaded and never used, and `preferredLanguage` had no effect anywhere.
 *
 * Nastaliq is applied as the body face only for Urdu: it is a beautiful but tall,
 * low-density script, and forcing it on an English interface hurts legibility.
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getPreferredLocale();
  const dir = directionFor(locale);

  return (
    <ClerkProvider>
      <html
        lang={locale}
        dir={dir}
        className={`${geistSans.variable} ${notoNastaliqUrdu.variable} h-full antialiased`}
      >
        <body
          className={`min-h-full flex flex-col ${
            locale === "ur" ? "font-urdu-ui" : "font-sans"
          }`}
        >
          <LocaleProvider locale={locale}>{children}</LocaleProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
