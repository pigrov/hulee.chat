const allowedAssetExtensions = [
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".ico"
];

export function isAllowedBrandAssetPath(path: string): boolean {
  const lowerPath = path.toLowerCase();

  return allowedAssetExtensions.some((extension) =>
    lowerPath.endsWith(extension)
  );
}
