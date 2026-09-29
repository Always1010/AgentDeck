export const isImageFormat = (format: string) => /^(png|jpe?g|gif|webp|ico|svg)$/i.test(format);
export const hasTextSource = (format: string) => !isImageFormat(format) || format.toLowerCase() === 'svg';

export function versionedImageUrl(url: string, version?: string) {
  const result = new URL(url);
  if (version) result.searchParams.set('fileVersion', version);
  return result.href;
}
