/** @type {import("next").NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "3mb"
    }
  },
  transpilePackages: [
    "@hulee/app-shell",
    "@hulee/branding",
    "@hulee/contracts",
    "@hulee/i18n",
    "@hulee/ui"
  ]
};

export default nextConfig;
