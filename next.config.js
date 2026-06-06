/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.alias['pdfjs-dist'] = false;
    }

    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
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
      'tesseract.js-core',
      'pdfjs-dist',
    ],
    outputFileTracingIncludes: {
      '/*': [
        './node_modules/pdfjs-dist/**/*',
        './node_modules/tesseract.js-core/**/*',
        './node_modules/tesseract.js/**/*',
      ],
    },
  },
};

module.exports = nextConfig;
