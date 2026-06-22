/** @type {import("next").NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@hulee/app-shell",
    "@hulee/branding",
    "@hulee/contracts",
    "@hulee/i18n",
    "@hulee/ui"
  ]
};

export default nextConfig;
