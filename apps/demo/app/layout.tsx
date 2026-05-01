import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Live2D React Demo",
  description: "Demo app for the live2d-react component library",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
