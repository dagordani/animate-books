import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible, Literata } from "next/font/google";
import "./globals.css";

const ui = Atkinson_Hyperlegible({ variable: "--font-ui", subsets: ["latin"], weight: ["400", "700"] });
const read = Literata({ variable: "--font-read", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Animate Books: books that read to you",
  description:
    "Illustrated, narrated books with a reading companion you can interrupt anytime: built for learners and readers who find it hard to focus.",
};

export const viewport: Viewport = { themeColor: "#fbf6ec" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${ui.variable} ${read.variable} antialiased`}>{children}</body>
    </html>
  );
}
