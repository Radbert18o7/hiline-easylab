import './globals.css';

export const metadata = {
  title: 'HI-LINE Easy Lab — Warehouse Operations Platform',
  description: 'Internal operations platform for HI-LINE GIFT: PDF document processing, label SKU overlay, team chat, and activity logging.',
  keywords: 'warehouse, pickwave, labels, SKU, operations',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-theme="light">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <link rel="icon" href="/favicon.ico" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
