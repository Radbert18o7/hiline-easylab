/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.alias['canvas'] = false;
      config.resolve.alias['pdfjs-dist'] = false;
    }

    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
      canvas: false,
    };

    // Handle .mjs files
    config.module.rules.push({
      test: /\.mjs$/,
      include: /node_modules/,
      type: 'javascript/auto',
    });

    return config;
  },
  experimental: {
    serverComponentsExternalPackages: [
      'tesseract.js',
      'canvas',
      'pdfjs-dist',
      '@napi-rs/canvas',
    ],
    outputFileTracingIncludes: {
      '/api/**/*': ['./node_modules/pdfjs-dist/**/*'],
    },
  },
};

module.exports = nextConfig;
