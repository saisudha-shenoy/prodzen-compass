import { Public_Sans } from "next/font/google";
import "./globals.css";

const publicSans = Public_Sans({
  weight: ["400", "500", "600", "700", "800"],
  subsets: ["latin"],
  display: "swap",
});

export const metadata = {
  title: "ProdZen Compass",
  description: "Turning Ideas Into Growing Businesses",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={publicSans.className}>
      <body>{children}</body>
    </html>
  );
}
